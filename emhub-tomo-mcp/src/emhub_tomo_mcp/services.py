# SPDX-License-Identifier: GPL-3.0-or-later
"""Wiring of the client and domain services, shared by the MCP server and the CLI."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import httpx2

from . import __version__
from .config import Settings
from .domain.files import FileService
from .domain.job_types import JobTypeService
from .domain.jobs import JobService
from .domain.models import ServerStatus
from .domain.projects import ProjectCatalog
from .emhub.client import EmhubClient
from .emhub.endpoints import EmhubApi
from .errors import EmhubMcpError, ErrorKind

# Optional EMhub endpoints and what depends on them.
OPTIONAL_ENDPOINTS = {
    "get_workflows": "list_workflow_templates",
    "get_job_types": "list_job_types (otherwise EMhub's processing menu is used)",
}


@dataclass
class Services:
    settings: Settings
    client: EmhubClient
    api: EmhubApi
    projects: ProjectCatalog
    jobs: JobService
    job_types: JobTypeService
    files: FileService
    config_warnings: list[str] = field(default_factory=list)

    @classmethod
    def create(
        cls,
        settings: Settings,
        *,
        transport: httpx2.AsyncBaseTransport | None = None,
        config_warnings: Sequence[str] = (),
    ) -> Services:
        client = EmhubClient(settings, transport=transport)
        api = EmhubApi(client)
        return cls(
            settings=settings,
            client=client,
            api=api,
            projects=ProjectCatalog(api, settings),
            jobs=JobService(api),
            job_types=JobTypeService(api),
            files=FileService(api),
            config_warnings=list(config_warnings),
        )

    async def aclose(self) -> None:
        await self.client.aclose()

    async def probe_capabilities(self) -> dict[str, bool]:
        capabilities = {}
        for endpoint in OPTIONAL_ENDPOINTS:
            try:
                await self.client.call(endpoint, {})
                capabilities[endpoint] = True
            except EmhubMcpError as exc:
                if exc.kind is not ErrorKind.UNSUPPORTED:
                    raise
                capabilities[endpoint] = False
        return capabilities

    async def status(self) -> ServerStatus:
        """Reachability, identity and capabilities; never raises for EMhub problems."""
        status = ServerStatus(
            mcp_server_version=__version__,
            emhub_url=self.settings.server_url,
            reachable=False,
            identity=None,
            auth_mode=self.settings.auth,
            access_level="read",
            capabilities={},
            visible_projects=None,
            warnings=list(self.config_warnings),
        )
        try:
            self.projects.invalidate()
            identity = await self.projects.identity()
            status.reachable = True
            status.identity = identity.public
            status.visible_projects = await self.projects.count()
            status.capabilities = await self.probe_capabilities()
        except EmhubMcpError as exc:
            status.reachable = status.reachable or exc.kind is not ErrorKind.UNREACHABLE
            status.error = f"[{exc.kind.value}] {exc.message}" + (
                f" {exc.hint}" if exc.hint else ""
            )
        return status
