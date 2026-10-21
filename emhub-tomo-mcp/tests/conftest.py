# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import annotations

import sys
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).parent / "support"))  # fake_emhub, emhub_instance

from fake_emhub import FakeEmhub

from emhub_tomo_mcp.config import Settings, load_settings
from emhub_tomo_mcp.services import Services


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def fake() -> FakeEmhub:
    return FakeEmhub()


@pytest.fixture
def make_settings() -> Callable[..., Settings]:
    def make(**env: str) -> Settings:
        base = {"EMHUB_SERVER_URL": "http://127.0.0.1:5000"}
        base.update(env)
        return load_settings(base).settings

    return make


@pytest.fixture
async def services(
    fake: FakeEmhub, make_settings: Callable[..., Settings]
) -> AsyncIterator[Services]:
    svc = Services.create(make_settings(), transport=fake.transport())
    yield svc
    await svc.aclose()


@pytest.fixture
async def services_for(
    fake: FakeEmhub, make_settings: Callable[..., Settings]
) -> AsyncIterator[Any]:
    """Services acting as another user, e.g. services_for(EMHUB_USER='bob')."""
    created: list[Services] = []

    def make(**env: str) -> Services:
        svc = Services.create(make_settings(**env), transport=fake.transport())
        created.append(svc)
        return svc

    yield make
    for svc in created:
        await svc.aclose()
