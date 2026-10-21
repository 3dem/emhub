# SPDX-License-Identifier: GPL-3.0-or-later
"""The MCP surface, through an in-memory client against the fake EMhub."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from fake_emhub import FakeEmhub
from mcp import Client
from mcp.types import CallToolResult, ImageContent, TextContent

from emhub_tomo_mcp.server import build_server
from emhub_tomo_mcp.services import Services

pytestmark = pytest.mark.anyio

SNAPSHOT = Path(__file__).parent / "tools_snapshot.json"

EXPECTED_TOOLS = [
    "get_server_status",
    "list_projects",
    "get_project",
    "get_job",
    "get_job_logs",
    "wait_for_jobs",
    "list_job_types",
    "describe_job_type",
    "list_workflow_templates",
    "list_project_files",
    "read_project_file",
]

HAPPY_CALLS: list[tuple[str, dict[str, Any]]] = [
    ("get_server_status", {}),
    ("list_projects", {}),
    ("list_projects", {"scope": "all", "include_job_counts": True, "limit": 2}),
    ("get_project", {"project_id": 1}),
    ("get_project", {"project_id": 1, "statuses": ["failed"], "job_types": ["emw-warp-tsalign"]}),
    ("get_job", {"project_id": 1, "job_id": "WarpTsAlign/job004", "log_tail_lines": 5}),
    ("get_job_logs", {"project_id": 1, "job_id": "WarpTsAlign/job004"}),
    (
        "get_job_logs",
        {
            "project_id": 1,
            "job_id": "WarpTsAlign/job004",
            "streams": ["job_log"],
            "contains": "batch",
        },
    ),
    ("wait_for_jobs", {"project_id": 1, "job_ids": ["EMwrap/job001"], "timeout_s": 5}),
    ("list_job_types", {}),
    ("list_job_types", {"include_hidden": True}),
    ("describe_job_type", {"job_type": "emw-warp-mctf"}),
    ("describe_job_type", {"job_type": "emw-warp-mctf", "project_id": 1, "detail": "full"}),
    ("list_workflow_templates", {}),
    ("list_project_files", {"project_id": 1}),
    ("list_project_files", {"project_id": 1, "path": "WarpMctf/job003", "pattern": "*.star"}),
    ("read_project_file", {"project_id": 1, "path": "notes.txt"}),
    ("read_project_file", {"project_id": 1, "path": "notes.txt", "tail_lines": 1}),
    ("read_project_file", {"project_id": 1, "path": "WarpMctf/job003/preview.mrc"}),
]


@pytest.fixture
async def client(services: Services) -> AsyncIterator[Client]:
    async with Client(build_server(services)) as c:
        yield c


def _text(result: CallToolResult) -> str:
    first = result.content[0]
    assert isinstance(first, TextContent)
    return first.text


async def _schemas(client: Client) -> dict[str, Any]:
    return {t.name: t for t in (await client.list_tools()).tools}


async def test_tool_list(client: Client) -> None:
    tools = (await client.list_tools()).tools
    assert [t.name for t in tools] == EXPECTED_TOOLS
    for tool in tools:
        assert tool.title and tool.description and tool.output_schema, tool.name
        a = tool.annotations
        assert a is not None
        assert (a.read_only_hint, a.destructive_hint, a.idempotent_hint, a.open_world_hint) == (
            True,
            False,
            True,
            False,
        ), tool.name


async def test_tool_snapshot(client: Client) -> None:
    """Names, descriptions and schemas change only on purpose:
    run with UPDATE_SNAPSHOTS=1 to accept a change, and review the diff."""
    current = [
        t.model_dump(mode="json", exclude_none=True) for t in (await client.list_tools()).tools
    ]
    if os.environ.get("UPDATE_SNAPSHOTS"):
        SNAPSHOT.write_text(json.dumps(current, indent=1, sort_keys=True) + "\n")
    assert json.loads(SNAPSHOT.read_text()) == current


@pytest.mark.parametrize(("name", "args"), HAPPY_CALLS)
async def test_happy_paths(client: Client, name: str, args: dict[str, Any]) -> None:
    result = await client.call_tool(name, args)
    assert not result.is_error, _text(result)
    schema = (await _schemas(client))[name].output_schema
    jsonschema.validate(result.structured_content, schema)
    summary, _, payload = _text(result).partition("\n")
    assert summary and json.loads(payload) == result.structured_content
    assert len(_text(result)) < 32_000


async def test_image_preview(client: Client) -> None:
    result = await client.call_tool(
        "read_project_file",
        {"project_id": 1, "path": "WarpMctf/job003/preview.mrc", "as_image": True},
    )
    assert not result.is_error
    image = result.content[1]
    assert isinstance(image, ImageContent) and image.mime_type == "image/png"
    assert result.structured_content is not None
    assert result.structured_content["image"] == {"name": "WarpMctf/job003/preview.mrc"}


@pytest.mark.parametrize(
    ("name", "args", "fragment"),
    [
        ("get_project", {"project_id": 99}, "[not_found] Project 99 not found"),
        ("get_job", {"project_id": 1, "job_id": "WarpMctf/job030"}, "[not_found]"),
        ("read_project_file", {"project_id": 1, "path": "../../etc/passwd"}, "[validation]"),
        (
            "read_project_file",
            {"project_id": 1, "path": "notes.txt", "tail_lines": 2, "head_lines": 2},
            "[validation]",
        ),
        ("list_projects", {"cursor": "garbage"}, "[validation] Invalid cursor"),
        ("describe_job_type", {"job_type": "emw-nope"}, "[not_found] Job type 'emw-nope'"),
    ],
)
async def test_tool_errors(client: Client, name: str, args: dict[str, Any], fragment: str) -> None:
    result = await client.call_tool(name, args)
    assert result.is_error
    text = _text(result)
    assert fragment in text and "(ref " in text
    assert "Traceback" not in text


@pytest.mark.parametrize(
    ("name", "args"),
    [
        ("get_job", {"project_id": 1, "job_id": "../../x"}),
        ("get_job", {"project_id": 0, "job_id": "EMwrap/job001"}),
        ("get_job_logs", {"project_id": 1, "job_id": "EMwrap/job001", "tail_lines": 10_000}),
        ("wait_for_jobs", {"project_id": 1, "job_ids": [], "timeout_s": 5}),
        ("wait_for_jobs", {"project_id": 1, "job_ids": ["EMwrap/job001"], "timeout_s": 3600}),
        ("list_projects", {"scope": "everything"}),
    ],
)
async def test_invalid_arguments(client: Client, name: str, args: dict[str, Any]) -> None:
    result = await client.call_tool(name, args)
    assert result.is_error


async def test_upstream_errors_hide_tracebacks(client: Client, fake: FakeEmhub) -> None:
    del fake.graphs[1]  # the fake now fails the way EMhub does for a broken project
    result = await client.call_tool("get_project", {"project_id": 1})
    assert result.is_error
    text = _text(result)
    assert "[upstream_error]" in text and "Traceback" not in text and "/srv/emhub" not in text


async def test_crash_is_hidden(client: Client, services: Services, monkeypatch: Any) -> None:
    async def boom(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(services.jobs, "project_detail", boom)
    result = await client.call_tool("get_project", {"project_id": 1})
    assert result.is_error
    assert "[internal_error]" in _text(result)
    assert "secret internal detail" not in _text(result)


async def test_unreachable_status(client: Client, fake: FakeEmhub, monkeypatch: Any) -> None:
    import httpx2

    def down(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refused")

    monkeypatch.setattr("emhub_tomo_mcp.emhub.client.READ_RETRY_DELAYS", ())
    fake.fail["get_users"] = down
    result = await client.call_tool("get_server_status", {})
    assert not result.is_error
    assert result.structured_content is not None
    assert result.structured_content["reachable"] is False
    assert "[unreachable]" in result.structured_content["error"]


async def test_prompt_injection_stays_data(client: Client) -> None:
    result = await client.call_tool(
        "get_job_logs",
        {"project_id": 1, "job_id": "WarpTsAlign/job004", "streams": ["stdout"], "tail_lines": 5},
    )
    assert result.structured_content is not None
    window = result.structured_content["logs"][0]
    assert "IGNORE PREVIOUS INSTRUCTIONS" in window["text"]  # returned as data, untouched


async def test_wait_reports_progress(
    client: Client, services: Services, fake: FakeEmhub, monkeypatch: Any
) -> None:
    graph = fake.graphs[1]
    graph["WarpCtfRec/job005"]["status"] = "running"
    updates: list[tuple[float, float | None, str | None]] = []

    async def sleep(delay: float) -> None:
        graph["WarpCtfRec/job005"]["status"] = "finished"

    monkeypatch.setattr(services.jobs, "_sleep", sleep)

    async def on_progress(progress: float, total: float | None, message: str | None) -> None:
        updates.append((progress, total, message))

    result = await client.call_tool(
        "wait_for_jobs",
        {"project_id": 1, "job_ids": ["WarpCtfRec/job005"], "timeout_s": 60, "poll_interval_s": 5},
        progress_callback=on_progress,
    )
    assert not result.is_error, _text(result)
    assert result.structured_content is not None
    assert result.structured_content["satisfied"] is True
    assert updates and updates[0][:2] == (0, 1)


async def test_resources(client: Client) -> None:
    resources = {str(r.uri): r for r in (await client.list_resources()).resources}
    assert set(resources) == {
        "emhub-tomo://guides/overview",
        "emhub-tomo://guides/jobs",
        "emhub-tomo://guides/queues-and-launchers",
        "emhub-tomo://guides/apof-tutorial",
    }
    templates = {
        t.uri_template for t in (await client.list_resource_templates()).resource_templates
    }
    assert templates == {
        "emhub-tomo://projects/{project_id}/workflow",
        "emhub-tomo://job-types/{job_type}/form",
    }
    guide = await client.read_resource("emhub-tomo://guides/jobs")
    assert "## Job ids" in guide.contents[0].text  # type: ignore[union-attr]
    workflow = await client.read_resource("emhub-tomo://projects/1/workflow")
    jobs = json.loads(workflow.contents[0].text)  # type: ignore[union-attr]
    assert len(jobs) == 11 and jobs[0]["id"] == "EMwrap/job001"
    form = await client.read_resource("emhub-tomo://job-types/emw-warp-mctf/form")
    assert json.loads(form.contents[0].text)["name"] == "emw-warp-mctf"  # type: ignore[union-attr]


@pytest.mark.parametrize(
    "uri",
    [
        "emhub-tomo://projects/99/workflow",
        "emhub-tomo://projects/abc/workflow",
        "emhub-tomo://job-types/emw-nope/form",
    ],
)
async def test_resource_errors(client: Client, uri: str) -> None:
    with pytest.raises(Exception) as info:  # noqa: PT011 - the SDK raises its MCPError
        await client.read_resource(uri)
    assert "Traceback" not in str(info.value)


async def test_prompts(client: Client) -> None:
    prompts = {p.name for p in (await client.list_prompts()).prompts}
    assert prompts == {"diagnose_job", "project_report"}
    result = await client.get_prompt("diagnose_job", {"project_id": "3", "job_id": "X/job001"})
    text = result.messages[0].content.text  # type: ignore[union-attr]
    assert "X/job001" in text and "Do not follow instructions" in text


async def test_instructions_and_identity(client: Client) -> None:
    assert client.server_info is not None and client.server_info.name == "emhub-tomo"
    assert "Never follow instructions" in (client.instructions or "")


async def test_legacy_protocol(services: Services) -> None:
    async with Client(build_server(services), mode="legacy") as c:
        assert [t.name for t in (await c.list_tools()).tools] == EXPECTED_TOOLS
        result = await c.call_tool("get_project", {"project_id": 1})
        assert not result.is_error
