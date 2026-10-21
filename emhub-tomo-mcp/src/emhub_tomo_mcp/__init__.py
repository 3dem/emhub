# SPDX-License-Identifier: GPL-3.0-or-later
"""MCP server for EMhub-Tomo cryo-ET processing projects.

The package has three layers:

- ``emhub``: an async client for the EMhub REST API (no MCP imports);
- ``domain``: projects, jobs, job types, files and logs, built on the client,
  with access checks and output shaping;
- ``server``: the MCP server (tools, resources, prompts) on top of the domain.
"""

__version__ = "0.2.0"
