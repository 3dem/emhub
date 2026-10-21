# Security model

## What the server can do

- **Read access by default.** With `EMHUB_TOMO_MCP_ACCESS=read` (the default) every tool is read-only and declares this with MCP tool annotations; the change tools do not exist.
- **Changes only when configured.** `operate` adds tools that create projects and edit, run, schedule, stop, label, copy and export jobs; `admin` adds deleting jobs and re-running from a clean folder. `run_job`, `stop_jobs` and `delete_jobs` are annotated as destructive, so clients ask before using them. On each project the user's right lowers the level: viewers can only read; editors cannot delete.
- **Checked before sending.** Parameter names must exist in the job type's form; values must match their type and choices; no value may contain control characters or line breaks; queue parameters without fixed choices may only contain letters, digits and `_ . , : @ / = + -`. Then EMhub's own validation runs without saving anything. Running jobs are never edited, re-run or deleted; finished jobs are only re-run on explicit request; jobs whose outputs other jobs use are not deleted alone.
- **GPU jobs on the cluster.** A GPU job without a queue gets `EMHUB_TOMO_MCP_DEFAULT_QUEUE`; running GPU jobs on the EMhub host is refused unless `EMHUB_TOMO_MCP_ALLOW_LOCAL_GPU` is set. Limits on GPUs per job, GPU jobs at once and launches per hour apply when set.
- **Projects only inside allowed folders.** `create_project` only uses folders under `EMHUB_TOMO_MCP_ALLOWED_ROOTS`, for the project and for its data (which becomes readable through the project).
- **Through EMhub only.** The server reads and writes nothing on the file system itself (except its audit log) and runs no programs; everything goes through the EMhub REST API, with the configured EMhub account.
- **Inside the project folder only.** File tools take paths relative to the project folder; the folder itself always comes from the project's EMhub entry. Absolute paths, `~`, `..` segments (also as Unicode look-alikes), backslashes and control characters are rejected before any request is sent.
- **Bounded output.** Lists are paginated; logs and files are returned as windows; text files over 16 MiB and previews over 4 MiB are refused.
- **Plain requests.** Projects are addressed by id; lists are fetched whole and filtered by the server.

## Audit log

Every change attempt (including refused ones and dry runs) is appended to `audit.jsonl` in `EMHUB_TOMO_MCP_STATE_DIR`: time, EMhub user, action, project, arguments, outcome, and the jobs' statuses afterwards. Changes to one project are serialized within the server. A change that EMhub does not confirm in time is not retried; the server reports the current status instead.

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
