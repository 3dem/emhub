# SPDX-License-Identifier: GPL-3.0-or-later
"""Contract tests for the change tools: a real EMhub-Tomo with stub launchers.

The server acts with access level 'admin'. GPU jobs may run on the local queue
here (the only queue of the test site): the programs are stubs, so nothing
real runs. A second configuration without that permission checks the refusal.
Needs EMHUB_TOMO_HOME; set EMHUB_TEST_WORKDIR to keep files off /tmp.
"""

from __future__ import annotations

import os
import secrets
import shutil
import time
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from emhub_instance import EmhubInstance, emhub_instance
from mcp import Client
from site_helpers import FRAMES, MDOC, make_test_site, set_stub_mode, tiny_tiff

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


@dataclass
class Site:
    inst: EmhubInstance
    site: Path
    root: Path  # allowed root: projects and data live here
    state: Path


@pytest.fixture(scope="module")
def site(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Site]:
    workdir = Path(os.environ.get("EMHUB_TEST_WORKDIR") or tmp_path_factory.mktemp("write"))
    workdir.mkdir(parents=True, exist_ok=True)
    folder = make_test_site(
        workdir / f"site-{secrets.token_hex(4)}", Path(os.environ["EMHUB_TOMO_HOME"]).resolve()
    )
    try:
        with emhub_instance(home=folder, workdir=workdir) as inst:
            data = inst.root / "data"
            (data / "mdoc").mkdir(parents=True)
            (data / "frames").mkdir()
            mdoc = data / "mdoc" / MDOC.name
            shutil.copy(MDOC, mdoc)
            old = time.time() - 600  # import takes mdoc files unchanged for a minute
            os.utime(mdoc, (old, old))
            for frame in FRAMES:
                (data / "frames" / frame).write_bytes(tiny_tiff())
            (data / "gain_ref.mrc").write_bytes(b"")
            (inst.root / "projects").mkdir()
            yield Site(inst=inst, site=folder, root=inst.root, state=inst.root / "state")
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def _client(site: Site, **env: str) -> Client:
    base = {
        "EMHUB_SERVER_URL": site.inst.url,
        "EMHUB_TOMO_MCP_AUTH": "password",
        "EMHUB_USER": "admin",
        "EMHUB_PASSWORD": site.inst.password,
        "EMHUB_TOMO_MCP_ACCESS": "admin",
        "EMHUB_TOMO_MCP_ALLOWED_ROOTS": str(site.root),
        "EMHUB_TOMO_MCP_ALLOW_LOCAL_GPU": "true",
        "EMHUB_TOMO_MCP_STATE_DIR": str(site.state),
    }
    base.update(env)
    return Client(build_server(Services.create(load_settings(base).settings)))


@pytest.fixture
async def admin(site: Site) -> AsyncIterator[Client]:
    async with _client(site) as client:
        yield client


async def call(client: Client, tool: str, **args: Any) -> dict[str, Any]:
    result = await client.call_tool(tool, args)
    text = "".join(getattr(c, "text", "") for c in result.content)
    assert not result.is_error, text
    assert result.structured_content is not None
    return result.structured_content


async def error(client: Client, tool: str, **args: Any) -> str:
    result = await client.call_tool(tool, args)
    assert result.is_error
    return "".join(getattr(c, "text", "") for c in result.content)


async def new_project(client: Client, site: Site, name: str) -> tuple[int, dict[str, str]]:
    created = await call(
        client,
        "create_project",
        title=name,
        processing_path=str(site.root / "projects" / name),
        data_path=str(site.root / "data"),
    )
    pid = created["project_id"]
    loaded = await call(
        client, "load_workflow_template", project_id=pid, workflow_id="apof-warp-tutorial-part1"
    )
    assert len(loaded["created"]) == 11
    detail = await call(client, "get_project", project_id=pid)
    return pid, {j["type"]: j["id"] for j in detail["jobs"]}


@pytest.mark.anyio
async def test_pipeline_through_mcp(admin: Client, site: Site) -> None:
    """Create a project, load the tutorial, set up the import and schedule the
    preprocessing chain; every job starts after its parent and reaches an end."""
    set_stub_mode(site.site, "ok")
    pid, jobs = await new_project(admin, site, "pipeline")
    imp = jobs["emw-import-ts"]
    chain = [imp, jobs["emw-warp-mctf"], jobs["emw-warp-tsalign"], jobs["emw-warp-ctfrec"]]
    rejected = await error(
        admin,
        "save_job",
        project_id=pid,
        job_id=imp,
        params={"mdoc_files": "data/mdoc/none_*.mdoc"},
    )
    assert "[validation] EMhub rejected" in rejected and "no files match" in rejected
    await call(
        admin,
        "save_job",
        project_id=pid,
        job_id=imp,
        params={"mdoc_files": "data/mdoc/*.mdoc", "wait.timeout": "5"},
    )
    plan = await call(admin, "schedule_jobs", project_id=pid, job_ids=chain, dry_run=True)
    assert plan["dry_run"] and [j["status"] for j in plan["jobs"]] == ["saved"] * 4
    scheduled = await call(
        admin, "schedule_jobs", project_id=pid, job_ids=chain, interval_minutes=1
    )
    assert {j["status"] for j in scheduled["jobs"]} <= {"scheduled", "launched", "running"}
    done = await call(
        admin, "wait_for_jobs", project_id=pid, job_ids=chain, timeout_s=600, poll_interval_s=10
    )
    states = {j["id"]: j["status"] for j in done["jobs"]}
    assert states[imp] == "finished" and states[jobs["emw-warp-mctf"]] == "finished"
    if not done["satisfied"]:
        # The stubs produce no alignment, so it fails; the reconstruction scheduled after
        # it would wait forever. The server says so instead of waiting.
        assert not done["timed_out"] and "will never start" in done["note"], done
        rec = jobs["emw-warp-ctfrec"]
        detail = await call(admin, "get_project", project_id=pid)
        assert any(b.startswith(rec) for b in detail["blocked"]), detail["blocked"]
        cancelled = await call(admin, "stop_jobs", project_id=pid, job_ids=[rec])
        assert cancelled["jobs"][0]["status"] == "saved"
    audit = (site.state / "audit.jsonl").read_text()
    assert '"action": "schedule_jobs"' in audit and '"outcome": "done"' in audit


@pytest.mark.anyio
async def test_stop_running_job(admin: Client, site: Site) -> None:
    set_stub_mode(site.site, "sleep 300")
    pid, jobs = await new_project(admin, site, "stopping")
    imp = jobs["emw-import-ts"]
    await call(
        admin,
        "save_job",
        project_id=pid,
        job_id=imp,
        params={"mdoc_files": "data/mdoc/*.mdoc", "wait.timeout": "300"},
    )
    launched = await call(admin, "run_job", project_id=pid, job_id=imp)
    assert launched["jobs"][0]["status"] in ("launched", "running")
    again = await error(admin, "run_job", project_id=pid, job_id=imp)
    assert "[conflict]" in again and "already" in again
    stopped = await call(admin, "stop_jobs", project_id=pid, job_ids=[imp])
    assert stopped["jobs"][0]["status"] == "aborted"
    # A scheduled job whose parent will not finish can be cancelled too.
    mctf = jobs["emw-warp-mctf"]
    await call(admin, "schedule_jobs", project_id=pid, job_ids=[mctf])
    cancelled = await call(admin, "stop_jobs", project_id=pid, job_ids=[mctf])
    assert cancelled["jobs"][0]["status"] == "saved"
    set_stub_mode(site.site, "fail")


@pytest.mark.anyio
async def test_gpu_job_needs_a_cluster_queue(site: Site) -> None:
    async with _client(site, EMHUB_TOMO_MCP_ALLOW_LOCAL_GPU="false") as client:
        pid, jobs = await new_project(client, site, "no-local-gpu")
        message = await error(client, "run_job", project_id=pid, job_id=jobs["emw-warp-mctf"])
        assert "[policy_denied]" in message and "EMhub host" in message
        # A CPU job (import) may still run locally.
        dry = await call(
            client, "run_job", project_id=pid, job_id=jobs["emw-import-ts"], dry_run=True
        )
        assert "on queue 'None'" in dry["details"][0]


@pytest.mark.anyio
async def test_housekeeping(admin: Client, site: Site) -> None:
    pid, jobs = await new_project(admin, site, "housekeeping")
    imp, mctf = jobs["emw-import-ts"], jobs["emw-warp-mctf"]
    duplicate = await error(
        admin, "load_workflow_template", project_id=pid, workflow_id="apof-warp-tutorial-part1"
    )
    assert "[conflict]" in duplicate
    await call(
        admin,
        "annotate_job",
        project_id=pid,
        job_id=imp,
        run_name="Import",
        comment="checked\nby the contract test",
    )
    await call(admin, "tag_jobs", project_id=pid, job_ids=[imp, mctf], add=["prep", "check"])
    await call(admin, "tag_jobs", project_id=pid, job_ids=[mctf], remove=["check"])
    detail = await call(admin, "get_project", project_id=pid)
    by_id = {j["id"]: j for j in detail["jobs"]}
    assert by_id[imp]["run_name"] == "Import"
    assert sorted(by_id[imp]["labels"]) == ["check", "prep"] and by_id[mctf]["labels"] == ["prep"]
    job = await call(admin, "get_job", project_id=pid, job_id=imp)
    assert job["comment"] == "checked\nby the contract test"
    copy = await call(admin, "duplicate_jobs", project_id=pid, job_ids=[mctf])
    (new_id,) = copy["created"]
    assert new_id != mctf
    await call(admin, "export_workflow", project_id=pid, job_ids=[imp, mctf], file_name="prep.json")
    exported = await call(admin, "read_project_file", project_id=pid, path="prep.json")
    assert '"jobtype": "emw-warp-mctf"' in exported["text"]
    deleted = await call(admin, "delete_jobs", project_id=pid, job_ids=[new_id])
    assert deleted["jobs"][0]["status"] == "deleted"
    trash = await call(admin, "list_project_files", project_id=pid, path=".Trash")
    assert trash["total"] >= 1
    refused = await error(admin, "delete_jobs", project_id=pid, job_ids=[imp])
    assert "[conflict]" in refused and "use its outputs" in refused
