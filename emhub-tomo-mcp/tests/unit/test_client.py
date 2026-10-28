# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

import httpx2
import pytest
from fake_emhub import FakeEmhub

from emhub_tomo_mcp.config import Settings
from emhub_tomo_mcp.emhub.client import EmhubClient, clean_server_message
from emhub_tomo_mcp.errors import EmhubMcpError, ErrorKind

pytestmark = pytest.mark.anyio


class Sleeps:
    def __init__(self) -> None:
        self.delays: list[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


def client_for(settings: Settings, handler: Any, sleeps: Sleeps | None = None) -> EmhubClient:
    return EmhubClient(settings, transport=httpx2.MockTransport(handler), sleep=sleeps or Sleeps())


def test_clean_server_message() -> None:
    raw = (
        "ERROR from Server: Parent path '/x' does not exist!. Traceback: Traceback (most "
        'recent call last):\n  File "/srv/api.py"'
    )
    assert clean_server_message(raw) == "Parent path '/x' does not exist!"
    assert clean_server_message("") == "EMhub reported an error without a message."
    assert clean_server_message("x" * 400).endswith("...")
    assert clean_server_message("first\nsecond") == "first"


async def test_request_shape(make_settings: Callable[..., Settings]) -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(200, json=[1, 2])

    client = client_for(make_settings(), handler)
    assert await client.call("get_entries", {"a": 1}) == [1, 2]
    assert await client.call("get_users", body={"attrs": ["id"]}) == [1, 2]
    await client.aclose()
    assert [r.url.path for r in seen] == ["/api/get_entries", "/api/get_users"]
    assert json.loads(seen[0].content) == {"attrs": {"a": 1}}
    assert json.loads(seen[1].content) == {"attrs": ["id"]}
    assert seen[0].headers["accept"] == "application/json"
    assert seen[0].headers["user-agent"].startswith("emhub-tomo-mcp/")


async def test_refuses_list_filters(make_settings: Callable[..., Settings]) -> None:
    client = client_for(make_settings(), lambda r: httpx2.Response(200, json=[]))
    for body in ({"condition": "1=1"}, {"attrs": {"x": [{"orderBy": "id"}]}}):
        with pytest.raises(EmhubMcpError) as info:
            await client.call("get_entries", body=body)
        assert info.value.kind is ErrorKind.INTERNAL
    await client.aclose()


@pytest.mark.parametrize(
    ("payload", "kind", "fragment"),
    [
        (
            {
                "error": "ERROR from Server: boom. Traceback: Traceback (most recent call last):\n"
                "  File secret"
            },
            ErrorKind.UPSTREAM_ERROR,
            "boom",
        ),
        (
            {"errors": ["Mdoc files: no files match", "Gain file: missing"], "status": 1},
            ErrorKind.VALIDATION,
            "rejected",
        ),
    ],
)
async def test_error_payloads(
    make_settings: Callable[..., Settings], payload: Any, kind: ErrorKind, fragment: str
) -> None:
    client = client_for(make_settings(), lambda r: httpx2.Response(200, json=payload))
    with pytest.raises(EmhubMcpError) as info:
        await client.call("launch_job", {})
    await client.aclose()
    error = info.value
    assert error.kind is kind
    assert fragment in error.message
    message = error.to_tool_message("ref1")
    assert "Traceback" not in message and "secret" not in message
    if kind is ErrorKind.VALIDATION:
        assert error.details == ["Mdoc files: no files match", "Gain file: missing"]
    else:
        assert error.log_detail is not None and "Traceback" in error.log_detail


async def test_text_and_html_answers(make_settings: Callable[..., Settings]) -> None:
    client = client_for(make_settings(), lambda r: httpx2.Response(200, text="OK"))
    assert await client.call("logout", {}) == "OK"
    await client.aclose()
    login_page = "<html><form action='/login'>login</form></html>"
    client = client_for(make_settings(), lambda r: httpx2.Response(200, text=login_page))
    with pytest.raises(EmhubMcpError) as info:
        await client.call("get_entries", {})
    assert info.value.kind is ErrorKind.AUTH
    await client.aclose()


async def test_404_is_unsupported(make_settings: Callable[..., Settings]) -> None:
    client = client_for(make_settings(), lambda r: httpx2.Response(404, text="nope"))
    with pytest.raises(EmhubMcpError) as info:
        await client.call("get_job_types", {})
    await client.aclose()
    assert info.value.kind is ErrorKind.UNSUPPORTED
    assert "/api/get_job_types" in info.value.message


async def test_redirects_and_other_statuses(make_settings: Callable[..., Settings]) -> None:
    client = client_for(
        make_settings(), lambda r: httpx2.Response(302, headers={"location": "/login?next=/api/x"})
    )
    with pytest.raises(EmhubMcpError) as info:
        await client.call("get_entries", {})
    assert info.value.kind is ErrorKind.AUTH
    await client.aclose()
    client = client_for(make_settings(), lambda r: httpx2.Response(403, text="forbidden"))
    with pytest.raises(EmhubMcpError) as info:
        await client.call("get_entries", {})
    assert info.value.kind is ErrorKind.UPSTREAM_ERROR and "403" in info.value.message
    await client.aclose()


async def test_reads_are_retried(make_settings: Callable[..., Settings]) -> None:
    attempts = []

    def flaky(request: httpx2.Request) -> httpx2.Response:
        attempts.append(1)
        if len(attempts) == 1:
            raise httpx2.ConnectError("refused")
        if len(attempts) == 2:
            return httpx2.Response(502, text="bad gateway")
        return httpx2.Response(200, json={"ok": True})

    sleeps = Sleeps()
    client = client_for(make_settings(), flaky, sleeps)
    assert await client.call("get_entries", {}) == {"ok": True}
    await client.aclose()
    assert len(attempts) == 3 and sleeps.delays == [0.5, 1.5]


async def test_unreachable_after_retries(make_settings: Callable[..., Settings]) -> None:
    def down(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refused")

    sleeps = Sleeps()
    client = client_for(make_settings(), down, sleeps)
    with pytest.raises(EmhubMcpError) as info:
        await client.call("get_entries", {})
    await client.aclose()
    assert info.value.kind is ErrorKind.UNREACHABLE
    assert "emh-tomo --run" in (info.value.hint or "")
    assert len(sleeps.delays) == 3


async def test_timeout_and_mutations_not_retried(make_settings: Callable[..., Settings]) -> None:
    attempts = []

    def slow(request: httpx2.Request) -> httpx2.Response:
        attempts.append(1)
        raise httpx2.ReadTimeout("slow")

    client = client_for(make_settings(), slow)
    with pytest.raises(EmhubMcpError) as info:
        await client.call("launch_job", {}, mutating=True)
    await client.aclose()
    assert info.value.kind is ErrorKind.UNREACHABLE and "timed out" in info.value.message
    assert len(attempts) == 1


async def test_auto_mode_logs_in_on_401(
    fake: FakeEmhub, make_settings: Callable[..., Settings]
) -> None:
    fake.require_login = True
    settings = make_settings(EMHUB_USER="admin", EMHUB_PASSWORD="s3cret")
    client = EmhubClient(settings, transport=fake.transport())
    assert len(await client.call("get_entries", {})) == 4
    assert [m for m, _ in fake.calls] == ["get_entries", "login", "get_entries"]
    # Session expired on the server: one transparent re-login.
    fake.logged_in = None
    assert len(await client.call("get_entries", {})) == 4
    assert [m for m, _ in fake.calls].count("login") == 2
    await client.aclose()


async def test_password_mode_logs_in_first(
    fake: FakeEmhub, make_settings: Callable[..., Settings], caplog: pytest.LogCaptureFixture
) -> None:
    fake.require_login = True
    caplog.set_level(logging.DEBUG)
    settings = make_settings(
        EMHUB_TOMO_MCP_AUTH="password", EMHUB_USER="admin", EMHUB_PASSWORD="s3cret"
    )
    client = EmhubClient(settings, transport=fake.transport())
    await client.call("get_entries", {})
    await client.call("get_projects", {})
    await client.aclose()
    assert [m for m, _ in fake.calls] == ["login", "get_entries", "get_projects"]
    assert "s3cret" not in caplog.text


async def test_login_rejected(fake: FakeEmhub, make_settings: Callable[..., Settings]) -> None:
    fake.require_login = True
    settings = make_settings(EMHUB_USER="admin", EMHUB_PASSWORD="wrong")
    client = EmhubClient(settings, transport=fake.transport())
    with pytest.raises(EmhubMcpError) as info:
        await client.call("get_entries", {})
    await client.aclose()
    assert info.value.kind is ErrorKind.AUTH
    assert "rejected the login for user 'admin'" in info.value.message
    assert "wrong" not in info.value.to_tool_message("x")


async def test_401_without_credentials(
    fake: FakeEmhub, make_settings: Callable[..., Settings]
) -> None:
    fake.require_login = True
    for env in (
        {},
        {"EMHUB_TOMO_MCP_AUTH": "autologin", "EMHUB_USER": "admin", "EMHUB_PASSWORD": "s3cret"},
    ):
        client = EmhubClient(make_settings(**env), transport=fake.transport())
        with pytest.raises(EmhubMcpError) as info:
            await client.call("get_entries", {})
        await client.aclose()
        assert info.value.kind is ErrorKind.AUTH
        assert "requires a login" in (info.value.hint or "")
    assert "login" not in [m for m, _ in fake.calls]


async def test_login_errors(make_settings: Callable[..., Settings]) -> None:
    settings = make_settings(EMHUB_TOMO_MCP_AUTH="password", EMHUB_USER="a", EMHUB_PASSWORD="b")

    def unauthorized(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(401)

    client = client_for(settings, unauthorized)
    with pytest.raises(EmhubMcpError) as info:
        await client.call("get_entries", {})
    assert info.value.kind is ErrorKind.AUTH
    await client.aclose()

    def down(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refused")

    client = client_for(settings, down)
    with pytest.raises(EmhubMcpError) as info:
        await client.login()
    assert info.value.kind is ErrorKind.UNREACHABLE
    await client.aclose()

    client = client_for(make_settings(), down)
    with pytest.raises(EmhubMcpError) as info:
        await client.login()
    assert info.value.kind is ErrorKind.AUTH
    await client.aclose()
