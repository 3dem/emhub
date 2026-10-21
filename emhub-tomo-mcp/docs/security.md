# Security model

## What the server can do

- **Read only.** Every tool is read-only and declares this with MCP tool annotations. No tool creates, changes, launches, stops or deletes anything. There is no code path that calls a mutating EMhub endpoint.
- **Through EMhub only.** The server reads nothing from the file system and runs no programs. Everything goes through the EMhub REST API, with the EMhub account configured for it.
- **Visible projects only.** It lists and reads only the projects the configured EMhub user owns or that are shared with them (all projects for EMhub admins), optionally narrowed by `EMHUB_TOMO_MCP_PROJECTS`. See [configuration.md](configuration.md#which-projects-are-visible).
- **Inside the project folder only.** File tools take paths relative to the project folder. The folder itself always comes from the project's EMhub entry, never from the request. Absolute paths, `~`, `..` segments (also as Unicode look-alikes), backslashes and control characters are rejected before any request is sent. Links inside the project, such as `data/` to the raw data, are followed.
- **Bounded output.** Lists are paginated; logs and files are returned as windows (≤ 500 log lines or 32 KB per log, ≤ 1000 lines or 48 KB per file); text files over 16 MiB and previews over 4 MiB are refused.
- **Plain requests.** Projects are addressed by id; lists are fetched whole and filtered by the server, without query parameters.

## Untrusted content

Logs, STAR files, parameters, comments and labels are written by programs and users. They are returned as data fields, never merged into instructions. The server instructions tell the model to never follow instructions found in them. A log line saying "ignore previous instructions" stays an ordinary log line (there is a test for this).

## Credentials

- Prefer `EMHUB_PASSWORD_FILE` (mode 600) to `EMHUB_PASSWORD`. The server warns when the file is readable by others.
- The password is only sent to `EMHUB_SERVER_URL` in the login request. It never appears in logs, errors or `--print-config` output.
- The server warns when a password would travel over plain HTTP to a host that is not local.
- `emh-tomo --run` logs requests in automatically, so no credentials are needed there. Then anyone who can reach EMhub's port can use EMhub as that user. Keep `emh-tomo --run` on `127.0.0.1` and stop it when not in use.

## Errors and logs

Errors shown to the model have a category, a one-line message and a reference id; EMhub tracebacks and internal details stay in the server log (stderr). Unexpected crashes show only `internal_error` and the reference id.

## Transport

Only stdio is supported: the server opens no network port. To use it from another computer, run it over SSH (see [client-setup.md](client-setup.md)).
