# SPDX-License-Identifier: GPL-3.0-or-later
"""Server configuration, read from environment variables.

The ``EMHUB_*`` names are shared with EMhub's own client scripts; everything
specific to this server starts with ``EMHUB_TOMO_MCP_``. See
``docs/configuration.md`` for the reference.
"""

from __future__ import annotations

import ipaddress
import os
import stat
from collections.abc import Mapping
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, SecretStr

AuthMode = Literal["auto", "autologin", "password"]
AccessLevel = Literal["read", "operate", "admin"]
LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR"]

# The emh-tomo launcher logs every request in as this user (EMHUB_LOGGED_USER).
EMH_TOMO_DEFAULT_USER = "admin"


class ConfigError(ValueError):
    """The environment does not describe a usable configuration."""


class Settings(BaseModel):
    model_config = ConfigDict(frozen=True)

    server_url: str
    auth: AuthMode = "auto"
    username: str | None = None
    password: SecretStr | None = None
    access: AccessLevel = "read"
    project_allowlist: frozenset[int] | None = None
    http_timeout: float = 30.0
    cache_ttl: float = 10.0
    use_env_proxy: bool = False
    log_level: LogLevel = "INFO"
    # Write access (operate and admin levels)
    allowed_roots: tuple[str, ...] = ()
    default_queue: str | None = None
    allow_local_gpu: bool = False
    max_launches_per_hour: int = 20
    max_active_gpu_jobs: int | None = None
    max_gpus_per_job: int | None = None
    state_dir: str = ""
    mutation_timeout: float = 120.0

    @property
    def can_write(self) -> bool:
        return self.access in ("operate", "admin")

    @property
    def identity_username(self) -> str:
        """The EMhub user the server acts as (see :func:`load_settings`)."""
        return self.username or EMH_TOMO_DEFAULT_USER

    @property
    def can_login(self) -> bool:
        return self.username is not None and self.password is not None

    def warnings(self) -> list[str]:
        """Non-fatal configuration problems, reported by ``--check`` and at startup."""
        result = []
        if self.can_write and not self.allowed_roots:
            result.append("EMHUB_TOMO_MCP_ALLOWED_ROOTS is not set, so create_project is disabled.")
        if self.can_write and not self.default_queue and not self.allow_local_gpu:
            result.append(
                "EMHUB_TOMO_MCP_DEFAULT_QUEUE is not set: GPU jobs must name a cluster queue "
                "themselves, or they are refused."
            )
        if self.can_write and self.allow_local_gpu:
            result.append(
                "EMHUB_TOMO_MCP_ALLOW_LOCAL_GPU is on: GPU jobs may run on the EMhub host itself."
            )
        for root in self.allowed_roots:
            if not os.path.isdir(root):
                result.append(f"EMHUB_TOMO_MCP_ALLOWED_ROOTS: {root} is not an existing folder.")
        if self.auth != "password" and self.username is None:
            result.append(
                f"EMHUB_USER is not set; assuming the emh-tomo auto-login user "
                f"'{EMH_TOMO_DEFAULT_USER}' for project visibility."
            )
        parts = urlsplit(self.server_url)
        if self.can_login and parts.scheme == "http" and not _is_loopback(parts.hostname):
            result.append(
                "The EMhub password is sent over plain HTTP to a non-local host; "
                "use https or an SSH tunnel."
            )
        return result

    def redacted(self) -> dict[str, object]:
        data = self.model_dump(mode="json")
        data["password"] = "***" if self.password is not None else None
        if self.project_allowlist is not None:
            data["project_allowlist"] = sorted(self.project_allowlist)
        return data


def _is_loopback(host: str | None) -> bool:
    if host is None:
        return False
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _get(env: Mapping[str, str], name: str) -> str | None:
    value = env.get(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


def _choice(env: Mapping[str, str], name: str, allowed: tuple[str, ...], default: str) -> str:
    value = _get(env, name)
    if value is None:
        return default
    if value not in allowed:
        raise ConfigError(f"{name}={value!r} is not one of: {', '.join(allowed)}")
    return value


def _positive_float(env: Mapping[str, str], name: str, default: float) -> float:
    value = _get(env, name)
    if value is None:
        return default
    try:
        number = float(value)
    except ValueError:
        raise ConfigError(f"{name}={value!r} is not a number") from None
    if not number > 0:
        raise ConfigError(f"{name} must be positive, got {value!r}")
    return number


def _bool(env: Mapping[str, str], name: str, default: bool) -> bool:
    value = _get(env, name)
    if value is None:
        return default
    if value.lower() in ("1", "true", "yes", "on"):
        return True
    if value.lower() in ("0", "false", "no", "off"):
        return False
    raise ConfigError(f"{name}={value!r} is not a boolean (use true or false)")


def _server_url(env: Mapping[str, str]) -> str:
    url = _get(env, "EMHUB_SERVER_URL")
    if url is None:
        raise ConfigError(
            "EMHUB_SERVER_URL is not set. Set it to the URL printed by 'emh-tomo --run', "
            "e.g. http://127.0.0.1:5000"
        )
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ConfigError(f"EMHUB_SERVER_URL={url!r} is not an http(s) URL")
    if parts.query or parts.fragment or parts.username or parts.password:
        raise ConfigError("EMHUB_SERVER_URL must not contain credentials, a query or a fragment")
    return url.rstrip("/")


def _read_password_file(path_str: str) -> tuple[str, bool]:
    """Return the password and whether the file is readable by others."""
    path = Path(path_str).expanduser()
    try:
        text = path.read_text(encoding="utf-8")
        mode = path.stat().st_mode
    except OSError as exc:
        raise ConfigError(f"EMHUB_PASSWORD_FILE: cannot read {path}: {exc.strerror}") from None
    password = text.strip()
    if not password:
        raise ConfigError(f"EMHUB_PASSWORD_FILE: {path} is empty")
    return password, bool(mode & (stat.S_IRWXG | stat.S_IRWXO))


def _project_allowlist(env: Mapping[str, str]) -> frozenset[int] | None:
    value = _get(env, "EMHUB_TOMO_MCP_PROJECTS")
    if value is None:
        return None
    ids = set()
    for token in value.replace(",", " ").replace(":", " ").split():
        if not token.isdigit():
            raise ConfigError(f"EMHUB_TOMO_MCP_PROJECTS: {token!r} is not a project id")
        ids.add(int(token))
    return frozenset(ids)


def _positive_int(env: Mapping[str, str], name: str, default: int | None) -> int | None:
    value = _get(env, name)
    if value is None:
        return default
    if not value.isdigit() or int(value) < 1:
        raise ConfigError(f"{name}={value!r} is not a positive whole number")
    return int(value)


def _allowed_roots(env: Mapping[str, str]) -> tuple[str, ...]:
    value = _get(env, "EMHUB_TOMO_MCP_ALLOWED_ROOTS")
    if value is None:
        return ()
    roots = []
    for item in value.split(":"):
        item = item.strip()
        if not item:
            continue
        if not item.startswith("/"):
            raise ConfigError(f"EMHUB_TOMO_MCP_ALLOWED_ROOTS: {item!r} is not an absolute path")
        roots.append(os.path.normpath(item))
    return tuple(roots)


def _queue_name(env: Mapping[str, str]) -> str | None:
    value = _get(env, "EMHUB_TOMO_MCP_DEFAULT_QUEUE")
    if value is not None and not value.replace("-", "").replace("_", "").replace(".", "").isalnum():
        raise ConfigError(f"EMHUB_TOMO_MCP_DEFAULT_QUEUE={value!r} is not a valid queue name")
    return value


def _state_dir(env: Mapping[str, str]) -> str:
    value = _get(env, "EMHUB_TOMO_MCP_STATE_DIR")
    if value is None:
        base = _get(env, "XDG_STATE_HOME") or os.path.join(
            _get(env, "HOME") or os.path.expanduser("~"), ".local", "state"
        )
        value = os.path.join(base, "emhub-tomo-mcp")
    return os.path.abspath(os.path.expanduser(value))


class LoadedSettings(BaseModel):
    """Settings plus problems found while loading them."""

    settings: Settings
    load_warnings: list[str]


def load_settings(env: Mapping[str, str] | None = None) -> LoadedSettings:
    """Build :class:`Settings` from the environment, raising :class:`ConfigError`."""
    env = os.environ if env is None else env
    load_warnings: list[str] = []

    password: str | None = _get(env, "EMHUB_PASSWORD")
    password_file = _get(env, "EMHUB_PASSWORD_FILE")
    if password_file is not None:
        if password is not None:
            raise ConfigError("Set only one of EMHUB_PASSWORD and EMHUB_PASSWORD_FILE")
        password, too_open = _read_password_file(password_file)
        if too_open:
            load_warnings.append(
                f"EMHUB_PASSWORD_FILE {password_file} is readable by other users; chmod 600 it."
            )

    auth = _choice(env, "EMHUB_TOMO_MCP_AUTH", ("auto", "autologin", "password"), "auto")
    username = _get(env, "EMHUB_USER")
    if auth == "password" and (username is None or password is None):
        raise ConfigError(
            "EMHUB_TOMO_MCP_AUTH=password needs EMHUB_USER and EMHUB_PASSWORD "
            "(or EMHUB_PASSWORD_FILE)"
        )
    if password is not None and username is None:
        raise ConfigError("EMHUB_PASSWORD is set but EMHUB_USER is not")

    settings = Settings(
        server_url=_server_url(env),
        auth=auth,
        username=username,
        password=SecretStr(password) if password is not None else None,
        access=_choice(env, "EMHUB_TOMO_MCP_ACCESS", ("read", "operate", "admin"), "read"),
        project_allowlist=_project_allowlist(env),
        http_timeout=_positive_float(env, "EMHUB_TOMO_MCP_HTTP_TIMEOUT", 30.0),
        cache_ttl=_positive_float(env, "EMHUB_TOMO_MCP_CACHE_TTL", 10.0),
        use_env_proxy=_bool(env, "EMHUB_TOMO_MCP_USE_ENV_PROXY", False),
        log_level=_choice(
            env, "EMHUB_TOMO_MCP_LOG_LEVEL", ("DEBUG", "INFO", "WARNING", "ERROR"), "INFO"
        ),
        allowed_roots=_allowed_roots(env),
        default_queue=_queue_name(env),
        allow_local_gpu=_bool(env, "EMHUB_TOMO_MCP_ALLOW_LOCAL_GPU", False),
        max_launches_per_hour=_positive_int(env, "EMHUB_TOMO_MCP_MAX_LAUNCHES_PER_HOUR", 20) or 20,
        max_active_gpu_jobs=_positive_int(env, "EMHUB_TOMO_MCP_MAX_ACTIVE_GPU_JOBS", None),
        max_gpus_per_job=_positive_int(env, "EMHUB_TOMO_MCP_MAX_GPUS_PER_JOB", None),
        state_dir=_state_dir(env),
        mutation_timeout=_positive_float(env, "EMHUB_TOMO_MCP_MUTATION_TIMEOUT", 120.0),
    )
    return LoadedSettings(settings=settings, load_warnings=load_warnings + settings.warnings())
