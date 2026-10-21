# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fake_emhub import ROOT_A, ROOT_B, FakeEmhub

from emhub_tomo_mcp.config import Settings
from emhub_tomo_mcp.domain.projects import ProjectCatalog
from emhub_tomo_mcp.emhub import EmhubApi, EmhubClient
from emhub_tomo_mcp.errors import EmhubMcpError, ErrorKind
from emhub_tomo_mcp.services import Services

pytestmark = pytest.mark.anyio


async def test_admin_sees_own_and_all(services: Services) -> None:
    mine = await services.projects.list()
    assert [(p.id, p.access) for p in mine.projects] == [(1, "owner")]
    everything = await services.projects.list(scope="all")
    # Most recently updated first; entry 9 is not a tomo project.
    assert [(p.id, p.access) for p in everything.projects] == [
        (2, "admin"),
        (1, "owner"),
        (3, "admin"),
    ]
    project = everything.projects[1]
    assert (project.title, project.processing_path, project.owner) == (
        "ApoF tutorial",
        ROOT_A,
        "admin",
    )
    # An empty title falls back to the folder name.
    assert everything.projects[0].title == "bob1"


async def test_owner_and_shares(services_for: Any) -> None:
    bob = services_for(EMHUB_USER="bob")
    assert [(p.id, p.access) for p in (await bob.projects.list(scope="all")).projects] == [
        (2, "owner"),
        (3, "owner"),
    ]
    carol = services_for(EMHUB_USER="carol")  # e-mail matches case-insensitively
    assert [(p.id, p.access) for p in (await carol.projects.list()).projects] == [
        (2, "viewer"),
        (3, "editor"),
    ]
    with pytest.raises(EmhubMcpError) as info:
        await carol.projects.get(1)
    assert info.value.kind is ErrorKind.NOT_FOUND
    assert "1 (" not in info.value.message  # never suggests invisible projects


async def test_unknown_user(services_for: Any) -> None:
    ghost = services_for(EMHUB_USER="ghost")
    with pytest.raises(EmhubMcpError) as info:
        await ghost.projects.list()
    assert info.value.kind is ErrorKind.AUTH and "no user 'ghost'" in info.value.message


async def test_allowlist(services_for: Any) -> None:
    svc = services_for(EMHUB_TOMO_MCP_PROJECTS="2")
    assert [p.id for p in (await svc.projects.list(scope="all")).projects] == [2]
    with pytest.raises(EmhubMcpError) as info:
        await svc.projects.get(1)
    assert info.value.kind is ErrorKind.POLICY_DENIED


async def test_search_and_pages(services: Services) -> None:
    found = await services.projects.list(scope="all", search="BOB")
    assert [p.id for p in found.projects] == [2, 3]
    assert [p.id for p in (await services.projects.list(scope="all", search="3")).projects] == [3]
    assert (await services.projects.list(scope="all", search=ROOT_B)).total == 1
    first = await services.projects.list(scope="all", limit=2)
    assert first.total == 3 and len(first.projects) == 2 and first.next_cursor
    second = await services.projects.list(scope="all", limit=2, cursor=first.next_cursor)
    assert [p.id for p in second.projects] == [3] and second.next_cursor is None
    with pytest.raises(EmhubMcpError):
        await services.projects.list(scope="mine", limit=2, cursor=first.next_cursor)


async def test_get_suggests_close_ids(services: Services) -> None:
    with pytest.raises(EmhubMcpError) as info:
        await services.projects.get(12)
    assert "Closest matches" in info.value.message


async def test_cache(fake: FakeEmhub, make_settings: Callable[..., Settings]) -> None:
    now = [0.0]
    client = EmhubClient(make_settings(), transport=fake.transport())
    catalog = ProjectCatalog(EmhubApi(client), make_settings(), clock=lambda: now[0])
    await catalog.list()
    await catalog.get(1)
    assert len(fake.calls_to("get_entries")) == 1
    now[0] = 11.0
    await catalog.list()
    assert len(fake.calls_to("get_entries")) == 2
    catalog.invalidate()
    await catalog.list()
    assert len(fake.calls_to("get_entries")) == 3
    # Only the fields the server needs are requested from get_users.
    assert fake.calls_to("get_users")[0] == {"attrs": ["id", "username", "email", "name", "roles"]}
    await client.aclose()


async def test_never_sends_list_filters(services: Services, fake: FakeEmhub) -> None:
    await services.projects.list(scope="all")
    await services.jobs.project_detail(await services.projects.get(1))
    for _, body in fake.calls:
        assert "condition" not in str(body) and "orderBy" not in str(body)
