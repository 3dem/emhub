# SPDX-License-Identifier: GPL-3.0-or-later
"""Robustness: random arguments, big projects, concurrency, failures and odd data."""

from __future__ import annotations

import gc
import json
import logging
import random
import tracemalloc
from collections.abc import AsyncIterator
from typing import Any

import anyio
import httpx2
import jsonschema
import pytest
from fake_emhub import FakeEmhub
from mcp import Client
from mcp.types import CallToolResult

from emhub_tomo_mcp.server import build_server
from emhub_tomo_mcp.services import Services

pytestmark = pytest.mark.anyio

TEXT_BUDGET = 64_000


def _text(result: CallToolResult) -> str:
    return "".join(getattr(c, "text", "") for c in result.content)


@pytest.fixture
async def client(services: Services) -> AsyncIterator[Client]:
    async with Client(build_server(services)) as c:
        yield c


# ------------------------------------------------------------- random input

WEIRD_STRINGS = [
    "",
    " ",
    ".",
    "..",
    "/",
    "~",
    "\\",
    "\x00",
    "\n",
    "a" * 5000,
    "ü€😀",
    "../" * 50,
    "WarpMctf/job003",
    "EMwrap/job001",
    "data",
    "notes.txt",
    "*",
    "%2e%2e",
    "${HOME}",
    "'; DROP TABLE users; --",
    "<script>",
    "PROJECT",
    "emw-warp-mctf",
    "-1",
    "1e9",
]


def _random_value(rng: random.Random, schema: dict[str, Any], depth: int = 0) -> Any:
    choice = rng.random()
    if choice < 0.15:  # anything at all
        return rng.choice([None, True, -1, 0, 2**40, 3.5, "x", [], {}, ["a"], {"k": 1}])
    kinds = list(schema.get("anyOf", [schema]))
    kind = rng.choice(kinds)
    if "enum" in kind:
        return rng.choice([*kind["enum"], "bogus"])
    t = kind.get("type")
    if t == "integer":
        return rng.choice([0, 1, 2, 3, 4, 99, -5, 10**6, kind.get("maximum", 5)])
    if t == "boolean":
        return rng.choice([True, False])
    if t == "array" and depth < 2:
        return [
            _random_value(rng, kind.get("items", {}), depth + 1)
            for _ in range(rng.choice([0, 1, 2, 60]))
        ]
    if t == "null":
        return None
    return rng.choice(WEIRD_STRINGS)


async def test_random_arguments_never_crash(client: Client) -> None:
    rng = random.Random(20261021)
    tools = (await client.list_tools()).tools
    for tool in tools:
        props = tool.input_schema.get("properties", {})
        for _ in range(60):
            args = {
                name: _random_value(rng, schema)
                for name, schema in props.items()
                if rng.random() < 0.8
            }
            if tool.name == "wait_for_jobs":
                args["timeout_s"] = 1  # keep real waiting short
                args["poll_interval_s"] = 5
            result = await client.call_tool(tool.name, args)
            text = _text(result)
            context = f"{tool.name}({json.dumps(args, default=str)[:200]})"
            assert "[internal_error]" not in text, context
            assert "Traceback" not in text or tool.name in ("get_job", "get_job_logs"), context
            assert len(text) < TEXT_BUDGET, context
            if not result.is_error:
                jsonschema.validate(result.structured_content, tool.output_schema)


# --------------------------------------------------------------- big project


def _big_graph(n: int) -> dict[str, Any]:
    graph: dict[str, Any] = {
        "PROJECT": {"id": "PROJECT", "children": [], "parents": [], "type": "PROJECT"}
    }
    statuses = ["finished", "finished", "finished", "failed", "running", "saved", "scheduled"]
    for i in range(1, n + 1):
        job = f"WarpMctf/job{i:04d}"
        parents = [f"WarpMctf/job{i - 1:04d}"] if i > 1 else ["PROJECT"]
        graph[job] = {
            "id": job,
            "type": "emw-warp-mctf",
            "status": statuses[i % len(statuses)],
            "parents": parents,
            "children": [],
            "outputs": [],
            "elapsedTime": i,
            "runName": f"run {i}",
            "tags": [],
        }
        if i > 1:
            graph[parents[0]]["children"].append(job)
    return graph


async def test_big_project_stays_within_budget(client: Client, fake: FakeEmhub) -> None:
    fake.graphs[1] = _big_graph(1000)
    result = await client.call_tool("get_project", {"project_id": 1})
    assert not result.is_error
    data = result.structured_content
    assert data is not None and data["job_count"] == 1000
    assert len(_text(result)) < TEXT_BUDGET
    assert data["jobs_omitted"] == 1000 - len(data["jobs"])
    failed_only = await client.call_tool("get_project", {"project_id": 1, "statuses": ["failed"]})
    assert failed_only.structured_content is not None
    assert len(failed_only.structured_content["jobs"]) == 100  # the default limit
    assert len(failed_only.structured_content["failed"]) == 50
    assert "and 138 more" in _text(failed_only).splitlines()[0]
    resource = await client.read_resource("emhub-tomo://projects/1/workflow")
    assert len(json.loads(resource.contents[0].text)) == 1000  # type: ignore[union-attr]


# --------------------------------------------------------------- concurrency


async def test_concurrent_calls_share_one_login(fake: FakeEmhub, services_for: Any) -> None:
    fake.require_login = True
    services = services_for(
        EMHUB_TOMO_MCP_AUTH="password", EMHUB_USER="admin", EMHUB_PASSWORD="s3cret"
    )
    results: list[CallToolResult] = []
    async with Client(build_server(services)) as c:

        async def one(i: int) -> None:
            tool, args = [
                ("get_project", {"project_id": 1}),
                ("get_job", {"project_id": 1, "job_id": "EMwrap/job001"}),
                ("list_projects", {}),
                ("read_project_file", {"project_id": 1, "path": "notes.txt"}),
            ][i % 4]
            results.append(await c.call_tool(tool, args))

        async with anyio.create_task_group() as tg:
            for i in range(50):
                tg.start_soon(one, i)
    assert len(results) == 50 and not any(r.is_error for r in results)
    assert len(fake.calls_to("login")) == 1


# ---------------------------------------------------------- failures and data


async def test_emhub_down_then_up(client: Client, fake: FakeEmhub, monkeypatch: Any) -> None:
    monkeypatch.setattr("emhub_tomo_mcp.emhub.client.READ_RETRY_DELAYS", ())
    fake.down = True
    down = await client.call_tool("get_project", {"project_id": 1})
    assert down.is_error and "[unreachable]" in _text(down)
    fake.down = False
    up = await client.call_tool("get_project", {"project_id": 1})
    assert not up.is_error


async def test_session_lost_midway(fake: FakeEmhub, services_for: Any) -> None:
    fake.require_login = True
    services = services_for(EMHUB_USER="admin", EMHUB_PASSWORD="s3cret")
    async with Client(build_server(services)) as c:
        assert not (await c.call_tool("get_project", {"project_id": 1})).is_error
        fake.logged_in = None  # EMhub restarted: the session cookie is no longer valid
        assert not (
            await c.call_tool("get_job", {"project_id": 1, "job_id": "EMwrap/job001"})
        ).is_error
    assert len(fake.calls_to("login")) == 2


async def test_odd_emhub_data(client: Client, fake: FakeEmhub) -> None:
    fake.entries += [
        {"id": 20, "type": "tomo_processing", "title": None, "project_id": 5, "extra": {}},
        {
            "id": 21,
            "type": "tomo_processing",
            "title": "Ünïcødé 😀 project",
            "project_id": 5,
            "extra": {"data": {"processing_path": "/data/x/", "share_table": "garbage"}},
        },
        {
            "id": 22,
            "type": "tomo_processing",
            "title": "orphan",
            "project_id": None,
            "extra": {"data": None},
        },
        {
            "id": 23,
            "type": "tomo_processing",
            "title": "shared",
            "project_id": 999,
            "extra": {
                "data": {"share_table": [{"user_email": None}, "x", {"user_perms": "editor"}]}
            },
        },
    ]
    fake.users.append({"id": 9, "username": "noemail", "roles": None})
    listing = await client.call_tool("list_projects", {"scope": "all"})
    assert not listing.is_error, _text(listing)
    data = listing.structured_content
    assert data is not None
    titles = {p["id"]: p["title"] for p in data["projects"]}
    assert titles[20] == "Project 20" and titles[21] == "Ünïcødé 😀 project"
    assert titles[21] == "Ünïcødé 😀 project" and 22 in titles
    missing = await client.call_tool("get_project", {"project_id": 20})
    assert missing.is_error and "[upstream_error]" in _text(missing)


async def test_odd_payloads_are_reported(client: Client, fake: FakeEmhub) -> None:
    fake.fail["get_entries"] = lambda r: httpx2.Response(200, json={"unexpected": "shape"})
    result = await client.call_tool("list_projects", {})
    assert result.is_error and "[upstream_error]" in _text(result)
    fake.fail["get_entries"] = lambda r: httpx2.Response(200, text="not json at all")
    result = await client.call_tool("list_projects", {})
    assert result.is_error and "[upstream_error]" in _text(result)


async def test_long_session_memory(client: Client, fake: FakeEmhub) -> None:
    fake.record = False  # the fake's own request log would grow
    calls = [
        ("get_project", {"project_id": 1}),
        ("get_job_logs", {"project_id": 1, "job_id": "WarpTsAlign/job004"}),
        ("read_project_file", {"project_id": 1, "path": "notes.txt"}),
    ]
    for tool, args in calls * 30:  # warm-up: caches, schema adapters
        await client.call_tool(tool, args)
    gc.collect()
    logging.disable(logging.CRITICAL)  # pytest keeps captured log records in memory
    tracemalloc.start()
    try:
        before = tracemalloc.take_snapshot()
        for tool, args in calls * 300:
            assert not (await client.call_tool(tool, args)).is_error
        gc.collect()
        after = tracemalloc.take_snapshot()
    finally:
        tracemalloc.stop()
        logging.disable(logging.NOTSET)
    growth = sum(s.size_diff for s in after.compare_to(before, "filename"))
    assert growth < 300_000, f"memory grew by {growth} bytes over 900 calls"
