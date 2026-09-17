# **************************************************************************
# *
# * Authors:     J.M. De la Rosa Trevin (delarosatrevin@scilifelab.se) [1]
# *
# * [1] SciLifeLab, Stockholm University
# *
# * This program is free software; you can redistribute it and/or modify
# * it under the terms of the GNU General Public License as published by
# * the Free Software Foundation; either version 3 of the License, or
# * (at your option) any later version.
# *
# * This program is distributed in the hope that it will be useful,
# * but WITHOUT ANY WARRANTY; without even the implied warranty of
# * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# * GNU General Public License for more details.
# *
# * You should have received a copy of the GNU General Public License
# * along with this program; if not, write to the Free Software
# * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA
# * 02111-1307  USA
# *
# *  All comments concerning this program package may be sent to the
# *  e-mail address 'delarosatrevin@scilifelab.se'
# *
# **************************************************************************
"""
EMhub MCP server: exposes the EMhub booking system and data processing
functionality as MCP tools, so an LLM agent (Claude Desktop, Claude
Code, etc.) can query and operate on a running EMhub instance.

It connects to EMhub over its existing REST API
(``emhub.client.data_client.DataClient``), using the same environment
variables as any other EMhub client script:

    EMHUB_SERVER_URL   e.g. https://emhub.example.org (default http://127.0.0.1:5000)
    EMHUB_USER         Username to login with.
    EMHUB_PASSWORD     Password for that user.

The 'mcp' package itself is an optional dependency of emhub (most
installs don't need it): install it with ``pip install emhub[mcp]``
(or plain ``pip install mcp``) before running this server.

Two tool groups (modules) are registered:

    * booking      - users, roles, resources, bookings, sessions.
    * processing   - list processing projects; per project: inspect,
                     run and schedule jobs and workflows.

Read-only tools are always available. Write/action tools (creating or
modifying bookings/sessions/users/resources, and running/stopping
processing jobs) are only registered when the EMhub user configured
via EMHUB_USER has the 'admin' or 'developer' role -- regular users
only get read access. This means the *server* (not the MCP client) is
what enforces read-only vs read-write, by logging in as a user with
the appropriate EMhub role.

Usage:

    export EMHUB_SERVER_URL=https://emhub.example.org
    export EMHUB_USER=myuser
    export EMHUB_PASSWORD=mypassword
    emh-mcp                      # or: python -m emhub.mcp

This runs the server over stdio, ready to be configured as an MCP
server in Claude Desktop / Claude Code (command: ``emh-mcp``).
"""

import sys

# 'mcp' is an optional dependency of emhub (most installs -- the Flask
# server, client scripts, workers, ... -- don't need it), so import it
# lazily and fail with a clear message only when the MCP server is
# actually started, instead of an ImportError traceback.
try:
    from mcp.server.fastmcp import FastMCP
except ImportError as _exc:
    # Python deletes the 'as' target at the end of the except block, so
    # stash it in a plain module-level name to use in the error message
    # raised later, in _check_mcp_installed().
    FastMCP = None
    _mcp_import_error = _exc
else:
    _mcp_import_error = None

from emhub.mcp.emhub_client import EmhubMcpClient, EmhubMcpError
from emhub.mcp import booking, processing


def _check_mcp_installed():
    if FastMCP is None:
        raise EmhubMcpError(
            "The 'mcp' package is not installed. It is an optional "
            "dependency of emhub -- install it with:\n"
            "    pip install emhub[mcp]\n"
            "or:\n"
            "    pip install mcp\n"
            "(original import error: %s)" % _mcp_import_error)


def build_server(server_url=None, username=None, password=None):
    """ Connect to EMhub and build the FastMCP server with the booking
    and processing tools registered according to the connected user's
    permissions.

    Returns:
        (mcp, client): the FastMCP server instance and the connected
        EmhubMcpClient (kept around so the caller can log out on exit).
    """
    _check_mcp_installed()

    client = EmhubMcpClient(server_url=server_url, username=username,
                            password=password)
    client.connect()

    allow_write = client.is_admin
    print("emhub-mcp: connected to %s as %r (roles=%s); write tools %s."
         % (client.server_url, client.username, client.roles,
            'ENABLED' if allow_write else 'disabled (read-only)'),
         file=sys.stderr)

    mcp = FastMCP(
        'emhub',
        instructions=(
            "Tools to query and operate the EMhub facility management "
            "system: the booking system (users, roles, resources, "
            "bookings, sessions) and data processing (processing "
            "projects, jobs and workflows). "
            + ("Write/action tools are available for this user."
               if allow_write else
               "This user only has read access; no write/action tools "
               "are available.")
        ),
    )

    booking.register_tools(mcp, client, allow_write)
    processing.register_tools(mcp, client, allow_write)

    return mcp, client


def main():
    mcp = client = None
    try:
        mcp, client = build_server()
        mcp.run(transport='stdio')
    except EmhubMcpError as e:
        print("emhub-mcp: %s" % e, file=sys.stderr)
        sys.exit(1)
    finally:
        if client is not None:
            client.close()


if __name__ == '__main__':
    main()
