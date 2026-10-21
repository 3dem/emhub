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

logger = logging.getLogger(__name__)

SERVER_NAME = "emhub-tomo"


def instructions() -> str:
    return (importlib_resources.files("emhub_tomo_mcp.server") / "instructions.md").read_text(
        encoding="utf-8"
    )


def build_server(services: Services) -> MCPServer[Services]:
    """The MCP server, with the tools allowed by the configured access level.

    This version only has read-only tools, so every access level gets the same set.
    """

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
        description="Read-only access to EMhub-Tomo cryo-ET processing projects.",
        instructions=instructions(),
        version=__version__,
        lifespan=lifespan,
        log_level=services.settings.log_level,
    )
    register_read_tools(mcp, services)
    register_resources(mcp, services)
    register_prompts(mcp)
    return mcp
