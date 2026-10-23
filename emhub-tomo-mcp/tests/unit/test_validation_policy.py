# SPDX-License-Identifier: GPL-3.0-or-later
"""Parameter checks against forms; access levels, launch limits, locks, audit log."""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import Any

import pytest
from fake_emhub import recorded

from emhub_tomo_mcp.domain.validation import form_params, job_gpus, validate_params
from emhub_tomo_mcp.errors import EmhubMcpError, ErrorKind
from emhub_tomo_mcp.policy import (
    AuditLog,
    LaunchLimiter,
    ProjectLocks,
    effective_level,
    require_level,
)

FORM = recorded("18_get_session_run_form_new_job_type")["run"]["form"]
TABLE_FORM = {
    "sections": [
        {
            "label": "S",
            "params": [
                {"name": "sources", "paramClass": "TableParam"},
                {"name": "inputs", "paramClass": "MultiPointerParam"},
                {"name": "flag", "paramClass": "BooleanParam"},
            ],
        }
    ]
}


def test_form_params() -> None:
    spec = form_params(FORM)
    assert spec["queue.name"].choices == ("None", "cryo", "cryo_core", "rtx5000")
    assert spec["queue.param.cryo.queue_name"].hidden
    assert spec["fs_motion_and_ctf.c_range_min"].kind == "FloatParam"
    assert "gpus" in spec


def test_valid_values_are_normalized() -> None:
    clean, errors = validate_params(
        FORM,
        {
            "gpus": 3,
            "fs_motion_and_ctf.c_range_min": 25.5,
            "fs_motion_and_ctf.perdevice": "2",
            "queue.name": "cryo",
            "queue.param.cryo.gpu_type": "A100",
            "input_tiltseries": "EMwrap/job001/tilt_series.star",
        },
    )
    assert errors == []
    assert clean == {
        "gpus": "3",
        "fs_motion_and_ctf.c_range_min": "25.5",
        "fs_motion_and_ctf.perdevice": "2",
        "queue.name": "cryo",
        "queue.param.cryo.gpu_type": "A100",
        "input_tiltseries": "EMwrap/job001/tilt_series.star",
    }


@pytest.mark.parametrize(
    ("params", "fragment"),
    [
        ({"fs_motion_and_ctf.perdevice": "2.5"}, "must be a whole number"),
        ({"fs_motion_and_ctf.c_range_min": "fast"}, "must be a number"),
        ({"queue.name": "gpu-big"}, "must be one of: None, cryo"),
        ({"queue.name": "cryo\nsrun rm"}, "control characters"),
        ({"queue.param.cryo.gpu_type": "H100"}, "must be one of"),
        ({"queue.param.cryo.queue_name": "x"}, "internal parameter"),
        ({"queue.param.cryo.extra": "x"}, "not a parameter"),
        ({"gpu": "3"}, "did you mean gpus"),
        ({"bad name!": "x"}, "not a valid parameter name"),
        ({"gpus": ["3"]}, "must be text or a number"),
        ({"gpus": None}, "must be text or a number"),
        ({"input_tiltseries": "x" * 5000}, "longer than 4096"),
        ({"input_tiltseries": "a\x00b"}, "control characters"),
    ],
)
def test_invalid_values(params: dict[str, Any], fragment: str) -> None:
    clean, errors = validate_params(FORM, params)
    assert clean == {} and len(errors) == 1 and fragment in errors[0], errors


def test_unknown_names_when_allowed() -> None:
    clean, errors = validate_params(
        FORM, {"extra.option": "1", "queue.param.x.y": "z"}, allow_unknown=True
    )
    assert clean == {"extra.option": "1"}
    assert errors and "queue.param.x.y" in errors[0]  # never for queue parameters


def test_queue_values_without_choices() -> None:
    form = {
        "sections": [
            {
                "label": "Q",
                "params": [
                    {"name": "queue.name", "paramClass": "EnumParam", "choices": ["None", "slurm"]},
                    {"name": "queue.param.slurm.account", "paramClass": "StringParam"},
                ],
            }
        ]
    }
    assert validate_params(form, {"queue.param.slurm.account": "mbp_x-1"})[1] == []
    for value in ("a b", "x;y", "$(id)", "`id`", "a'b", 'a"b', "a|b"):
        _, errors = validate_params(form, {"queue.param.slurm.account": value})
        assert errors and "may only contain" in errors[0], value


def test_table_bool_and_paths() -> None:
    clean, errors = validate_params(
        TABLE_FORM,
        {
            "sources": [{"name": "ApoF", "warp_folder": "WarpExportParticles/job007"}],
            "inputs": ["a.star", "b.star"],
            "flag": "yes",
        },
    )
    assert errors == [] and clean["flag"] is True and clean["inputs"] == ["a.star", "b.star"]
    for params, fragment in [
        ({"sources": "ApoF"}, "list of rows"),
        ({"sources": [{"name": {"nested": 1}}]}, "table cells"),
        ({"sources": [{"name": "a\nb"}]}, "control characters"),
        ({"inputs": [1, 2]}, "list of paths"),
        ({"flag": "maybe"}, "true or false"),
    ]:
        _, errors = validate_params(TABLE_FORM, params)
        assert errors and fragment in errors[0], params


@pytest.mark.parametrize(
    ("params", "count"),
    [
        # emwrap's 'gpus': a count, or ids (distinct ids count, as emwrap counts them)
        ({"gpus": "3"}, 3),
        ({"gpus": 3}, 3),
        ({"gpus": "0,1,2"}, 3),
        ({"gpus": "0 1"}, 2),
        ({"gpus": "0 0 1"}, 2),
        ({"gpus": "0,1 2,3"}, 4),
        ({"gpus": '"2"'}, 1),
        # empty, zero or unreadable: one, to stay on the safe side
        ({"gpus": ""}, 1),
        ({"gpus": "0"}, 1),
        ({"gpus": "all"}, 1),
        ({}, 1),
        # RELION's gpu_ids win over 'gpus', which emwrap ignores for these jobs
        ({"gpu_ids": "0:1", "gpus": "4", "use_gpu": "Yes"}, 2),
        ({"gpu_ids": "0,1:0,1"}, 2),
        ({"gpu_ids": "", "use_gpu": "No"}, 0),
        ({"use_gpu": "Yes"}, 1),
    ],
)
def test_job_gpus(params: dict[str, Any], count: int) -> None:
    assert job_gpus(params) == count


@pytest.mark.parametrize(
    ("configured", "right", "level"),
    [
        ("admin", "owner", "admin"),
        ("operate", "owner", "operate"),
        ("read", "owner", "read"),
        ("admin", "editor", "operate"),
        ("admin", "viewer", "read"),
        ("admin", "admin", "admin"),
        ("operate", "admin", "operate"),
    ],
)
def test_effective_level(configured: Any, right: Any, level: str) -> None:
    assert effective_level(configured, right) == level


def test_require_level_messages() -> None:
    require_level("operate", "editor", "operate", 3, "run jobs")
    with pytest.raises(EmhubMcpError) as info:
        require_level("operate", "viewer", "operate", 3, "run jobs")
    assert info.value.kind is ErrorKind.POLICY_DENIED and "right on project 3 is 'viewer'" in (
        info.value.hint or ""
    )
    with pytest.raises(EmhubMcpError) as info:
        require_level("operate", "owner", "admin", 3, "delete jobs")
    assert "access level is 'operate'" in (info.value.hint or "")


def test_launch_limiter() -> None:
    now = [1000.0]
    limiter = LaunchLimiter(3, clock=lambda: now[0])
    limiter.check(3)
    limiter.record(2)
    limiter.check(1)
    with pytest.raises(EmhubMcpError) as info:
        limiter.check(2)
    assert "at most 3 launches per hour" in info.value.message
    limiter.record(1)
    now[0] += 1800
    with pytest.raises(EmhubMcpError) as info:
        limiter.check(1)
    assert "about 30 min" in (info.value.hint or "")
    now[0] += 1801
    limiter.check(3)


def test_project_locks() -> None:
    locks = ProjectLocks()
    assert locks(1) is locks(1) and locks(1) is not locks(2)


def test_audit_log(tmp_path: Path) -> None:
    log = AuditLog(str(tmp_path / "state"), lambda: "alice")
    log.write(action="run_job", project_id=3, args={"job_id": "X/job001"}, outcome="done")
    log.write(action="stop_jobs", project_id=3, args={}, outcome="conflict", detail="saved")
    lines = (tmp_path / "state" / "audit.jsonl").read_text().splitlines()
    first = json.loads(lines[0])
    assert first["user"] == "alice" and first["action"] == "run_job" and first["time"]
    assert json.loads(lines[1])["outcome"] == "conflict"
    assert stat.S_IMODE(os.stat(tmp_path / "state").st_mode) == 0o700
    assert stat.S_IMODE(os.stat(tmp_path / "state" / "audit.jsonl").st_mode) == 0o600


def test_audit_log_never_breaks_a_change(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("not a folder")
    AuditLog(str(blocker), lambda: "u").write(action="x")
    assert "Cannot write the audit log" in caplog.text
