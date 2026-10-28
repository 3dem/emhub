# SPDX-License-Identifier: GPL-3.0-or-later
"""The change tools through the MCP protocol: which exist per level, and how they answer."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from fake_emhub import FakeEmhub
from mcp import Client
from mcp.types import CallToolResult

from emhub_tomo_mcp.server import build_server

pytestmark = pytest.mark.anyio

SNAPSHOT = Path(__file__).parent / "tools_snapshot_admin.json"
READ_TOOLS = 13
OPERATE_TOOLS = [
    "create_project",
    "load_workflow_template",
    "save_job",
    "run_job",
    "schedule_jobs",
    "stop_jobs",
    "annotate_job",
    "tag_jobs",
    "duplicate_jobs",
    "export_workflow",
]


@pytest.fixture
def server_for(services_for: Any, tmp_path: Path) -> Any:
    def make(access: str, **env: str) -> Any:
        return build_server(
            services_for(
                EMHUB_TOMO_MCP_ACCESS=access,
                EMHUB_TOMO_MCP_ALLOWED_ROOTS="/data",
                EMHUB_TOMO_MCP_DEFAULT_QUEUE="cryo",
                EMHUB_TOMO_MCP_STATE_DIR=str(tmp_path),
                **env,
            )
        )

    return make


def _text(result: CallToolResult) -> str:
    return "".join(getattr(c, "text", "") for c in result.content)


@pytest.mark.parametrize(
    ("access", "expected"),
    [("read", []), ("operate", OPERATE_TOOLS), ("admin", [*OPERATE_TOOLS, "delete_jobs"])],
)
async def test_tools_per_level(server_for: Any, access: str, expected: list[str]) -> None:
    async with Client(server_for(access)) as c:
        tools = (await c.list_tools()).tools
        assert [t.name for t in tools][READ_TOOLS:] == expected
        for tool in tools[READ_TOOLS:]:
            a = tool.annotations
            assert a is not None and a.read_only_hint is False and a.open_world_hint is False
            assert a.destructive_hint is (tool.name in ("run_job", "stop_jobs", "delete_jobs"))
            assert tool.output_schema
        prompts = {p.name for p in (await c.list_prompts()).prompts}
        assert ("setup_preprocessing" in prompts) is (access != "read")
        instructions = c.instructions or ""
        assert ("Changing things" in instructions) is (access != "read")
        assert ("This server cannot change anything" in instructions) is (access == "read")


async def test_admin_snapshot(server_for: Any) -> None:
    """Run with UPDATE_SNAPSHOTS=1 to accept an intended change, then review the diff."""
    async with Client(server_for("admin")) as c:
        current = [
            t.model_dump(mode="json", exclude_none=True) for t in (await c.list_tools()).tools
        ]
    if os.environ.get("UPDATE_SNAPSHOTS"):
        SNAPSHOT.write_text(json.dumps(current, indent=1, sort_keys=True) + "\n")
    assert json.loads(SNAPSHOT.read_text()) == current


async def test_change_tools_end_to_end(server_for: Any, fake: FakeEmhub) -> None:
    async with Client(server_for("admin")) as c:
        schemas = {t.name: t.output_schema for t in (await c.list_tools()).tools}

        async def call(tool: str, **args: Any) -> dict[str, Any]:
            result = await c.call_tool(tool, args)
            assert not result.is_error, _text(result)
            jsonschema.validate(result.structured_content, schemas[tool])
            summary = _text(result).split("\n", 1)[0]
            assert summary.startswith(("Done:", "Dry run:")), summary
            assert result.structured_content is not None
            return result.structured_content

        created = await call(
            "create_project", title="P", processing_path="/data/p", data_path="/data/raw"
        )
        pid = created["project_id"]
        loaded = await call("load_workflow_template", project_id=pid, workflow_id="mini")
        imp, mctf, ali = loaded["created"]
        await call("save_job", project_id=pid, job_id=mctf, params={"gpus": "1"})
        await call("save_job", project_id=pid, job_type="emw-warp-mctf", params={}, dry_run=True)
        await call("run_job", project_id=pid, job_id=imp)
        await call("schedule_jobs", project_id=pid, job_ids=[mctf, ali], dry_run=True)
        await call("schedule_jobs", project_id=pid, job_ids=[mctf, ali])
        await call("stop_jobs", project_id=pid, job_ids=[ali])
        await call("annotate_job", project_id=pid, job_id=imp, run_name="first")
        await call("tag_jobs", project_id=pid, job_ids=[imp], add=["ok"])
        copy = await call("duplicate_jobs", project_id=pid, job_ids=[ali])
        await call("export_workflow", project_id=pid, job_ids=[imp], file_name="x.json")
        await call("delete_jobs", project_id=pid, job_ids=copy["created"])
        detail = (await c.call_tool("get_project", {"project_id": pid})).structured_content
        assert detail is not None
        statuses = {j["id"]: j["status"] for j in detail["jobs"]}
        assert statuses == {imp: "launched", mctf: "scheduled", ali: "saved"}


@pytest.mark.parametrize(
    ("tool", "args", "fragment"),
    [
        ("run_job", {"project_id": 1, "job_id": "WarpMctf/job003"}, "[conflict]"),
        (
            "run_job",
            {"project_id": 1, "job_id": "WarpCtfRec/job005", "params": {"queue.name": "None"}},
            "[policy_denied]",
        ),
        (
            "save_job",
            {"project_id": 1, "job_id": "WarpCtfRec/job005", "params": {"queue.name": "x\ny"}},
            "[validation]",
        ),
        (
            "create_project",
            {"title": "t", "processing_path": "/etc/x", "data_path": "/data/r"},
            "[policy_denied]",
        ),
        ("delete_jobs", {"project_id": 1, "job_ids": ["EMwrap/job001"]}, "[conflict]"),
    ],
)
async def test_change_errors(
    server_for: Any, tool: str, args: dict[str, Any], fragment: str
) -> None:
    async with Client(server_for("admin")) as c:
        result = await c.call_tool(tool, args)
        assert result.is_error and fragment in _text(result) and "(ref " in _text(result)


async def test_write_tools_absent_at_read_level(server_for: Any) -> None:
    async with Client(server_for("read")) as c:
        result = await c.call_tool("run_job", {"project_id": 1, "job_id": "EMwrap/job001"})
        assert result.is_error and "Unknown tool" in _text(result)
