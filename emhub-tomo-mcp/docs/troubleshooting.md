# Troubleshooting

Start with `emhub-tomo-mcp --check` in a terminal, with the same environment variables as the client's server entry. Tool errors name a category in brackets and end with a reference id; the server log (stderr) has the details under that id (see [deployment.md](deployment.md#logs-and-the-audit-log)).

## Connecting

| Symptom | Cause and fix |
|---|---|
| `[unreachable] Cannot reach EMhub ... (connection refused)` | EMhub is not running, or the port changed: `emh-tomo --run` picks a port each time. Use the URL it printed (or `${EMHUB_TOMO_PORT}` in `.mcp.json`, see [client-setup.md](client-setup.md)). |
| `[unreachable]` although EMhub answers in a browser on the same machine | A proxy from `HTTP_PROXY`/`HTTPS_PROXY` is not used (that is the default); check that the URL has the right host and port. If EMhub is really behind a proxy, set `EMHUB_TOMO_MCP_USE_ENV_PROXY=true`. |
| `[unreachable] Cannot reach EMhub ... (timed out)` | EMhub is busy or the request is large (big file previews). Raise `EMHUB_TOMO_MCP_HTTP_TIMEOUT`. Reads are retried three times; changes are not. |
| `[auth] EMhub did not accept the session` | EMhub asks for a login and no credentials are set. With `emh-tomo --run`, auto-login is on and none are needed: check the URL points at that server. Otherwise set `EMHUB_USER` and `EMHUB_PASSWORD_FILE`. |
| `[auth] EMhub rejected the login` | Wrong user or password. Check the password file holds only the password on its first line. |
| The client shows no tools or "failed to connect" | The server stopped at start. Run `emhub-tomo-mcp --print-config` to see configuration errors (exit status 2). In a wrapper script, make sure nothing else writes to stdout: stdout carries the MCP protocol. Redirect the output of anything the script sources, e.g. `. emwrap.bashrc > /dev/null`. |
| The write tools are missing | `EMHUB_TOMO_MCP_ACCESS` is `read` (the default). `get_server_status` shows the level in effect. |

## Projects and jobs

| Symptom | Cause and fix |
|---|---|
| `[not_found] Project N` although it exists | The account does not see it: it is neither owned by nor shared with `EMHUB_USER`, or it is outside `EMHUB_TOMO_MCP_PROJECTS`. EMhub admins see other users' projects with `list_projects(scope="all")`. |
| `[not_found] ... project folder` | The project's folder was moved or deleted outside EMhub. Other projects are not affected. Restore the folder or update the project's folder in EMhub. |
| A job is `finished` but `get_job` lists warnings | emwrap marks some jobs finished although part of the work failed (for example a few tilt series of many). Read the warnings, the error lines and the missing outputs before using the results. |
| A scheduled job never starts | One of its parents failed or was stopped, so it waits for ever. `get_project` lists it under `blocked` and `wait_for_jobs` stops early with a note. Cancel it with `stop_jobs` (it goes back to `saved`), fix the parent, and schedule again. |
| The import finds no tilt series | The mdoc pattern is relative to the project folder (raw data is under `data/`), and the import only takes mdoc files that have not changed for a minute. Check the pattern with `list_project_files`. |
| `[validation] EMhub rejected the parameters` | EMhub's own checks failed (for example "no files match"). The details list each problem. Nothing was saved. |

## Changes

| Symptom | Cause and fix |
|---|---|
| `[policy_denied] ... EMhub host` | A GPU job would run on the queue `None`, i.e. on the EMhub host. Set `EMHUB_TOMO_MCP_DEFAULT_QUEUE` to a cluster queue, or give the job's queue parameter one. |
| `[policy_denied] Launch limit reached` or `At most N GPU jobs may run at once` | The limits `EMHUB_TOMO_MCP_MAX_LAUNCHES_PER_HOUR` or `EMHUB_TOMO_MCP_MAX_ACTIVE_GPU_JOBS` were reached. Wait, or raise them. The launch count restarts with the server process. |
| `[policy_denied] Not allowed to ...` | The hint says why: the server's access level (`EMHUB_TOMO_MCP_ACCESS`), or your right on the project, which lowers it (viewers can only read, editors cannot delete). The project owner can share the project with more rights in EMhub. |
| `[conflict]` | The job's status does not allow the change: it is running or already launched, it finished (use `rerun=true` on purpose), other jobs use its outputs (delete those too, or keep it), or the template is already loaded (`allow_duplicate=true`). |
| "EMhub did not confirm the change in time; the outcome is unknown" | EMhub took longer than `EMHUB_TOMO_MCP_MUTATION_TIMEOUT`. The change may still have happened. Check with `get_job` before trying again; the server never retries changes by itself. |
| What did the assistant change? | The audit log (`audit.jsonl` in `EMHUB_TOMO_MCP_STATE_DIR`) has every attempt with its outcome; see [deployment.md](deployment.md#logs-and-the-audit-log). |

## Performance

- `get_project` on projects with hundreds of jobs returns 100 jobs by default; filter with `statuses` or `job_types`, or raise `limit`. `get_jobs` reads up to 20 jobs in one call.
- Large text files are returned in windows; `get_star_table` reads STAR files as tables and counts values, which is cheaper than reading them as text. Files over 16 MiB are refused.
- `EMHUB_TOMO_MCP_CACHE_TTL` (10 s) keeps the user, project and entry lists between calls. Raise it on a busy EMhub with many projects.

## Installation

- **Home quota exceeded during installation**: uv's cache and tools are in the home folder by default. Set `UV_CACHE_DIR` and `UV_TOOL_DIR` to a project file system ([deployment.md](deployment.md#install)).
- **`emhub-tomo-mcp: command not found` in the client**: the client does not use your shell's `PATH`. Use the absolute path (`~/.local/bin/emhub-tomo-mcp`) as `command`.
