# Deployment

How to install and run the server for yourself or for the users of a facility, with MPCDF phys as the example. Settings are described in [configuration.md](configuration.md), clients in [client-setup.md](client-setup.md).

## How it runs

- The MCP client (Claude Code, VS Code, Claude Desktop) starts `emhub-tomo-mcp` as a subprocess and talks to it over stdio. There is no daemon and no network port; the process ends with the client session.
- Each process acts as one EMhub account (`EMHUB_USER`) and sees the projects that account sees. Every user runs their own process with their own account; nothing is shared between processes except EMhub itself.
- The server reaches EMhub only through its REST API, so it needs the EMhub URL, not the project files. It writes one file itself: the audit log of changes.

## Requirements

- Python ≥ 3.10 where the server runs. It is independent of the Python of the EMhub-Tomo installation.
- Network access from there to `EMHUB_SERVER_URL` (for `emh-tomo --run` on a login node: the same node, or an SSH tunnel).
- An EMhub-Tomo server. Some features need EMhub endpoints that older servers lack. The server works without them and `get_server_status` shows which are available:

  | EMhub endpoint | Used for | Without it |
  |---|---|---|
  | `/api/get_workflows` | `list_workflow_templates`, `load_workflow_template` | No templates |
  | `/api/get_job_types` | `list_job_types` | Job types come from the processing menu |
  | `/api/validate_job` | EMhub's own parameter checks before changes | Only the form is checked |

  These endpoints, and the new job ids returned by `load_workflow`, are on the emhub branch `dev-sc_mcp_server` (the first comes from `jm_mcp`).

## Install

With [uv](https://docs.astral.sh/uv/), from a checkout of the emhub repository:

```bash
uv tool install ./emhub-tomo-mcp
emhub-tomo-mcp --version
```

On clusters with a quota on the number of files in the home folder (MPCDF: about 500,000), keep uv's tools and cache on a project file system and only the command in `~/.local/bin`:

```bash
export UV_TOOL_DIR=/ptmp/$USER/uv/tools UV_CACHE_DIR=/ptmp/$USER/.cache/uv
uv tool install ./emhub-tomo-mcp      # the command still goes to ~/.local/bin
```

Without uv: `python3 -m venv /ptmp/$USER/venvs/emhub-tomo-mcp && /ptmp/$USER/venvs/emhub-tomo-mcp/bin/pip install ./emhub-tomo-mcp`, and use the absolute path of `bin/emhub-tomo-mcp` in the client configuration.

To upgrade, pull the repository and run `uv tool install --reinstall ./emhub-tomo-mcp`. Read [CHANGELOG.md](../CHANGELOG.md) first: tools and their parameters can change between versions. To remove it: `uv tool uninstall emhub-tomo-mcp`, and delete the state folder if you no longer need the audit log.

## Check

```bash
export EMHUB_SERVER_URL=http://127.0.0.1:5000      # what emh-tomo --run printed
emhub-tomo-mcp --print-config                       # effective settings, password hidden
emhub-tomo-mcp --check                              # reaches EMhub, logs in, counts projects
```

`--check` exits with a non-zero status and a one-line reason when something is wrong; [troubleshooting.md](troubleshooting.md) lists the usual causes. Configuration warnings (for example a password file readable by others) are printed by both commands and logged at every start.

## Choose the access level

| Level | For | Notes |
|---|---|---|
| `read` (default) | Everyone | Questions, diagnosis, reports. Nothing can change. |
| `operate` | Users who want the assistant to set up and run their processing | Configure it fully first (below). Changes are limited further by the user's right on each project. |
| `admin` | Project owners who also want deletions | Adds `delete_jobs` and clean re-runs. Rarely needed. |

Before enabling `operate`, set:

- `EMHUB_TOMO_MCP_ALLOWED_ROOTS`: the folders where projects and raw data may be. Without it, `create_project` is refused.
- `EMHUB_TOMO_MCP_DEFAULT_QUEUE`: a cluster queue for GPU jobs that name none. Leave `EMHUB_TOMO_MCP_ALLOW_LOCAL_GPU` off on shared login nodes, so no GPU job runs on the EMhub host.
- `EMHUB_TOMO_MCP_MAX_GPUS_PER_JOB` and `EMHUB_TOMO_MCP_MAX_ACTIVE_GPU_JOBS`: the share of the cluster the assistant may use.
- `EMHUB_TOMO_MCP_STATE_DIR`: where the audit log goes, on a file system that is backed up or at least persistent.

Then try the change tools with `dry_run: true` once, and look at the audit log.

## Example: MPCDF phys

EMhub-Tomo runs per user with `emh-tomo --run` on a login node and submits jobs to the Slurm queues `phys-a` and `phys-b`. The MCP client runs on the same node (Claude Code in a terminal or VS Code Remote), so no tunnel is needed.

`.mcp.json` in the working folder:

```json
{
  "mcpServers": {
    "emhub-tomo": {
      "command": "emhub-tomo-mcp",
      "env": {
        "EMHUB_SERVER_URL": "http://127.0.0.1:${EMHUB_TOMO_PORT:-5000}",
        "EMHUB_TOMO_MCP_ACCESS": "operate",
        "EMHUB_TOMO_MCP_ALLOWED_ROOTS": "/ptmp/${USER}/projects:/ptmp/${USER}/data",
        "EMHUB_TOMO_MCP_DEFAULT_QUEUE": "phys-a",
        "EMHUB_TOMO_MCP_MAX_GPUS_PER_JOB": "3",
        "EMHUB_TOMO_MCP_MAX_ACTIVE_GPU_JOBS": "2",
        "EMHUB_TOMO_MCP_STATE_DIR": "/ptmp/${USER}/.emhub-tomo-mcp"
      }
    }
  }
}
```

Set `EMHUB_TOMO_PORT` to the port `emh-tomo --run` printed before starting the client. For read access, leave out every variable after `EMHUB_SERVER_URL`.

For a shared facility EMhub (one server, many users), each user sets `EMHUB_TOMO_MCP_AUTH=password`, their own `EMHUB_USER` and an `EMHUB_PASSWORD_FILE` with mode 600. The server then sees exactly the projects EMhub's processing page shows that user.

## Logs and the audit log

- **Server log**: stderr, collected by the MCP client (Claude Code: `claude --debug`, or the server's entry under `/mcp`). Every error shown to the model carries a reference id that appears here with the full detail. `EMHUB_TOMO_MCP_LOG_LEVEL=DEBUG` adds every EMhub request.
- **Audit log**: `audit.jsonl` in the state folder, one JSON line per attempted change: time, EMhub user, action, project, arguments, outcome (`done`, `dry_run`, or the error category) and the jobs' statuses afterwards. The file is opened for each line, so it can be moved aside or rotated while the server runs.

To see what an assistant changed today:

```bash
grep "\"time\": \"$(date -u +%F)" /ptmp/$USER/.emhub-tomo-mcp/audit.jsonl | grep '"outcome": "done"'
```
