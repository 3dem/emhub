# Development

## Layout

```text
src/emhub_tomo_mcp/
  config.py         environment -> Settings
  errors.py         error categories; messages shown to the model
  services.py       wiring, status and capability probing (shared by server and CLI)
  __main__.py       command line: serve on stdio, --check, --print-config
  emhub/            async REST client (httpx2) and typed endpoint calls; no MCP imports
  domain/           projects and visibility, jobs and logs, job types, files, paths, shaping,
                    validation (parameters against forms), operations (all changes)
  policy.py         access levels per project, launch limit, project locks, audit log
  server/           MCP tools, resources, prompts, instructions and guides
tests/
  unit/             client, config, domain, operations, policy, CLI (fake EMhub, no network)
  protocol/         the MCP surface through an in-memory client; stdio; docs up to date
  contract/         against a real throw-away EMhub-Tomo (needs EMHUB_TOMO_HOME)
  support/          fake_emhub.py (in-memory EMhub), emhub_instance.py (real instances)
  fixtures/api/     31 recorded EMhub request/response pairs
scripts/            development tools (below)
```

The layers depend downwards only: `server` → `domain` → `emhub`.

## Set-up

```bash
cd emhub-tomo-mcp
uv venv --python 3.12 && uv pip install -e ".[dev]"
```

## Checks

```bash
ruff check src tests scripts && ruff format --check src tests scripts
mypy                                      # strict
pytest                                    # unit and protocol; contract tests skip
```

Contract tests need an EMhub-Tomo installation (the folder with `emwrap.bashrc`). They start a throw-away EMhub server, configured with stub launchers so no GPU program can run:

```bash
EMHUB_TOMO_HOME=/path/to/emhub-tomo  EMHUB_TEST_WORKDIR=/scratch/tmp  pytest tests/contract
```

`test_contract.py` (about 1.5 minutes) creates a project from the ApoF tutorial template, runs an import job that finishes, a motion-correction job whose program (a stub) fails, and an import that fails outright, then checks every read tool against them. A second user checks project sharing; a second server checks auto-login.

`test_contract_write.py` (about 10 minutes) drives the change tools: it creates projects, loads the tutorial, edits the import, schedules the preprocessing chain and waits for it, stops a running and a scheduled job, checks the refusal of GPU jobs on the EMhub host, and labels, annotates, copies, exports and deletes jobs. The stubs' behaviour is set with `site_helpers.set_stub_mode` (`fail`, `ok`, `sleep N`).

Coverage: `pytest --cov`. The target is ≥ 90 % for `emhub/` and `domain/`.

## Snapshots and generated docs

- `tests/protocol/tools_snapshot.json` pins tool names, descriptions and schemas. After an intended change, run `UPDATE_SNAPSHOTS=1 pytest tests/protocol/test_server.py -k snapshot` and review the diff.
- `docs/tools.md` is generated: `python scripts/gen_tool_docs.py`. A test fails when it is out of date.

## Development tools (scripts/)

| Script | Purpose |
|---|---|
| `dev_server.py start\|status\|stop DIR` | A long-lived development EMhub server (127.0.0.1, random admin password in `DIR/dev_admin_password`). |
| `record_api_samples.py` | Re-record `tests/fixtures/api/` against a throw-away server. |
| `run_tutorial_via_emhub.py` | Run the ApoF tutorial through EMhub's REST API on a cluster queue, to check a site's set-up. |
| `gen_tool_docs.py` | Generate `docs/tools.md`. |

## Adding a tool

1. Add the logic to the domain layer, with a result model in `domain/models.py` (field descriptions become the output schema).
2. Register the tool in `server/tools_read.py` with `@mcp.tool(...)` and `@guarded_tool`, returning `respond(model, summary)`.
3. Add unit tests (fake EMhub), a happy-path entry in `tests/protocol/test_server.py`, and a contract test.
4. Update the snapshot and `docs/tools.md`.

## EMhub behaviour the server relies on

- Errors arrive as HTTP 200 with `{"error": ...}`, or `{"errors": [...]}` for validation.
- A request without a session gets HTTP 401.
- Statuses in REST answers are lowercase; `finished` is emwrap's "Succeeded".
- The widget workflow lists a parent once per linked output; the server de-duplicates links.
- A job's stdout and stderr are capped by EMhub at 2000 lines (first and last 1000).
- emwrap can mark a job finished although part of it failed, so `get_job` warns about tracebacks, error lines and missing outputs in finished jobs.
- `/api/get_workflows` and `/api/get_job_types` are optional; without the latter, job types come from the processing menu.
