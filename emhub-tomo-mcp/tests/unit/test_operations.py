# SPDX-License-Identifier: GPL-3.0-or-later
"""Changes through the operations layer, against the fake EMhub."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx2
import pytest
from fake_emhub import FakeEmhub

from emhub_tomo_mcp.domain.projects import ProjectRef
from emhub_tomo_mcp.errors import EmhubMcpError, ErrorKind
from emhub_tomo_mcp.services import Services

pytestmark = pytest.mark.anyio

MUTATING = {
    "create_entry",
    "create_project",
    "load_workflow",
    "save_job",
    "launch_job",
    "schedule_job",
    "stop_jobs",
    "save_job_annotation",
    "save_project_label",
    "set_job_labels",
    "duplicate_jobs",
    "export_workflow",
    "delete_jobs",
}


@pytest.fixture
def make(services_for: Any, tmp_path: Path) -> Any:
    def make_services(**env: str) -> Services:
        base = {
            "EMHUB_TOMO_MCP_ACCESS": "admin",
            "EMHUB_TOMO_MCP_ALLOWED_ROOTS": "/data",
            "EMHUB_TOMO_MCP_DEFAULT_QUEUE": "cryo",
            "EMHUB_TOMO_MCP_STATE_DIR": str(tmp_path / "state"),
        }
        base.update(env)
        return services_for(**base)

    return make_services


@pytest.fixture
def ops(make: Any) -> Services:
    return make()  # type: ignore[no-any-return]


def mutations(fake: FakeEmhub) -> list[str]:
    return [m for m, _ in fake.calls if m in MUTATING]


def audit(tmp_path: Path) -> list[dict[str, Any]]:
    path = tmp_path / "state" / "audit.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


async def new_project(ops: Services) -> ProjectRef:
    result = await ops.operations.create_project(
        title="New",
        processing_path="/data/projects/new",
        data_path="/data/raw/new",
        description="",
        dry_run=False,
    )
    assert result.project_id is not None
    ref = await ops.projects.get(result.project_id)
    await ops.operations.load_template(ref, "mini", allow_duplicate=False, dry_run=False)
    return ref


async def expect(kind: ErrorKind, fragment: str, call: Any) -> EmhubMcpError:
    with pytest.raises(EmhubMcpError) as info:
        await call
    assert info.value.kind is kind, info.value.message
    text = info.value.message + " " + " ".join(info.value.details) + " " + (info.value.hint or "")
    assert fragment in text, text
    return info.value


# ------------------------------------------------------------------ projects


async def test_create_project(ops: Services, fake: FakeEmhub, tmp_path: Path) -> None:
    dry = await ops.operations.create_project(
        title="T", processing_path="/data/p1", data_path="/data/raw", description="", dry_run=True
    )
    assert dry.dry_run and not dry.done and mutations(fake) == []
    done = await ops.operations.create_project(
        title="T",
        processing_path="/data/p1/",
        data_path="/data/raw",
        description="first",
        dry_run=False,
    )
    assert done.done and done.project is not None
    assert done.project.processing_path == "/data/p1" and done.project.access == "owner"
    entry = fake.calls_to("create_entry")[0]["attrs"]
    assert entry["project_id"] == 5  # the admin's existing container
    assert entry["extra"]["data"] == {
        "processing_path": "/data/p1",
        "data_path": "/data/raw",
        "share_table": [],
    }
    await expect(
        ErrorKind.CONFLICT,
        "already uses /data/p1",
        ops.operations.create_project(
            title="T2",
            processing_path="/data/p1",
            data_path="/data/raw",
            description="",
            dry_run=False,
        ),
    )
    assert [a["outcome"] for a in audit(tmp_path)] == ["dry_run", "done", "conflict"]


@pytest.mark.parametrize(
    ("paths", "kind", "fragment"),
    [
        (("/tmp/p", "/data/raw"), ErrorKind.POLICY_DENIED, "outside the folders"),
        (("/data/p", "/etc"), ErrorKind.POLICY_DENIED, "data_path /etc is outside"),
        (("/data/../etc/p", "/data/raw"), ErrorKind.VALIDATION, "must not contain '..'"),
        (("data/p", "/data/raw"), ErrorKind.VALIDATION, "must be an absolute path"),
        (("/dataX/p", "/data/raw"), ErrorKind.POLICY_DENIED, "outside the folders"),
    ],
)
async def test_create_project_paths(
    ops: Services, paths: tuple[str, str], kind: ErrorKind, fragment: str
) -> None:
    await expect(
        kind,
        fragment,
        ops.operations.create_project(
            title="T", processing_path=paths[0], data_path=paths[1], description="", dry_run=True
        ),
    )


async def test_create_project_needs_roots_and_container(make: Any, fake: FakeEmhub) -> None:
    no_roots = make(EMHUB_TOMO_MCP_ALLOWED_ROOTS="")
    await expect(
        ErrorKind.POLICY_DENIED,
        "EMHUB_TOMO_MCP_ALLOWED_ROOTS",
        no_roots.operations.create_project(
            title="T", processing_path="/data/p", data_path="/data/r", description="", dry_run=True
        ),
    )
    read_only = make(EMHUB_TOMO_MCP_ACCESS="read")
    await expect(
        ErrorKind.POLICY_DENIED,
        "read-only",
        read_only.operations.create_project(
            title="T", processing_path="/data/p", data_path="/data/r", description="", dry_run=True
        ),
    )
    carol = make(EMHUB_USER="carol")  # carol has no container yet
    result = await carol.operations.create_project(
        title="Carol's",
        processing_path="/data/carol",
        data_path="/data/r",
        description="",
        dry_run=False,
    )
    assert fake.calls_to("create_project")[0]["attrs"]["user_id"] == 3
    assert result.project is not None and result.project.access == "owner"
    await expect(
        ErrorKind.VALIDATION,
        "control characters",
        carol.operations.create_project(
            title="bad\ttitle",
            processing_path="/data/c2",
            data_path="/data/r",
            description="",
            dry_run=True,
        ),
    )


async def test_load_template(ops: Services, fake: FakeEmhub) -> None:
    created = await ops.operations.create_project(
        title="T", processing_path="/data/p", data_path="/data/r", description="", dry_run=False
    )
    assert created.project_id is not None
    ref = await ops.projects.get(created.project_id)
    dry = await ops.operations.load_template(ref, "mini", allow_duplicate=False, dry_run=True)
    assert "emw-import-ts, emw-warp-mctf, emw-warp-tsalign" in dry.details[0]
    assert "load_workflow" not in mutations(fake)
    done = await ops.operations.load_template(ref, "mini", allow_duplicate=False, dry_run=False)
    assert done.created == ["EMwrap/job001", "WarpMctf/job002", "WarpTsAlign/job003"]
    assert [j.status for j in done.jobs] == ["saved"] * 3
    await expect(
        ErrorKind.CONFLICT,
        "already has jobs of every type",
        ops.operations.load_template(ref, "mini", allow_duplicate=False, dry_run=False),
    )
    fake.load_returns_ids = False  # older EMhub: the new ids come from comparing job lists
    again = await ops.operations.load_template(ref, "mini", allow_duplicate=True, dry_run=False)
    assert again.created == ["EMwrap/job004", "WarpMctf/job005", "WarpTsAlign/job006"]
    await expect(
        ErrorKind.NOT_FOUND,
        "Workflow template 'minni'",
        ops.operations.load_template(ref, "minni", allow_duplicate=False, dry_run=True),
    )


# ------------------------------------------------------------------- editing


async def test_save_job(ops: Services, fake: FakeEmhub) -> None:
    ref = await new_project(ops)
    dry = await ops.operations.save_job(
        ref,
        job_id="WarpMctf/job002",
        job_type=None,
        params={"gpus": 2},
        allow_unknown=False,
        dry_run=True,
    )
    assert dry.details == ["Set gpus = '2'"] and "save_job" not in mutations(fake)
    done = await ops.operations.save_job(
        ref,
        job_id="WarpMctf/job002",
        job_type=None,
        params={"gpus": 1, "queue.name": "cryo"},
        allow_unknown=False,
        dry_run=False,
    )
    assert done.done and fake.params[(ref.id, "WarpMctf/job002")]["gpus"] == "1"
    validate = fake.calls_to("validate_job")[-1]["attrs"]
    assert validate["for_schedule"] is True and validate["run_id"] == "WarpMctf/job002"
    new = await ops.operations.save_job(
        ref,
        job_id=None,
        job_type="emw-warp-mctf",
        params={"gpus": "2"},
        allow_unknown=False,
        dry_run=False,
    )
    assert new.created == ["WarpMctf/job004"] and new.jobs[0].id == "WarpMctf/job004"


async def test_save_job_refusals(ops: Services, fake: FakeEmhub) -> None:
    ref = await ops.projects.get(1)
    for job_id, status in (("WarpMctf/job003", "finished"), ("WarpTsAlign/job004", "running")):
        fake.graphs[1][job_id]["status"] = status
        await expect(
            ErrorKind.CONFLICT,
            f"{job_id} is {status}",
            ops.operations.save_job(
                ref,
                job_id=job_id,
                job_type=None,
                params={"gpus": "1"},
                allow_unknown=False,
                dry_run=True,
            ),
        )
    await expect(
        ErrorKind.VALIDATION,
        "either job_id",
        ops.operations.save_job(
            ref, job_id=None, job_type=None, params={}, allow_unknown=False, dry_run=True
        ),
    )
    await expect(
        ErrorKind.VALIDATION,
        "not a parameter",
        ops.operations.save_job(
            ref,
            job_id="WarpCtfRec/job005",
            job_type=None,
            params={"gpuz": "1"},
            allow_unknown=False,
            dry_run=True,
        ),
    )
    fake.validation_errors = ["Input tilt series: file does not exist."]
    await expect(
        ErrorKind.VALIDATION,
        "Input tilt series",
        ops.operations.save_job(
            ref,
            job_id="WarpCtfRec/job005",
            job_type=None,
            params={"gpus": "1"},
            allow_unknown=False,
            dry_run=False,
        ),
    )
    assert "save_job" not in mutations(fake)
    await expect(
        ErrorKind.NOT_FOUND,
        "Job type 'emw-nope'",
        ops.operations.save_job(
            ref, job_id=None, job_type="emw-nope", params={}, allow_unknown=False, dry_run=True
        ),
    )


async def test_save_job_without_emhub_validation(ops: Services, fake: FakeEmhub) -> None:
    fake.has_validate = False
    ref = await ops.projects.get(1)
    result = await ops.operations.save_job(
        ref,
        job_id="WarpCtfRec/job005",
        job_type=None,
        params={"gpus": "1"},
        allow_unknown=False,
        dry_run=False,
    )
    assert result.done and "only the form was checked" in result.warnings[0]


async def test_access_rights(make: Any, fake: FakeEmhub) -> None:
    carol = make(EMHUB_USER="carol")
    viewer_ref = await carol.projects.get(2)  # shared view-only
    await expect(
        ErrorKind.POLICY_DENIED,
        "right on project 2 is 'viewer'",
        carol.operations.annotate_job(viewer_ref, "X/job001", run_name="x", comment=None),
    )
    fake.graphs[3]["EMwrap/job001"] = {
        "id": "EMwrap/job001",
        "type": "emw-import-ts",
        "status": "saved",
        "parents": ["PROJECT"],
        "children": [],
    }
    editor_ref = await carol.projects.get(3)  # shared as editor
    await carol.operations.annotate_job(editor_ref, "EMwrap/job001", run_name="ok", comment=None)
    await expect(
        ErrorKind.POLICY_DENIED,
        "right on project 3 is 'editor'",
        carol.operations.delete_jobs(editor_ref, ["EMwrap/job001"], dry_run=True),
    )
    operate = make(EMHUB_TOMO_MCP_ACCESS="operate")
    own = await operate.projects.get(1)
    await expect(
        ErrorKind.POLICY_DENIED,
        "access level is 'operate'",
        operate.operations.delete_jobs(own, ["WarpTsAlign/job004"], dry_run=True),
    )
    await expect(
        ErrorKind.POLICY_DENIED,
        "clean folder",
        operate.operations.run_job(
            own, "WarpTsAlign/job004", params={}, rerun=False, clean=True, dry_run=True
        ),
    )


# ------------------------------------------------------------------- running


async def test_run_job_applies_default_queue(
    ops: Services, fake: FakeEmhub, tmp_path: Path
) -> None:
    ref = await new_project(ops)
    dry = await ops.operations.run_job(
        ref, "WarpMctf/job002", params={}, rerun=False, clean=False, dry_run=True
    )
    assert "on queue 'cryo', 2 GPU(s)" in dry.details[0]
    assert "using the default queue 'cryo'" in dry.warnings[0]
    assert fake.launched == []
    done = await ops.operations.run_job(
        ref, "WarpMctf/job002", params={"gpus": "1"}, rerun=False, clean=False, dry_run=False
    )
    assert done.jobs[0].status == "launched"
    assert fake.launched[-1] == (
        ref.id,
        "WarpMctf/job002",
        {"gpus": "1", "queue.name": "cryo"},
        False,
    )
    await expect(
        ErrorKind.CONFLICT,
        "already launched",
        ops.operations.run_job(
            ref, "WarpMctf/job002", params={}, rerun=False, clean=False, dry_run=True
        ),
    )
    entry = audit(tmp_path)[-2]
    assert entry["action"] == "run_job" and entry["outcome"] == "done"
    assert entry["jobs"] == ["WarpMctf/job002:launched"]


async def test_run_job_cpu_job_runs_locally(ops: Services, fake: FakeEmhub) -> None:
    ref = await new_project(ops)
    done = await ops.operations.run_job(
        ref, "EMwrap/job001", params={}, rerun=False, clean=False, dry_run=False
    )
    assert done.done and fake.launched[-1][2] == {}  # no queue imposed on a CPU job


async def test_gpu_jobs_need_a_cluster_queue(make: Any) -> None:
    no_default = make(EMHUB_TOMO_MCP_DEFAULT_QUEUE="")
    ref = await new_project(no_default)
    await expect(
        ErrorKind.POLICY_DENIED,
        "would run on the EMhub host",
        no_default.operations.run_job(
            ref, "WarpMctf/job002", params={}, rerun=False, clean=False, dry_run=True
        ),
    )
    await expect(
        ErrorKind.POLICY_DENIED,
        "queue 'None'",
        no_default.operations.run_job(
            ref,
            "WarpMctf/job002",
            params={"queue.name": "None"},
            rerun=False,
            clean=False,
            dry_run=True,
        ),
    )
    local = make(EMHUB_TOMO_MCP_DEFAULT_QUEUE="", EMHUB_TOMO_MCP_ALLOW_LOCAL_GPU="true")
    ref2 = await local.projects.get(ref.id)
    result = await local.operations.run_job(
        ref2, "WarpMctf/job002", params={}, rerun=False, clean=False, dry_run=True
    )
    assert "on queue 'None'" in result.details[0]
    wrong = make(EMHUB_TOMO_MCP_DEFAULT_QUEUE="phys-z")
    ref3 = await wrong.projects.get(ref.id)
    await expect(
        ErrorKind.VALIDATION,
        "default queue 'phys-z' is not configured",
        wrong.operations.run_job(
            ref3, "WarpMctf/job002", params={}, rerun=False, clean=False, dry_run=True
        ),
    )


async def test_gpu_limits(make: Any, fake: FakeEmhub) -> None:
    svc = make(EMHUB_TOMO_MCP_MAX_GPUS_PER_JOB="2", EMHUB_TOMO_MCP_MAX_ACTIVE_GPU_JOBS="1")
    ref = await new_project(svc)
    await expect(
        ErrorKind.POLICY_DENIED,
        "asks for 3 GPUs; the limit is 2",
        svc.operations.run_job(
            ref, "WarpMctf/job002", params={"gpus": "3"}, rerun=False, clean=False, dry_run=True
        ),
    )
    fake.graphs[1]["WarpTsAlign/job004"]["status"] = "running"  # a GPU job elsewhere
    await expect(
        ErrorKind.POLICY_DENIED,
        "At most 1 GPU jobs may run at once; 1 are active (1:WarpTsAlign/job004)",
        svc.operations.run_job(
            ref, "WarpMctf/job002", params={}, rerun=False, clean=False, dry_run=True
        ),
    )
    fake.graphs[1]["WarpTsAlign/job004"]["status"] = "failed"
    await svc.operations.run_job(
        ref, "WarpMctf/job002", params={}, rerun=False, clean=False, dry_run=False
    )


async def test_relion_jobs_use_gpu_ids(make: Any, fake: FakeEmhub) -> None:
    """RELION's forms give GPUs as gpu_ids (emwrap ignores their 'gpus'): such jobs need a
    cluster queue too, and count their distinct ids against the limits."""
    no_default = make(EMHUB_TOMO_MCP_DEFAULT_QUEUE="")
    ref = await new_project(no_default)
    form = fake.form_for("emw-import-ts")  # the default form without 'gpus'
    form["sections"][0]["params"] += [
        {"name": "use_gpu", "label": "Use GPU acceleration?", "paramClass": "BooleanParam"},
        {"name": "gpu_ids", "label": "Which GPUs to use:", "paramClass": "StringParam"},
    ]
    fake.forms["emw-warp-tsalign"] = form
    job = "WarpTsAlign/job003"
    fake.params[(ref.id, job)] = {"use_gpu": "Yes", "gpu_ids": "0:1", "gpus": "4"}
    await expect(
        ErrorKind.POLICY_DENIED,
        "would run on the EMhub host",
        no_default.operations.run_job(ref, job, params={}, rerun=False, clean=False, dry_run=True),
    )
    limited = make(EMHUB_TOMO_MCP_MAX_GPUS_PER_JOB="3")
    ref2 = await limited.projects.get(ref.id)
    dry = await limited.operations.run_job(
        ref2, job, params={}, rerun=False, clean=False, dry_run=True
    )
    assert "on queue 'cryo', 2 GPU(s)" in dry.details[0]  # 'gpus' = 4 is not what counts
    await expect(
        ErrorKind.POLICY_DENIED,
        "asks for 4 GPUs; the limit is 3",
        limited.operations.run_job(
            ref2, job, params={"gpu_ids": "0:1:2:3"}, rerun=False, clean=False, dry_run=True
        ),
    )
    plan = await limited.operations.schedule_jobs(
        ref2, [job], interval_minutes=5, rerun=False, dry_run=True
    )
    assert f"{job}: queue 'cryo', 2 GPU(s)." in plan.details
    # Without GPUs, it is a CPU job and may run on the EMhub host.
    fake.params[(ref.id, job)] = {"use_gpu": "No", "gpu_ids": ""}
    cpu = await no_default.operations.run_job(
        ref, job, params={}, rerun=False, clean=False, dry_run=True
    )
    assert "on queue 'None', no GPUs" in cpu.details[0]


async def test_launch_rate_limit(make: Any) -> None:
    svc = make(EMHUB_TOMO_MCP_MAX_LAUNCHES_PER_HOUR="1")
    ref = await new_project(svc)
    await svc.operations.run_job(
        ref, "EMwrap/job001", params={}, rerun=False, clean=False, dry_run=True
    )  # dry runs do not count
    await svc.operations.run_job(
        ref, "EMwrap/job001", params={}, rerun=False, clean=False, dry_run=False
    )
    await expect(
        ErrorKind.POLICY_DENIED,
        "at most 1 launches per hour",
        svc.operations.run_job(
            ref, "WarpMctf/job002", params={}, rerun=False, clean=False, dry_run=True
        ),
    )


async def test_rerun_and_validation_order(ops: Services, fake: FakeEmhub) -> None:
    ref = await ops.projects.get(1)
    await expect(
        ErrorKind.CONFLICT,
        "already finished",
        ops.operations.run_job(
            ref, "WarpMctf/job003", params={}, rerun=False, clean=False, dry_run=True
        ),
    )
    rerun = await ops.operations.run_job(
        ref, "WarpMctf/job003", params={}, rerun=True, clean=True, dry_run=True
    )
    assert "Move the current job folder" in rerun.details[-1]
    fake.validation_errors = ["Input tilt series: missing"]
    # The policy refusal comes before EMhub's validation.
    await expect(
        ErrorKind.POLICY_DENIED,
        "queue 'None'",
        ops.operations.run_job(
            ref,
            "WarpCtfRec/job005",
            params={"queue.name": "None"},
            rerun=False,
            clean=False,
            dry_run=True,
        ),
    )
    await expect(
        ErrorKind.VALIDATION,
        "Input tilt series: missing",
        ops.operations.run_job(
            ref, "WarpCtfRec/job005", params={}, rerun=False, clean=False, dry_run=True
        ),
    )


async def test_launch_timeout_reports_status(ops: Services, fake: FakeEmhub) -> None:
    ref = await new_project(ops)

    def slow(request: httpx2.Request) -> httpx2.Response:
        fake.graphs[ref.id]["EMwrap/job001"]["status"] = "launched"  # it did start
        raise httpx2.ReadTimeout("slow")

    fake.fail["launch_job"] = slow
    error = await expect(
        ErrorKind.UNREACHABLE,
        "Current status: EMwrap/job001: launched",
        ops.operations.run_job(
            ref, "EMwrap/job001", params={}, rerun=False, clean=False, dry_run=False
        ),
    )
    assert "avoid doing it twice" in (error.hint or "")
    assert len(fake.calls_to("launch_job")) == 1  # never retried


async def test_schedule_jobs(ops: Services, fake: FakeEmhub) -> None:
    ref = await new_project(ops)
    result = await ops.operations.schedule_jobs(
        ref,
        ["WarpTsAlign/job003", "WarpMctf/job002", "EMwrap/job001"],
        interval_minutes=2,
        rerun=False,
        dry_run=False,
    )
    scheduled = [b["attrs"]["run_id"] for b in fake.calls_to("schedule_job")]
    assert scheduled == ["EMwrap/job001", "WarpMctf/job002", "WarpTsAlign/job003"]
    assert all(b["attrs"]["interval"] == 2 for b in fake.calls_to("schedule_job"))
    # The default queue is saved on the GPU jobs before scheduling them.
    saved = {b["attrs"]["run_id"]: b["attrs"]["params"] for b in fake.calls_to("save_job")}
    assert saved == {
        "WarpMctf/job002": {"queue.name": "cryo"},
        "WarpTsAlign/job003": {"queue.name": "cryo"},
    }
    assert [j.status for j in result.jobs] == ["scheduled"] * 3
    stopped = await ops.operations.stop_jobs(ref, ["WarpTsAlign/job003"])
    assert stopped.jobs[0].status == "saved"


async def test_schedule_counts_parallel_gpu_jobs(make: Any, fake: FakeEmhub) -> None:
    svc = make(EMHUB_TOMO_MCP_MAX_ACTIVE_GPU_JOBS="1")
    ref = await new_project(svc)
    # A chain of GPU jobs runs one after the other: it counts once.
    dry = await svc.operations.schedule_jobs(
        ref,
        ["WarpMctf/job002", "WarpTsAlign/job003"],
        interval_minutes=5,
        rerun=False,
        dry_run=True,
    )
    assert dry.dry_run
    # Two independent GPU jobs could run at the same time.
    copy = await svc.operations.duplicate_jobs(ref, ["WarpMctf/job002"])
    await expect(
        ErrorKind.POLICY_DENIED,
        "At most 1 GPU jobs may run at once",
        svc.operations.schedule_jobs(
            ref, ["WarpMctf/job002", copy.created[0]], interval_minutes=5, rerun=False, dry_run=True
        ),
    )


async def test_stop_jobs(ops: Services, fake: FakeEmhub) -> None:
    ref = await ops.projects.get(1)
    await expect(
        ErrorKind.CONFLICT,
        "only scheduled, launched or running",
        ops.operations.stop_jobs(ref, ["WarpMctf/job003"]),
    )
    fake.graphs[1]["WarpCtfRec/job005"]["status"] = "running"
    result = await ops.operations.stop_jobs(ref, ["WarpCtfRec/job005"])
    assert result.jobs[0].status == "aborted"


# ------------------------------------------------------------- housekeeping


async def test_annotate_and_tag(ops: Services, fake: FakeEmhub) -> None:
    ref = await ops.projects.get(1)
    await ops.operations.annotate_job(
        ref, "WarpMctf/job003", run_name=None, comment="line 1\nline 2"
    )
    node = fake.graphs[1]["WarpMctf/job003"]
    assert node["runName"] == "Motion and CTF" and node["comment"] == "line 1\nline 2"
    await expect(
        ErrorKind.VALIDATION,
        "control characters",
        ops.operations.annotate_job(ref, "WarpMctf/job003", run_name="a\tb", comment=None),
    )
    result = await ops.operations.tag_jobs(
        ref, ["WarpMctf/job003", "EMwrap/job001"], add=["good", "check"], remove=[]
    )
    assert result.details[-1] == "New labels created: check."
    labels = fake.labels[1]
    new_id = next(lbl["id"] for lbl in labels["labels"] if lbl["name"] == "check")
    assert labels["jobs"]["EMwrap/job001"] == ["lbl-1", new_id]
    await ops.operations.tag_jobs(ref, ["WarpMctf/job003"], add=[], remove=["good"])
    assert labels["jobs"]["WarpMctf/job003"] == [new_id]
    await expect(
        ErrorKind.NOT_FOUND,
        "Job 'WarpMctf/job030'",
        ops.operations.tag_jobs(ref, ["WarpMctf/job030"], add=["x"], remove=[]),
    )


async def test_duplicate_export_delete(ops: Services, fake: FakeEmhub) -> None:
    ref = await new_project(ops)
    copy = await ops.operations.duplicate_jobs(ref, ["WarpMctf/job002"])
    assert copy.created == ["WarpMctf/job004"] and copy.details[0] == (
        "WarpMctf/job002 -> WarpMctf/job004"
    )
    await ops.operations.export_workflow(
        ref, ["EMwrap/job001"], file_name="mine.json", overwrite=False
    )
    assert "mine.json" in fake.files["/data/projects/new"]["."]
    await expect(
        ErrorKind.CONFLICT,
        "already exists",
        ops.operations.export_workflow(
            ref, ["EMwrap/job001"], file_name="mine.json", overwrite=False
        ),
    )
    await ops.operations.export_workflow(
        ref, ["EMwrap/job001"], file_name="mine.json", overwrite=True
    )
    for name in ("../x.json", "x.txt", "/abs.json", "a b.json"):
        await expect(
            ErrorKind.VALIDATION,
            "plain file name",
            ops.operations.export_workflow(ref, ["EMwrap/job001"], file_name=name, overwrite=True),
        )
    await expect(
        ErrorKind.CONFLICT,
        "WarpTsAlign/job003",
        ops.operations.delete_jobs(ref, ["WarpMctf/job002"], dry_run=True),
    )
    dry = await ops.operations.delete_jobs(
        ref, ["WarpMctf/job002", "WarpTsAlign/job003"], dry_run=True
    )
    assert dry.dry_run and "delete_jobs" not in mutations(fake)
    done = await ops.operations.delete_jobs(
        ref, ["WarpTsAlign/job003", "WarpMctf/job002"], dry_run=False
    )
    assert [j.status for j in done.jobs] == ["deleted", "deleted"]
    fake.graphs[ref.id]["EMwrap/job001"]["status"] = "running"
    await expect(
        ErrorKind.CONFLICT,
        "Stop it",
        ops.operations.delete_jobs(ref, ["EMwrap/job001"], dry_run=True),
    )


async def test_every_attempt_is_audited(ops: Services, tmp_path: Path) -> None:
    ref = await ops.projects.get(1)
    with pytest.raises(EmhubMcpError):
        await ops.operations.stop_jobs(ref, ["WarpMctf/job003"])
    await ops.operations.annotate_job(ref, "WarpMctf/job003", run_name="r", comment=None)
    entries = audit(tmp_path)
    assert [(e["action"], e["outcome"]) for e in entries] == [
        ("stop_jobs", "conflict"),
        ("annotate_job", "done"),
    ]
    assert all(e["user"] == "admin" and e["project_id"] == 1 for e in entries)
