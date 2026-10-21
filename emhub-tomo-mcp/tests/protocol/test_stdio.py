# SPDX-License-Identifier: GPL-3.0-or-later
"""The console script: stdio transport, --check and --print-config."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys

import pytest
from mcp import Client, StdioServerParameters

pytestmark = pytest.mark.anyio


def _closed_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _env(**extra: str) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("EMHUB")}
    env.update(
        {
            "EMHUB_SERVER_URL": f"http://127.0.0.1:{_closed_port()}",
            "EMHUB_TOMO_MCP_HTTP_TIMEOUT": "2",
        }
    )
    env.update(extra)
    return env


def _run(*args: str, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "emhub_tomo_mcp", *args],
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )


async def test_stdio_server_starts_without_emhub() -> None:
    """With EMhub down, the server still starts; stdout carries only the protocol."""
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "emhub_tomo_mcp"], env=_env()
    )
    async with Client(params) as client:
        tools = (await client.list_tools()).tools
        assert len(tools) == 13
        result = await client.call_tool("get_project", {"project_id": 1})
        assert result.is_error
        assert "[unreachable]" in result.content[0].text  # type: ignore[union-attr]


def test_print_config_hides_password() -> None:
    proc = _run("--print-config", env=_env(EMHUB_USER="bob", EMHUB_PASSWORD="hunter2"))
    assert proc.returncode == 0
    config = json.loads(proc.stdout)
    assert config["password"] == "***" and config["username"] == "bob"
    assert "hunter2" not in proc.stdout + proc.stderr


def test_check_reports_unreachable() -> None:
    proc = _run("--check", env=_env())
    assert proc.returncode == 1
    assert "Problem: [unreachable]" in proc.stdout


def test_config_error_exit_code() -> None:
    env = _env()
    del env["EMHUB_SERVER_URL"]
    proc = _run(env=env)
    assert proc.returncode == 2
    assert "EMHUB_SERVER_URL is not set" in proc.stderr and proc.stdout == ""


def test_version() -> None:
    proc = _run("--version", env=_env())
    assert proc.returncode == 0 and proc.stdout.startswith("emhub-tomo-mcp ")
