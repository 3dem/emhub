# emhub.mcp

An MCP (Model Context Protocol) server exposing EMhub as tools for LLM
agents (Claude Desktop, Claude Code, or any other MCP client).

It talks to a running EMhub instance over its existing REST API
(`emhub.client.data_client.DataClient`) — it does **not** need direct
database access and can run from any machine that can reach the EMhub
server over HTTP(S).

## Tool groups

- **booking** (`emhub.mcp.booking`) — users, roles, resources, bookings,
  sessions.
- **processing** (`emhub.mcp.processing`) — list processing projects
  (sessions with a processing path, or `tomo_processing` entries), and
  per project: inspect the workflow/jobs, run/schedule/stop/delete
  jobs, and load/run workflow templates.

## Permissions

Read-only tools (`list_*` / `get_*`) are always registered. Write and
action tools (`create_*` / `update_*` / `delete_*`, and the job/workflow
actions `save_job`, `launch_job`, `schedule_job`, `stop_jobs`,
`delete_jobs`, `duplicate_jobs`, `load_workflow`, `run_workflow`,
`export_workflow`, `save_job_annotation`) are **only** registered when
the EMhub user the server logs in as has the `admin` or `developer`
role. A server started with a regular user's credentials will only
expose read tools — this is decided once, at startup, based on
`EMHUB_USER`.

## Configuration

Same environment variables as any other EMhub client script:

```bash
export EMHUB_SERVER_URL=https://emhub.example.org   # default: http://127.0.0.1:5000
export EMHUB_USER=myuser
export EMHUB_PASSWORD=mypassword
```

## Running

The `mcp` package is an **optional** dependency of `emhub` (most
installs -- the Flask server, client scripts, workers, ... -- don't
need it). Install it with:

```bash
pip install emhub[mcp]
# or, if emhub is already installed:
pip install mcp
```

Then run the server:

```bash
emh-mcp
# or:
python -m emhub.mcp
```

If `mcp` is not installed, `emh-mcp` prints a short message telling you
to install it (instead of a raw ImportError traceback).

This starts the server over stdio, so it can be registered as an MCP
server in an MCP client, e.g. in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "emhub": {
      "command": "emh-mcp",
      "env": {
        "EMHUB_SERVER_URL": "https://emhub.example.org",
        "EMHUB_USER": "myuser",
        "EMHUB_PASSWORD": "mypassword"
      }
    }
  }
}
```

## Files

- `emhub_client.py` — thin synchronous wrapper around `DataClient`
  (login, generic `get`/`call`/`raw` request helpers, current-user role
  resolution).
- `booking.py` — booking-system tools.
- `processing.py` — data-processing tools.
- `server.py` — builds the `FastMCP` server (registers tools based on
  the connected user's permissions) and the `emh-mcp` entry point.

## Notes

- `list_workflow_templates` relies on a small new read-only endpoint,
  `/api/get_workflows` (added in `emhub.blueprints.api`), that exposes
  `emwrap.base.ProcessingConfig.get_workflows()` over the REST API —
  it did not exist before, everything else re-uses existing endpoints.
- `run_workflow` is a convenience composite: it calls `load_workflow`
  (which creates the jobs defined by a workflow template) and then
  `schedule_job` for each newly created job, so the whole pipeline
  starts running. Use `load_workflow` + `launch_job`/`schedule_job`
  individually for finer control over individual jobs.
- List/get tools accept a raw SQL `condition` (and `order_by`) string,
  same as the rest of the EMhub API (e.g. `emh-client method ...`) —
  this is consistent with existing EMhub client tooling, but keep in
  mind an MCP client (an LLM) can construct arbitrary read filters this
  way; only give write-capable (`admin`/`developer`) credentials to an
  MCP client you trust to act on your behalf.
