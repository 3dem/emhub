# SPDX-License-Identifier: GPL-3.0-or-later
"""Build the MCP server."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from importlib import resources as importlib_resources

from mcp.server.mcpserver import MCPServer

from .. import __version__
from ..services import Services
from .prompts import register_prompts
from .resources import register_resources
from .tools_read import register_read_tools
from .tools_write import register_write_tools

logger = logging.getLogger(__name__)

SERVER_NAME = "emhub-tomo"


def _resource_text(name: str) -> str:
    return (importlib_resources.files("emhub_tomo_mcp.server") / name).read_text(encoding="utf-8")


def instructions(access: str = "read") -> str:
    text = _resource_text("instructions.md")
    if access == "read":
        return text
    text = text.replace(
        "- This server cannot change anything: it cannot create projects, edit parameters, or "
        "launch, stop or delete jobs. Tell the user what to change and where, instead.\n",
        "",
    )
    return text + "\n" + _resource_text("instructions_write.md").replace("{access}", access)


def build_server(services: Services) -> MCPServer[Services]:
    """The MCP server, with the tools allowed by the configured access level:
    read tools always; the change tools with 'operate'; delete_jobs with 'admin'."""

    @asynccontextmanager
    async def lifespan(_: MCPServer[Services]) -> AsyncIterator[Services]:
        for warning in services.config_warnings:
            logger.warning("Configuration: %s", warning)
        try:
            yield services
        finally:
            await services.aclose()

    mcp: MCPServer[Services] = MCPServer(
        SERVER_NAME,
        title="EMhub-Tomo",
        description=(
            "Access to EMhub-Tomo cryo-ET processing projects "
            f"({'read-only' if not services.settings.can_write else services.settings.access})."
        ),
        instructions=instructions(services.settings.access),
        version=__version__,
        lifespan=lifespan,
        log_level=services.settings.log_level,
    )
    register_read_tools(mcp, services)
    if services.settings.can_write:
        register_write_tools(mcp, services)
    register_resources(mcp, services)
    register_prompts(mcp, can_write=services.settings.can_write)
    return mcp
