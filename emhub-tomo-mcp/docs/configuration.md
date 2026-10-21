# Configuration

The server is configured with environment variables, usually set in the MCP client's server entry (see [client-setup.md](client-setup.md)). `emhub-tomo-mcp --print-config` shows the effective configuration with the password hidden; `emhub-tomo-mcp --check` tests it against EMhub.

| Variable | Default | Meaning |
|---|---|---|
| `EMHUB_SERVER_URL` | (required) | URL of the EMhub server, e.g. `http://127.0.0.1:5000` as printed by `emh-tomo --run`. http or https; no credentials in the URL. |
| `EMHUB_TOMO_MCP_AUTH` | `auto` | `autologin`: the server logs requests in by itself (`emh-tomo --run`). `password`: log in with `EMHUB_USER` and a password. `auto`: send requests without logging in, and log in only if EMhub asks for it and credentials are set. |
| `EMHUB_USER` | `admin` (assumed) | The EMhub account the server acts as. It decides which projects are visible. With `emh-tomo --run` this is `admin`. |
| `EMHUB_PASSWORD_FILE` | unset | File holding the password (first line). Prefer it to `EMHUB_PASSWORD`; make it readable only by you (`chmod 600`). |
| `EMHUB_PASSWORD` | unset | The password itself. Visible to anything that can read the process environment. |
| `EMHUB_TOMO_MCP_PROJECTS` | all visible | Comma- or space-separated project ids. Only these projects can be listed or read. |
| `EMHUB_TOMO_MCP_ACCESS` | `read` | Access level. This version only has read-only tools, so `operate` and `admin` behave like `read` (a warning says so). |
| `EMHUB_TOMO_MCP_HTTP_TIMEOUT` | `30` | Seconds to wait for an EMhub answer (file previews: at least 120). |
| `EMHUB_TOMO_MCP_CACHE_TTL` | `10` | Seconds to keep the user, project and entry lists before fetching them again. |
| `EMHUB_TOMO_MCP_USE_ENV_PROXY` | `false` | Use the `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` environment. Off by default, because cluster proxies often break connections to `127.0.0.1`. |
| `EMHUB_TOMO_MCP_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING` or `ERROR`. Logs go to stderr; stdout carries only the MCP protocol. |

## Which projects are visible

The server shows the configured user the projects EMhub's processing page would show:

- **owner**: projects in the user's own EMhub project containers;
- **editor** or **viewer**: projects whose sharing table has the user's e-mail (matched case-insensitively);
- **admin**: if the user has the EMhub `admin` role, every other project too. `list_projects` lists these only with `scope="all"`.

`EMHUB_TOMO_MCP_PROJECTS` narrows this further. A project that is not visible is reported as not found.

## Errors

Tool errors start with a category and end with a reference id, for example:

```text
[not_found] Job 'WarpMctf/job030' in project 3 not found. Closest matches: WarpMctf/job003.
Hint: Job ids look like 'WarpMctf/job002'; get_project lists them.
(ref 3f9c1e0a2b)
```

| Category | Typical cause |
|---|---|
| `unreachable` | EMhub is not running, or `EMHUB_SERVER_URL` has the wrong port. |
| `auth` | Login needed or rejected, or `EMHUB_USER` does not exist. |
| `not_found` | Unknown or invisible project, job, job type or file. |
| `validation` | Invalid argument, e.g. a path outside the project. |
| `policy_denied` | Project outside `EMHUB_TOMO_MCP_PROJECTS`. |
| `unsupported` | The EMhub server lacks an optional endpoint. |
| `upstream_error` | EMhub reported an error; the first line of its message is shown. |
| `internal_error` | Unexpected error in the MCP server. |

The server log (stderr) has the full detail under the same reference id, including EMhub's traceback for `upstream_error`. Tracebacks are never sent to the client.
