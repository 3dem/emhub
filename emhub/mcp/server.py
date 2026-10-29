"""
EMhub MCP server: exposes the EMhub booking system and data processing
functionality as MCP tools, so an LLM agent (Claude Desktop, Claude Code,
etc.) can query and operate on a running EMhub instance.

It connects to EMhub over its existing REST API, using the same environment
variables as any other EMhub client script:

    EMHUB_SERVER_URL   e.g. https://emhub.example.org (default http://127.0.0.1:5000)
    EMHUB_USER         Username to login with.
    EMHUB_PASSWORD     Password for that user.
    EMHUB_TIMEZONE     Optional, timezone of input dates without offset
                       (e.g. America/Chicago), this machine's by default.

The 'mcp' package is an optional dependency of emhub (Python >= 3.10),
install it with ``pip install emhub[mcp]``.

Two tool groups are available, both served by default; use ``--tools`` to
run only one of them as its own server:

    * booking      - users, resources (instruments), bookings, sessions.
    * processing   - processing projects, their jobs and workflows.

Read tools and "safe" write tools (booking for oneself, running jobs) are
always registered, EMhub still validates every request with the
permissions of the logged in user. Admin tools (users, resources, deleting
jobs, ...) are only registered when that user has the 'admin' or
'developer' role.

Usage:

    emh-mcp                      # or: python -m emhub.mcp
    emh-mcp --tools booking

This runs the server over stdio, ready to be configured as an MCP server
in Claude Desktop / Claude Code (command: ``emh-mcp``).
"""

import sys
import argparse

from .client import EmhubMcpClient

GROUPS = ['booking', 'processing']

INSTRUCTIONS = {
    'booking': "booking_* tools: users, resources (instruments), bookings "
               "and microscope sessions.",
    'processing': "processing_* tools: processing projects (usually the "
                  "on-the-fly processing of a session, selected with "
                  "session_id), their jobs and workflows.",
}


def _import_fastmcp():
    """ Server class of the 'mcp' package: MCPServer in mcp 2.x, which is
    the FastMCP class of mcp 1.x renamed. """
    try:
        from mcp.server.mcpserver import MCPServer
        return MCPServer
    except ImportError:
        pass
    try:
        from mcp.server.fastmcp import FastMCP
        return FastMCP
    except ImportError as e:
        sys.exit("The 'mcp' package is not installed. It is an optional "
                 "dependency of emhub (Python >= 3.10), install it with:\n"
                 "    pip install emhub[mcp]\n"
                 f"(original import error: {e})")


def build_server(client, groups=None):
    """ Build the FastMCP server with the tools of the given groups.

    Args:
        client: A connected ``EmhubMcpClient``.
        groups: List of tool groups to register, all by default.
    """
    from . import booking, processing
    modules = {'booking': booking, 'processing': processing}
    groups = groups or GROUPS
    allow_admin = client.is_admin

    lines = ["Tools to query and operate the EMhub facility management "
             "system, logged in as %r (roles: %s)."
             % (client.username, ', '.join(client.roles) or 'user')]
    lines.extend(INSTRUCTIONS[g] for g in groups)
    lines.append("Input dates use the format 'YYYY-MM-DD HH:MM' in the local "
                 "time of the facility; dates returned by EMhub are in UTC "
                 "(ending in 'Z' or '+00:00'), convert them to local time "
                 "for the user. EMhub enforces the user permissions on "
                 "every request, report its error messages to the user.")
    if not allow_admin:
        lines.append("This user is not an admin, admin tools are not "
                     "available.")

    FastMCP = _import_fastmcp()
    mcp = FastMCP('emhub', instructions='\n'.join(lines))
    for g in groups:
        modules[g].register_tools(mcp, client, allow_admin)
    return mcp


def main():
    p = argparse.ArgumentParser(prog='emh-mcp',
                                description="EMhub MCP server (stdio).")
    p.add_argument('--tools', choices=['all'] + GROUPS, default='all',
                   help="Tool group(s) to serve (default: all).")
    args = p.parse_args()
    groups = GROUPS if args.tools == 'all' else [args.tools]

    _import_fastmcp()  # fail early if not installed
    client = EmhubMcpClient()
    client.connect()
    # stdout is the MCP channel, log to stderr
    print("emh-mcp: connected to %s as %r (roles=%s), tools: %s, admin "
          "tools %s." % (client.server_url, client.username, client.roles,
                         ', '.join(groups),
                         'ENABLED' if client.is_admin else 'disabled'),
          file=sys.stderr, flush=True)
    try:
        build_server(client, groups).run()
    finally:
        client.close()


if __name__ == '__main__':
    main()
