# SPDX-License-Identifier: GPL-3.0-or-later
"""Hardening: concurrent changes, a slow EMhub, latency on large projects."""

from __future__ import annotations

import http.server
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import anyio
import pytest
from fake_emhub import FakeEmhub
from mcp import Client

from emhub_tomo_mcp.config import load_settings
from emhub_tomo_mcp.errors import EmhubMcpError, ErrorKind
from emhub_tomo_mcp.server import build_server
from emhub_tomo_mcp.services import Services

pytestmark = pytest.mark.anyio


async def test_concurrent_launches_are_serialized(
    services_for: Any, fake: FakeEmhub, tmp_path: Path
) -> None:
    svc = services_for(
        EMHUB_TOMO_MCP_ACCESS="operate",
        EMHUB_TOMO_MCP_DEFAULT_QUEUE="cryo",
        EMHUB_TOMO_MCP_STATE_DIR=str(tmp_path),
    )
    ref = await svc.projects.get(1)
    outcomes: list[str] = []

    async def launch() -> None:
        try:
            await svc.operations.run_job(
                ref, "WarpCtfRec/job005", params={}, rerun=False, clean=False, dry_run=False
            )
            outcomes.append("launched")
        except EmhubMcpError as exc:
            outcomes.append(exc.kind.value)

    async with anyio.create_task_group() as tg:
        for _ in range(3):
            tg.start_soon(launch)
    assert sorted(outcomes) == ["conflict", "conflict", "launched"]
    assert len(fake.calls_to("launch_job")) == 1


class _SlowHandler(http.server.BaseHTTPRequestHandler):
    delay = 3.0

    def do_POST(self) -> None:
        time.sleep(self.delay)
        body = b"[]"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: Any) -> None:
        pass


@pytest.fixture
def slow_emhub() -> Iterator[str]:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _SlowHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


async def test_slow_emhub_times_out(slow_emhub: str, monkeypatch: Any) -> None:
    monkeypatch.setattr("emhub_tomo_mcp.emhub.client.READ_RETRY_DELAYS", (0.1,))
    settings = load_settings(
        {"EMHUB_SERVER_URL": slow_emhub, "EMHUB_TOMO_MCP_HTTP_TIMEOUT": "0.5"}
    ).settings
    services = Services.create(settings)
    started = time.monotonic()
    with pytest.raises(EmhubMcpError) as info:
        await services.client.call("get_entries", {})
    elapsed = time.monotonic() - started
    await services.aclose()
    assert info.value.kind is ErrorKind.UNREACHABLE and "timed out" in info.value.message
    assert elapsed < 2.5  # two attempts of 0.5 s plus the retry delay, not 3 s each

    async with Client(build_server(Services.create(settings))) as client:
        status = await client.call_tool("get_server_status", {})
        assert status.structured_content is not None
        assert status.structured_content["reachable"] is False


async def test_slow_emhub_mutation_not_retried(slow_emhub: str, tmp_path: Path) -> None:
    settings = load_settings(
        {"EMHUB_SERVER_URL": slow_emhub, "EMHUB_TOMO_MCP_MUTATION_TIMEOUT": "0.5"}
    ).settings
    services = Services.create(settings)
    started = time.monotonic()
    with pytest.raises(EmhubMcpError) as info:
        await services.client.mutate("launch_job", {"entry_id": 1})
    await services.aclose()
    assert info.value.kind is ErrorKind.UNREACHABLE
    assert time.monotonic() - started < 1.5


async def test_large_project_latency() -> None:
    fake = FakeEmhub()
    graph = {"PROJECT": {"id": "PROJECT", "children": [], "parents": [], "type": "PROJECT"}}
    for i in range(1, 201):
        job = f"WarpMctf/job{i:03d}"
        graph[job] = {
            "id": job,
            "type": "emw-warp-mctf",
            "status": "finished",
            "parents": [f"WarpMctf/job{i - 1:03d}"] if i > 1 else ["PROJECT"],
            "children": [f"WarpMctf/job{i + 1:03d}"] if i < 200 else [],
            "outputs": [],
            "elapsedTime": i,
            "tags": [],
        }
    fake.graphs[1] = graph
    settings = load_settings({"EMHUB_SERVER_URL": "http://127.0.0.1:5000"}).settings
    async with Client(build_server(Services.create(settings, transport=fake.transport()))) as c:
        await c.call_tool("get_project", {"project_id": 1})  # warm-up
        timings = []
        for _ in range(20):
            started = time.monotonic()
            result = await c.call_tool("get_project", {"project_id": 1, "limit": 200})
            timings.append(time.monotonic() - started)
            assert not result.is_error
    timings.sort()
    assert timings[int(0.95 * len(timings)) - 1] < 0.5, timings
