# SPDX-License-Identifier: GPL-3.0-or-later
"""HTTP transport for the EMhub REST API.

EMhub answers ``POST /api/<method>`` with JSON. Its conventions shape this
client:

- failures usually arrive as HTTP 200 with ``{"error": "ERROR from Server: ...
  Traceback: ..."}``, or ``{"errors": [...]}`` for job validation;
- calls without a session get HTTP 401 (with an HTML body);
- ``emh-tomo --run`` logs every request in automatically, so no login is needed
  there; other instances need ``/api/login`` and a session cookie.

Reads are retried on connection errors and 5xx answers; mutating calls are
never retried. Lists are always fetched whole and filtered on the client side,
so the list filter parameters (``condition``/``orderBy``) are never sent.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import anyio
import httpx2

from .. import __version__
from ..config import Settings
from ..errors import EmhubMcpError, ErrorKind

logger = logging.getLogger(__name__)

# List filter parameters: lists are filtered on the client side instead.
FORBIDDEN_KEYS = frozenset({"condition", "orderBy", "order_by"})

READ_RETRY_DELAYS = (0.5, 1.5, 3.0)
MAX_ERROR_LOG_CHARS = 5000


def _contains_forbidden_key(value: Any) -> bool:
    if isinstance(value, Mapping):
        return any(k in FORBIDDEN_KEYS or _contains_forbidden_key(v) for k, v in value.items())
    if isinstance(value, list):
        return any(_contains_forbidden_key(v) for v in value)
    return False


def clean_server_message(message: str) -> str:
    """First line of an EMhub error message, without the traceback and prefix."""
    text = message
    for marker in (". Traceback:", "Traceback (most recent call last)"):
        if marker in text:
            text = text.split(marker, 1)[0]
    text = text.removeprefix("ERROR from Server: ").strip()
    first = text.splitlines()[0].strip() if text else ""
    if len(first) > 300:
        first = first[:297] + "..."
    return first or "EMhub reported an error without a message."


class EmhubClient:
    """One HTTP session with an EMhub server."""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx2.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = anyio.sleep,
    ) -> None:
        self._settings = settings
        self._sleep = sleep
        self._http = httpx2.AsyncClient(
            base_url=settings.server_url,
            timeout=settings.http_timeout,
            transport=transport,
            trust_env=settings.use_env_proxy,
            follow_redirects=False,
            headers={"Accept": "application/json", "User-Agent": f"emhub-tomo-mcp/{__version__}"},
        )
        self._login_lock = anyio.Lock()
        self._logged_in = False

    @property
    def server_url(self) -> str:
        return self._settings.server_url

    async def aclose(self) -> None:
        await self._http.aclose()

    async def call(
        self,
        method: str,
        attrs: Mapping[str, Any] | None = None,
        *,
        body: Any = None,
        mutating: bool = False,
        http_timeout: float | None = None,
    ) -> Any:
        """Call ``/api/<method>`` and return the decoded payload.

        ``attrs`` is sent as ``{"attrs": attrs}``; ``body`` replaces the whole body.
        """
        if body is None:
            body = {"attrs": dict(attrs or {})}
        if _contains_forbidden_key(body):
            raise EmhubMcpError(
                ErrorKind.INTERNAL,
                "Refusing to send list filter parameters to EMhub.",
                log_detail=f"method={method}",
            )
        if self._settings.auth == "password" and not self._logged_in:
            await self.login()

        delays = () if mutating else READ_RETRY_DELAYS
        relogged = False
        attempt = 0
        while True:
            try:
                return await self._call_once(method, body, http_timeout)
            except _NeedsLogin:
                if relogged or not self._may_login():
                    raise self._auth_required() from None
                relogged = True
                self._logged_in = False
                await self.login()
            except _Retryable as exc:
                if attempt >= len(delays):
                    raise exc.error from None
                logger.info("EMhub %s failed (%s), retrying", method, exc.error.message)
                await self._sleep(delays[attempt])
                attempt += 1

    async def login(self) -> None:
        """Log in with the configured credentials (once, even if called concurrently)."""
        if not self._settings.can_login:
            raise self._auth_required()
        async with self._login_lock:
            if self._logged_in:
                return
            assert self._settings.username is not None
            assert self._settings.password is not None
            body = {
                "username": self._settings.username,
                "password": self._settings.password.get_secret_value(),
            }
            try:
                await self._call_once("login", body, None)
            except _Retryable as exc:
                raise exc.error from None
            except _NeedsLogin:
                raise self._login_rejected() from None
            except EmhubMcpError as exc:
                if exc.kind is ErrorKind.UPSTREAM_ERROR:
                    raise self._login_rejected() from None
                raise
            self._logged_in = True
            logger.info("Logged in to EMhub as %s", self._settings.username)

    def _may_login(self) -> bool:
        return self._settings.auth != "autologin" and self._settings.can_login

    def _auth_required(self) -> EmhubMcpError:
        if self._settings.auth == "autologin" or not self._settings.can_login:
            hint = (
                "This EMhub server requires a login. Either serve it with 'emh-tomo --run' "
                "(which logs in automatically) or set EMHUB_USER and EMHUB_PASSWORD_FILE."
            )
        else:
            hint = "Check EMHUB_USER and the password, and that the account is active."
        return EmhubMcpError(ErrorKind.AUTH, "EMhub did not accept the session.", hint=hint)

    def _login_rejected(self) -> EmhubMcpError:
        return EmhubMcpError(
            ErrorKind.AUTH,
            f"EMhub rejected the login for user '{self._settings.username}'.",
            hint="Check EMHUB_USER and EMHUB_PASSWORD / EMHUB_PASSWORD_FILE.",
        )

    def _unreachable(self, reason: str) -> EmhubMcpError:
        return EmhubMcpError(
            ErrorKind.UNREACHABLE,
            f"Cannot reach EMhub at {self.server_url} ({reason}).",
            hint="Is 'emh-tomo --run' (or the EMhub server) running, and is "
            "EMHUB_SERVER_URL the URL and port it printed?",
        )

    async def _call_once(self, method: str, body: Any, http_timeout: float | None) -> Any:
        started = time.monotonic()
        try:
            response = await self._http.post(
                f"/api/{method}",
                json=body,
                timeout=http_timeout if http_timeout is not None else self._settings.http_timeout,
            )
        except httpx2.TimeoutException:
            raise _Retryable(self._unreachable("timed out")) from None
        except httpx2.TransportError as exc:
            raise _Retryable(self._unreachable(type(exc).__name__)) from None
        finally:
            logger.debug("EMhub %s took %.3f s", method, time.monotonic() - started)

        status = response.status_code
        if status == 401 or (
            status in (301, 302, 303, 307, 308)
            and "login" in response.headers.get("location", "").lower()
        ):
            raise _NeedsLogin
        if status == 404:
            raise EmhubMcpError(
                ErrorKind.UNSUPPORTED,
                f"This EMhub server has no '/api/{method}' endpoint.",
                hint="The server may run an older EMhub version.",
            )
        if status >= 500:
            raise _Retryable(
                EmhubMcpError(
                    ErrorKind.UPSTREAM_ERROR,
                    f"EMhub answered HTTP {status} to '{method}'.",
                    log_detail=response.text[:MAX_ERROR_LOG_CHARS],
                )
            )
        if status >= 300:
            raise EmhubMcpError(
                ErrorKind.UPSTREAM_ERROR,
                f"EMhub answered HTTP {status} to '{method}'.",
                log_detail=response.text[:MAX_ERROR_LOG_CHARS],
            )
        return self._decode(method, response)

    @staticmethod
    def _decode(method: str, response: httpx2.Response) -> Any:
        text = response.text
        try:
            data = json.loads(text)
        except ValueError:
            if "<html" in text[:500].lower() and "login" in text.lower():
                raise _NeedsLogin from None
            return text
        if isinstance(data, dict):
            if "error" in data:
                raw = str(data["error"])
                raise EmhubMcpError(
                    ErrorKind.UPSTREAM_ERROR,
                    f"EMhub reported an error in '{method}': {clean_server_message(raw)}",
                    log_detail=raw[:MAX_ERROR_LOG_CHARS],
                )
            if "errors" in data and isinstance(data["errors"], list):
                details = [clean_server_message(str(e)) for e in data["errors"]][:50]
                raise EmhubMcpError(
                    ErrorKind.VALIDATION,
                    f"EMhub rejected '{method}':",
                    details=details,
                )
        return data


class _NeedsLogin(Exception):
    pass


class _Retryable(Exception):
    def __init__(self, error: EmhubMcpError) -> None:
        super().__init__(error.message)
        self.error = error
