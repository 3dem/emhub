# SPDX-License-Identifier: GPL-3.0-or-later
"""Contract tests: the MCP tools against a real, throw-away EMhub-Tomo server.

Needs an EMhub-Tomo installation (the folder with emwrap.bashrc) in
EMHUB_TOMO_HOME; skipped otherwise. The server runs with a generated test
site: the installation's Python environment, the local queue only, and stub
launchers for every external program (they print an error and exit 1), so no
GPU program can run. Project A then holds three kinds of jobs:

- an import job that finished cleanly (with tiny generated frames);
- a motion-correction job marked finished although WarpTools (the stub) failed:
  emwrap's Warp jobs record failed items and still finish;
- a second import job that failed outright (an invalid parameter).

Set EMHUB_TEST_WORKDIR to keep the temporary files off /tmp.
"""

from __future__ import annotations

import json
import os
import secrets
import shutil
import struct
import time
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx2
import pytest
from emhub_instance import EmhubInstance, emhub_instance
from mcp import Client

from emhub_tomo_mcp.config import load_settings
from emhub_tomo_mcp.server import build_server
from emhub_tomo_mcp.services import Services

pytestmark = [
    pytest.mark.contract,
    pytest.mark.skipif(
        not os.environ.get("EMHUB_TOMO_HOME"),
        reason="EMHUB_TOMO_HOME is not set (no EMhub-Tomo installation)",
    ),
]

MDOC = Path(__file__).resolve().parents[1] / "fixtures" / "data" / "TS_1.mrc.mdoc"
TERMINAL = {"finished", "failed", "aborted"}
PROGRAMS = (
    "WARP",
    "RELION",
    "PYTOM",
    "MOTIONCOR2",
    "MOTIONCOR3",
    "ARETOMO2",
    "ARETOMO3",
    "IMOD",
    "CTFFIND",
    "CRYOCARE",
    "DENOISET",
    "MISSALIGNMENT",
)
STUB_ERROR = "stub program failed on purpose (contract test)"


FRAMES = (
    "2Dvs3D_53-1_00041_-40.0_Jul31_11.05.12.tif",  # the frames named in the mdoc
    "2Dvs3D_53-1_00040_-38.0_Jul31_11.04.30.tif",
)


def tiny_tiff(width: int = 16, height: int = 8, pages: int = 3) -> bytes:
    """A valid uncompressed 8-bit grey multi-page TIFF, like a movie of sub-frames.
    Import only reads its dimensions (and needs more than one page)."""
    ifd_size = 2 + 9 * 12 + 4
    page_size = ifd_size + width * height
    out = b"II*\x00" + struct.pack("<I", 8)
    for page in range(pages):
        offset = 8 + page * page_size
        entries = [
            (256, 3, width),
            (257, 3, height),
            (258, 3, 8),
            (259, 3, 1),
            (262, 3, 1),
            (273, 4, offset + ifd_size),
            (277, 3, 1),
            (278, 3, height),
            (279, 4, width * height),
        ]
        following = offset + page_size if page < pages - 1 else 0
        out += struct.pack("<H", len(entries))
        out += b"".join(struct.pack("<HHII", t, k, 1, v) for t, k, v in entries)
        out += struct.pack("<I", following) + bytes(width * height)
    return out


def make_test_site(site: Path, installation: Path) -> Path:
    """A site folder for emhub_instance(): the installation's Python environment,
    the local queue only, and stub launchers that always fail."""
    site.mkdir(parents=True)
    stub = site / "stub_fail.sh"
    stub.write_text(
        f'#!/bin/bash\necho "stub launcher called: $*"\necho "ERROR: {STUB_ERROR}" >&2\nexit 1\n'
    )
    programs = {name: {"launcher": str(stub)} for name in PROGRAMS}
    programs["EMWRAP"] = {"launcher": f"{site}/emh-tomo --launch"}
    config = json.dumps({"queues": [{"name": "None"}], "programs": programs})
    (site / "emwrap.bashrc").write_text(
        "#!/bin/bash\n"
        f'export ROOT="{site}"\n'
        f'export SCRIPTS="{site}"\n'
        f'. "{installation}/bashrc" > /dev/null\n'
        f"export EMWRAP_CONFIG='{config}'\n"
    )
    launcher = site / "emh-tomo"
    launcher.write_text(
        "#!/bin/bash\n"
        f'export EMHUB_TOMO_HOME="{site}"\n'
        f'. "{site}/emwrap.bashrc"\n'
        'exec python -m emwrap.tomo "$@"\n'
    )
    for script in (stub, launcher):
        script.chmod(0o755)
    return site


class Rest:
    """Minimal synchronous EMhub client for setting up test data."""

    def __init__(self, url: str) -> None:
        self.http = httpx2.Client(base_url=url, timeout=120, trust_env=False)

    def __call__(self, method: str, attrs: Any = None, **body: Any) -> Any:
        if attrs is not None:
            body["attrs"] = attrs
        data = self.http.post(f"/api/{method}", json=body).json()
        if isinstance(data, dict) and ("error" in data or "errors" in data):
            raise RuntimeError(f"{method}: {str(data)[:800]}")
        return data


@dataclass
class World:
    inst: EmhubInstance
    bob_password: str
    project_a: int  # admin's: the tutorial template, a finished import, a failed job
    project_b: int  # admin's, shared with bob (view-only)
    project_c: int  # admin's, not shared
    import_job: str  # finished cleanly
    partial_job: str  # finished, but its program failed
    failed_job: str  # failed
    root_a: Path


def _entry(
    rest: Rest, container: int, path: Path, data: Path, title: str, share: list[dict[str, str]]
) -> int:
    attrs = {
        "project_id": container,
        "type": "tomo_processing",
        "title": title,
        "description": "",
        "date": "2026-10-21T10:00:00Z",
        "extra": {
            "data": {"processing_path": str(path), "data_path": str(data), "share_table": share}
        },
    }
    return int(rest("create_entry", attrs)["entry"]["id"])


def _wait_status(rest: Rest, entry: int, job: str, timeout: float = 240) -> str:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        jobs = rest("get_session_workflow", {"entry_id": entry, "widget": False})["workflow"]
        status = next(j["status"] for j in jobs if j["id"] == job)
        if status in TERMINAL:
            return str(status)
        time.sleep(2)
    raise TimeoutError(f"{job} did not finish in {timeout} s")


@pytest.fixture(scope="module")
def world(tmp_path_factory: pytest.TempPathFactory) -> Iterator[World]:
    workdir = Path(os.environ.get("EMHUB_TEST_WORKDIR") or tmp_path_factory.mktemp("contract"))
    workdir.mkdir(parents=True, exist_ok=True)
    site = make_test_site(
        workdir / f"site-{secrets.token_hex(4)}", Path(os.environ["EMHUB_TOMO_HOME"]).resolve()
    )
    try:
        yield from _world(site, workdir)
    finally:
        shutil.rmtree(site, ignore_errors=True)


def _world(site: Path, workdir: Path) -> Iterator[World]:
    with emhub_instance(home=site, workdir=workdir) as inst:
        rest = Rest(inst.url)
        rest("login", username=inst.username, password=inst.password)
        bob_password = secrets.token_urlsafe(12)
        rest(
            "create_user",
            {
                "username": "bob",
                "email": "bob@example.org",
                "name": "Bob",
                "password": bob_password,
                "roles": ["user"],
                "pi_id": None,
                "phone": "",
            },
        )
        admin = next(u for u in rest("get_users", ["id", "username"]) if u["username"] == "admin")
        container = next(
            (
                p["id"]
                for p in rest("get_projects")
                if p["status"] == "special:processing_tomo" and p["user_id"] == admin["id"]
            ),
            None,
        )
        if container is None:
            container = rest(
                "create_project",
                {
                    "user_id": admin["id"],
                    "status": "special:processing_tomo",
                    "user_can_edit": True,
                    "is_confidential": False,
                    "title": "Default Project for tomo_processing entries",
                    "description": "",
                },
            )["project"]["id"]

        data = inst.root / "data"
        (data / "mdoc").mkdir(parents=True)
        (data / "frames").mkdir()
        mdoc = data / "mdoc" / MDOC.name
        shutil.copy(MDOC, mdoc)
        # Import only takes mdoc files that have not changed for a minute
        # (they may still be written during acquisition).
        old = time.time() - 600
        os.utime(mdoc, (old, old))
        for frame in FRAMES:
            (data / "frames" / frame).write_bytes(tiny_tiff())
        (data / "gain_ref.mrc").write_bytes(b"")
        projects = inst.root / "projects"
        projects.mkdir()
        a = _entry(rest, container, projects / "a", data, "Tutorial A", [])
        b = _entry(
            rest,
            container,
            projects / "b",
            data,
            "Shared B",
            [{"user_email": "bob@example.org", "user_perms": "view-only"}],
        )
        c = _entry(rest, container, projects / "c", data, "Private C", [])

        rest("load_workflow", {"entry_id": a, "workflow_id": "apof-warp-tutorial-part1"})
        jobs = rest("get_session_workflow", {"entry_id": a, "widget": False})["workflow"]
        import_job = next(j["id"] for j in jobs if j["type"] == "emw-import-ts")
        mctf_job = next(j["id"] for j in jobs if j["type"] == "emw-warp-mctf")
        # launch_job takes the job's parameters with the request.
        rest(
            "launch_job",
            {
                "entry_id": a,
                "run_id": import_job,
                "clean": False,
                "params": {
                    "mdoc_files": "data/mdoc/*.mdoc",
                    "acq.gain": "data/gain_ref.mrc",
                    "queue.name": "None",
                    "wait.timeout": "5",
                },
            },
        )
        assert _wait_status(rest, a, import_job) == "finished"
        rest(
            "launch_job",
            {
                "entry_id": a,
                "run_id": mctf_job,
                "clean": False,
                "params": {"queue.name": "None", "gpus": "1"},
            },
        )
        assert _wait_status(rest, a, mctf_job) == "finished"
        # A copy of the import with a wait.timeout that is not a number: the form does
        # not type-check it, so int() fails in the job itself.
        copy = rest("duplicate_jobs", {"entry_id": a, "run_ids": [import_job]})
        failed_job = copy["workflow"]["duplicated"][0]["newId"]
        rest(
            "launch_job",
            {
                "entry_id": a,
                "run_id": failed_job,
                "clean": False,
                "params": {"wait.timeout": "soon", "queue.name": "None"},
            },
        )
        assert _wait_status(rest, a, failed_job) == "failed"
        yield World(
            inst=inst,
            bob_password=bob_password,
            project_a=a,
            project_b=b,
            project_c=c,
            import_job=import_job,
            partial_job=mctf_job,
            failed_job=failed_job,
            root_a=projects / "a",
        )


def _services(world: World, user: str = "admin") -> Services:
    password = world.inst.password if user == "admin" else world.bob_password
    loaded = load_settings(
        {
            "EMHUB_SERVER_URL": world.inst.url,
            "EMHUB_TOMO_MCP_AUTH": "password",
            "EMHUB_USER": user,
            "EMHUB_PASSWORD": password,
        }
    )
    return Services.create(loaded.settings)


@pytest.fixture
async def admin(world: World) -> AsyncIterator[Client]:
    async with Client(build_server(_services(world))) as client:
        yield client


@pytest.fixture
async def bob(world: World) -> AsyncIterator[Client]:
    async with Client(build_server(_services(world, "bob"))) as client:
        yield client


async def call(client: Client, tool: str, **args: Any) -> dict[str, Any]:
    result = await client.call_tool(tool, args)
    text = result.content[0].text  # type: ignore[union-attr]
    assert not result.is_error, text
    assert result.structured_content is not None
    return result.structured_content


async def error(client: Client, tool: str, **args: Any) -> str:
    result = await client.call_tool(tool, args)
    assert result.is_error
    return str(result.content[0].text)  # type: ignore[union-attr]


@pytest.mark.anyio
async def test_status(admin: Client) -> None:
    status = await call(admin, "get_server_status")
    assert status["reachable"] and status["error"] is None
    assert status["identity"]["username"] == "admin" and status["identity"]["is_admin"]
    assert status["visible_projects"] == 3
    assert status["capabilities"] == {"get_workflows": True, "get_job_types": True}


@pytest.mark.anyio
async def test_projects_and_visibility(admin: Client, bob: Client, world: World) -> None:
    listing = await call(admin, "list_projects", include_job_counts=True)
    by_id = {p["id"]: p for p in listing["projects"]}
    assert set(by_id) == {world.project_a, world.project_b, world.project_c}
    a = by_id[world.project_a]
    assert (a["owner"], a["access"], a["processing_path"]) == ("admin", "owner", str(world.root_a))
    assert a["job_counts"] == {"finished": 2, "failed": 1, "saved": 9}

    shared = await call(bob, "list_projects")
    assert [(p["id"], p["access"]) for p in shared["projects"]] == [(world.project_b, "viewer")]
    assert "[not_found]" in await error(bob, "get_project", project_id=world.project_c)
    bob_status = await call(bob, "get_server_status")
    assert bob_status["identity"]["is_admin"] is False and bob_status["visible_projects"] == 1


@pytest.mark.anyio
async def test_project_graph(admin: Client, world: World) -> None:
    detail = await call(admin, "get_project", project_id=world.project_a)
    assert detail["job_count"] == 12
    assert detail["failed"] == [world.failed_job]
    jobs = {j["id"]: j for j in detail["jobs"]}
    assert jobs[world.import_job]["status"] == "finished"
    assert jobs[world.import_job]["elapsed_s"] is not None
    assert jobs[world.partial_job]["parents"] == [world.import_job]
    assert jobs[world.partial_job]["status"] == "finished"
    template_job = next(j for j in jobs.values() if j["type"] == "emw-pytom-create_template")
    assert template_job["parents"] == [] and template_job["id"] in detail["ready_to_run"]
    tsalign = next(j for j in jobs.values() if j["type"] == "emw-warp-tsalign")
    assert tsalign["id"] in detail["ready_to_run"]
    for job in jobs.values():
        assert len(job["parents"]) == len(set(job["parents"]))
        for parent in job["parents"]:
            assert job["id"] in jobs[parent]["children"]


@pytest.mark.anyio
async def test_clean_job(admin: Client, world: World) -> None:
    job = await call(admin, "get_job", project_id=world.project_a, job_id=world.import_job)
    assert job["status"] == "finished" and job["warnings"] == [] and job["error_lines"] == []
    assert [(o["path"], o["exists"]) for o in job["outputs"]] == [
        (f"{world.import_job}/tilt_series.star", True)
    ]
    star = await call(
        admin,
        "read_project_file",
        project_id=world.project_a,
        path=f"{world.import_job}/tilt_series.star",
    )
    assert "TS_1" in star["text"]


@pytest.mark.anyio
async def test_failed_job_diagnosis(admin: Client, world: World) -> None:
    job = await call(
        admin, "get_job", project_id=world.project_a, job_id=world.failed_job, log_tail_lines=20
    )
    assert job["status"] == "failed" and job["type"] == "emw-import-ts"
    assert job["params"]["wait.timeout"] == "soon"
    logs = await call(admin, "get_job_logs", project_id=world.project_a, job_id=world.failed_job)
    error_text = "\n".join(e["text"] for e in logs["error_lines"])
    assert "ValueError" in error_text and "soon" in error_text
    assert "\x1b[" not in "\n".join(w["text"] for w in logs["logs"])


@pytest.mark.anyio
async def test_finished_job_with_failed_program_is_flagged(admin: Client, world: World) -> None:
    job = await call(admin, "get_job", project_id=world.project_a, job_id=world.partial_job)
    assert job["status"] == "finished" and job["type"] == "emw-warp-mctf"
    assert job["params"]["input_tiltseries"] == f"{world.import_job}/tilt_series.star"
    assert job["warnings"] and "error-like" in job["warnings"][0]
    error_text = "\n".join(e["text"] for e in job["error_lines"])
    assert "Exit code: 1" in error_text
    logs = await call(
        admin,
        "get_job_logs",
        project_id=world.project_a,
        job_id=world.partial_job,
        contains="stub launcher called",
    )
    assert "WarpTools" in logs["logs"][0]["text"]
    assert logs["warnings"]


@pytest.mark.anyio
async def test_wait_returns_for_finished_and_saved(admin: Client, world: World) -> None:
    done = await call(
        admin,
        "wait_for_jobs",
        project_id=world.project_a,
        job_ids=[world.import_job, world.failed_job],
        timeout_s=10,
    )
    assert done["satisfied"]
    assert [j["status"] for j in done["jobs"]] == ["finished", "failed"]
    detail = await call(
        admin, "get_project", project_id=world.project_a, statuses=["saved"], limit=1
    )
    saved = detail["jobs"][0]["id"]
    idle = await call(
        admin, "wait_for_jobs", project_id=world.project_a, job_ids=[saved], timeout_s=10
    )
    assert not idle["satisfied"] and "not scheduled or running" in idle["note"]


@pytest.mark.anyio
async def test_every_job_type_has_a_readable_form(admin: Client) -> None:
    """Catches form drift: every registered job type must describe cleanly."""
    registry = await call(admin, "list_job_types", include_hidden=True)
    assert registry["source"] == "registry" and len(registry["job_types"]) >= 20
    for job_type in registry["job_types"]:
        if job_type["id"] == "emw-pytme":  # hidden and without a form upstream
            continue
        described = await call(admin, "describe_job_type", job_type=job_type["id"])
        assert described["params"], job_type["id"]
        assert "None" in described["queue_names"], job_type["id"]


@pytest.mark.anyio
async def test_templates(admin: Client) -> None:
    templates = await call(admin, "list_workflow_templates")
    ids = {t["id"] for t in templates["templates"]}
    assert {"apof-warp-tutorial-part1", "apof-warp-tutorial-part2"} <= ids


@pytest.mark.anyio
async def test_files(admin: Client, world: World) -> None:
    top = await call(admin, "list_project_files", project_id=world.project_a)
    names = {e["name"]: e for e in top["entries"]}
    assert names["data"]["kind"] == "dir" and names["default_pipeline.star"]["kind"] == "text"
    mdocs = await call(admin, "list_project_files", project_id=world.project_a, path="data/mdoc")
    assert [e["name"] for e in mdocs["entries"]] == ["TS_1.mrc.mdoc"]
    job_star = f"{world.failed_job}/job.star"
    content = await call(admin, "read_project_file", project_id=world.project_a, path=job_star)
    assert "data_job" in content["text"] and content["kind"] == "text"
    for path in ("../b/default_pipeline.star", "/etc/passwd", "~/.bashrc"):
        assert "[validation]" in await error(
            admin, "read_project_file", project_id=world.project_a, path=path
        )
    assert "[not_found]" in await error(
        admin, "read_project_file", project_id=world.project_a, path="default_pipeline.sta"
    )


@pytest.mark.anyio
async def test_resources(admin: Client, world: World) -> None:
    workflow = await admin.read_resource(f"emhub-tomo://projects/{world.project_a}/workflow")
    assert len(json.loads(workflow.contents[0].text)) == 12  # type: ignore[union-attr]
    form = await admin.read_resource("emhub-tomo://job-types/emw-import-ts/form")
    assert json.loads(form.contents[0].text)["sections"]  # type: ignore[union-attr]
