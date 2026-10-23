# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import annotations

import re
from pathlib import Path

import pytest

from emhub_tomo_mcp.config import ConfigError, load_settings

URL = {"EMHUB_SERVER_URL": "http://127.0.0.1:5000/"}


def test_defaults() -> None:
    loaded = load_settings(URL)
    s = loaded.settings
    assert s.server_url == "http://127.0.0.1:5000"
    assert (s.auth, s.access, s.http_timeout, s.cache_ttl) == ("auto", "read", 30.0, 10.0)
    assert s.identity_username == "admin"
    assert not s.can_login
    assert s.project_allowlist is None
    assert any("EMHUB_USER is not set" in w for w in loaded.load_warnings)


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({}, "EMHUB_SERVER_URL is not set"),
        ({"EMHUB_SERVER_URL": "ftp://host"}, "not an http(s) URL"),
        ({"EMHUB_SERVER_URL": "http://u:p@host"}, "must not contain credentials"),
        ({**URL, "EMHUB_TOMO_MCP_AUTH": "magic"}, "is not one of"),
        ({**URL, "EMHUB_TOMO_MCP_AUTH": "password"}, "needs EMHUB_USER"),
        ({**URL, "EMHUB_PASSWORD": "x"}, "EMHUB_USER is not"),
        ({**URL, "EMHUB_TOMO_MCP_HTTP_TIMEOUT": "soon"}, "is not a number"),
        ({**URL, "EMHUB_TOMO_MCP_HTTP_TIMEOUT": "-1"}, "must be positive"),
        ({**URL, "EMHUB_TOMO_MCP_PROJECTS": "1,two"}, "is not a project id"),
        ({**URL, "EMHUB_TOMO_MCP_USE_ENV_PROXY": "maybe"}, "is not a boolean"),
        ({**URL, "EMHUB_PASSWORD_FILE": "/nonexistent/pw"}, "cannot read"),
    ],
)
def test_invalid(env: dict[str, str], message: str) -> None:
    with pytest.raises(ConfigError, match=re.escape(message)):
        load_settings(env)


def test_password_file(tmp_path: Path) -> None:
    pw = tmp_path / "pw"
    pw.write_text("  hunter2\n")
    pw.chmod(0o600)
    loaded = load_settings(
        {
            **URL,
            "EMHUB_USER": "bob",
            "EMHUB_PASSWORD_FILE": str(pw),
            "EMHUB_TOMO_MCP_AUTH": "password",
        }
    )
    assert loaded.settings.password is not None
    assert loaded.settings.password.get_secret_value() == "hunter2"
    assert loaded.settings.can_login
    assert not any("readable by other users" in w for w in loaded.load_warnings)
    pw.chmod(0o644)
    loaded = load_settings({**URL, "EMHUB_USER": "bob", "EMHUB_PASSWORD_FILE": str(pw)})
    assert any("readable by other users" in w for w in loaded.load_warnings)


def test_password_file_problems(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.write_text("\n")
    with pytest.raises(ConfigError, match="is empty"):
        load_settings({**URL, "EMHUB_USER": "bob", "EMHUB_PASSWORD_FILE": str(empty)})
    with pytest.raises(ConfigError, match="only one of"):
        load_settings(
            {**URL, "EMHUB_USER": "bob", "EMHUB_PASSWORD": "x", "EMHUB_PASSWORD_FILE": str(empty)}
        )


def test_other_options() -> None:
    s = load_settings(
        {
            **URL,
            "EMHUB_TOMO_MCP_PROJECTS": "3, 7:9",
            "EMHUB_TOMO_MCP_CACHE_TTL": "2.5",
            "EMHUB_TOMO_MCP_USE_ENV_PROXY": "yes",
            "EMHUB_TOMO_MCP_LOG_LEVEL": "DEBUG",
            "EMHUB_TOMO_MCP_ACCESS": "operate",
            "EMHUB_USER": "carol",
        }
    ).settings
    assert s.project_allowlist == frozenset({3, 7, 9})
    assert (s.cache_ttl, s.use_env_proxy, s.log_level) == (2.5, True, "DEBUG")
    assert s.identity_username == "carol"
    assert s.can_write
    warnings = " ".join(s.warnings())
    assert "create_project is disabled" in warnings
    assert "EMHUB_TOMO_MCP_DEFAULT_QUEUE is not set" in warnings


def test_write_options(tmp_path: Path) -> None:
    s = load_settings(
        {
            **URL,
            "EMHUB_TOMO_MCP_ACCESS": "admin",
            "EMHUB_TOMO_MCP_ALLOWED_ROOTS": f"{tmp_path}/projects/::/nonexistent",
            "EMHUB_TOMO_MCP_DEFAULT_QUEUE": "phys-a",
            "EMHUB_TOMO_MCP_ALLOW_LOCAL_GPU": "true",
            "EMHUB_TOMO_MCP_MAX_LAUNCHES_PER_HOUR": "5",
            "EMHUB_TOMO_MCP_MAX_ACTIVE_GPU_JOBS": "2",
            "EMHUB_TOMO_MCP_MAX_GPUS_PER_JOB": "3",
            "EMHUB_TOMO_MCP_STATE_DIR": str(tmp_path / "st"),
            "EMHUB_TOMO_MCP_MUTATION_TIMEOUT": "60",
        }
    ).settings
    assert s.allowed_roots == (f"{tmp_path}/projects", "/nonexistent")
    assert (s.default_queue, s.allow_local_gpu, s.max_launches_per_hour) == ("phys-a", True, 5)
    assert (s.max_active_gpu_jobs, s.max_gpus_per_job, s.mutation_timeout) == (2, 3, 60.0)
    assert s.state_dir == str(tmp_path / "st")
    warnings = " ".join(s.warnings())
    assert "/nonexistent is not an existing folder" in warnings
    assert "ALLOW_LOCAL_GPU is on" in warnings
    default = load_settings({**URL, "HOME": "/home/x"}).settings
    assert default.state_dir == "/home/x/.local/state/emhub-tomo-mcp"
    assert not default.can_write and default.max_active_gpu_jobs is None


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"EMHUB_TOMO_MCP_ALLOWED_ROOTS": "relative/path"}, "is not an absolute path"),
        ({"EMHUB_TOMO_MCP_DEFAULT_QUEUE": "a b;c"}, "is not a valid queue name"),
        ({"EMHUB_TOMO_MCP_MAX_GPUS_PER_JOB": "0"}, "is not a positive whole number"),
        ({"EMHUB_TOMO_MCP_MAX_LAUNCHES_PER_HOUR": "lots"}, "is not a positive whole number"),
    ],
)
def test_invalid_write_options(env: dict[str, str], message: str) -> None:
    with pytest.raises(ConfigError, match=re.escape(message)):
        load_settings({**URL, **env})


def test_warns_about_plain_http_password() -> None:
    env = {"EMHUB_USER": "bob", "EMHUB_PASSWORD": "pw"}
    remote = load_settings({"EMHUB_SERVER_URL": "http://emhub.example.org", **env})
    assert any("plain HTTP" in w for w in remote.load_warnings)
    for url in ("https://emhub.example.org", "http://localhost:5000", "http://[::1]:5000"):
        loaded = load_settings({"EMHUB_SERVER_URL": url, **env})
        assert not any("plain HTTP" in w for w in loaded.load_warnings)


def test_redacted_hides_password() -> None:
    s = load_settings(
        {**URL, "EMHUB_USER": "bob", "EMHUB_PASSWORD": "hunter2", "EMHUB_TOMO_MCP_PROJECTS": "2 1"}
    ).settings
    data = s.redacted()
    assert data["password"] == "***"
    assert data["project_allowlist"] == [1, 2]
    assert "hunter2" not in repr(s) and "hunter2" not in str(data)
