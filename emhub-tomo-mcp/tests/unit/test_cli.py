# SPDX-License-Identifier: GPL-3.0-or-later
"""The command line, run in-process (tests/protocol/test_stdio.py runs it as a program)."""

from __future__ import annotations

import json
from typing import Any

import pytest
from fake_emhub import FakeEmhub

from emhub_tomo_mcp import __main__ as cli
from emhub_tomo_mcp.services import Services


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> Any:
    for name in ("EMHUB_SERVER_URL", "EMHUB_USER", "EMHUB_PASSWORD", "EMHUB_PASSWORD_FILE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("EMHUB_SERVER_URL", "http://127.0.0.1:5000")
    return monkeypatch


def test_print_config(env: Any, capsys: pytest.CaptureFixture[str]) -> None:
    env.setenv("EMHUB_USER", "bob")
    env.setenv("EMHUB_PASSWORD", "hunter2")
    assert cli.main(["--print-config"]) == 0
    out = capsys.readouterr()
    assert json.loads(out.out)["password"] == "***"
    assert "hunter2" not in out.out + out.err


def test_config_error(env: Any, capsys: pytest.CaptureFixture[str]) -> None:
    env.setenv("EMHUB_TOMO_MCP_AUTH", "nope")
    assert cli.main([]) == 2
    assert "configuration error" in capsys.readouterr().err


@pytest.mark.parametrize("users_fail", [False, True])
def test_check(
    env: Any, capsys: pytest.CaptureFixture[str], fake: FakeEmhub, users_fail: bool
) -> None:
    original = Services.create

    def create(settings: Any, **kwargs: Any) -> Services:
        return original(settings, transport=fake.transport(), **kwargs)

    env.setattr(cli.Services, "create", create)
    fake.has_job_types = False
    if users_fail:
        fake.users = []
    code = cli.main(["--check"])
    out = capsys.readouterr().out
    if users_fail:
        assert code == 1 and "Problem: [auth] EMhub has no user 'admin'" in out
    else:
        assert code == 0 and out.rstrip().endswith("OK")
        assert "Acting as:        admin (roles: admin)" in out
        assert "Visible projects: 3" in out  # an admin sees every project
        assert "/api/get_job_types: no (affects list_job_types" in out
        assert "Warning: EMHUB_USER is not set" in out


def test_serve_builds_and_runs_the_server(env: Any) -> None:
    ran: list[str] = []

    class FakeServer:
        def run(self, transport: str) -> None:
            ran.append(transport)

    env.setattr("emhub_tomo_mcp.server.build_server", lambda services: FakeServer())
    assert cli.main([]) == 0
    assert ran == ["stdio"]
