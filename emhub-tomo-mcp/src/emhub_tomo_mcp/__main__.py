# SPDX-License-Identifier: GPL-3.0-or-later
"""Command line: run the MCP server on stdio, or check the configuration.

    emhub-tomo-mcp                 serve MCP on stdin/stdout
    emhub-tomo-mcp --check         test the connection to EMhub and exit
    emhub-tomo-mcp --print-config  show the configuration (password hidden) and exit

stdout carries only the MCP protocol; logs go to stderr.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

import anyio

from . import __version__
from .config import ConfigError, LoadedSettings, load_settings
from .services import OPTIONAL_ENDPOINTS, Services

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    # httpx-style clients log every request at INFO.
    logging.getLogger("httpx2").setLevel(max(logging.WARNING, root.level))


async def run_check(loaded: LoadedSettings) -> int:
    services = Services.create(loaded.settings, config_warnings=loaded.load_warnings)
    try:
        status = await services.status()
    finally:
        await services.aclose()
    print(f"emhub-tomo-mcp {__version__}")
    print(f"EMhub URL:        {status.emhub_url}")
    print(f"Authentication:   {status.auth_mode}")
    if status.identity:
        roles = ", ".join(status.identity.roles) or "none"
        print(f"Acting as:        {status.identity.username} (roles: {roles})")
        print(f"Visible projects: {status.visible_projects}")
        for endpoint, available in status.capabilities.items():
            state = "yes" if available else f"no (affects {OPTIONAL_ENDPOINTS[endpoint]})"
            print(f"/api/{endpoint}: {state}")
    for warning in status.warnings:
        print(f"Warning: {warning}")
    if status.error:
        print(f"Problem: {status.error}")
        return 1
    print("OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="emhub-tomo-mcp",
        description="MCP server for EMhub-Tomo (stdio transport).",
        epilog="Configuration comes from environment variables; see docs/configuration.md.",
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--check", action="store_true", help="test the connection and exit")
    group.add_argument("--print-config", action="store_true", help="print the configuration")
    group.add_argument("--version", action="version", version=f"emhub-tomo-mcp {__version__}")
    args = parser.parse_args(argv)

    try:
        loaded = load_settings()
    except ConfigError as exc:
        print(f"emhub-tomo-mcp: configuration error: {exc}", file=sys.stderr)
        return 2
    configure_logging(loaded.settings.log_level)

    if args.print_config:
        print(json.dumps(loaded.settings.redacted(), indent=2))
        for warning in loaded.load_warnings:
            print(f"Warning: {warning}", file=sys.stderr)
        return 0
    if args.check:
        return anyio.run(run_check, loaded)

    from .server import build_server

    services = Services.create(loaded.settings, config_warnings=loaded.load_warnings)
    build_server(services).run("stdio")
    return 0


if __name__ == "__main__":
    sys.exit(main())
