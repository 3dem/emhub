# Changelog

## 0.2.0 (unreleased)

Write access, opt-in with `EMHUB_TOMO_MCP_ACCESS`.

- `operate` tools: `create_project`, `load_workflow_template`, `save_job`, `run_job`, `schedule_jobs`, `stop_jobs`, `annotate_job`, `tag_jobs`, `duplicate_jobs`, `export_workflow`; `admin` adds `delete_jobs` and clean re-runs.
- Checks before every change: access level per project, job status, parameters against the form and with EMhub's validation (`/api/validate_job`), queue parameters, GPU jobs only on cluster queues (with a default queue), limits on GPUs per job, GPU jobs at once and launches per hour.
- `dry_run` on changes; changes to a project are serialized; an audit log of every attempt; unconfirmed changes are never retried.
- `list_workflow_templates` lists each template's jobs; `load_workflow_template` returns the new job ids and refuses an apparent second copy.
- Prompt `setup_preprocessing`; server instructions with rules for changes.
- Tests: operations against a stateful fake EMhub; protocol tests per access level; contract tests that drive a pipeline through MCP on a real EMhub with stub launchers.
- From heavy testing of 0.1.0: missing project folders, unreadable files and malformed EMhub records are handled; large projects stay within response budgets; agentic evals (`tests/evals`).

## 0.1.0 (unreleased)

First version: read-only access to EMhub-Tomo processing projects.

- Tools: `get_server_status`, `list_projects`, `get_project`, `get_job`, `get_job_logs`, `wait_for_jobs`, `list_job_types`, `describe_job_type`, `list_workflow_templates`, `list_project_files`, `read_project_file`.
- Resources: background guides, a project's job graph, job-type forms. Prompts: `diagnose_job`, `project_report`.
- Project visibility following EMhub's processing page (owner, shared as editor or viewer, admin), plus an optional project allowlist.
- Warnings when a job marked finished shows signs of failure (traceback, error lines, missing outputs).
- Authentication through `emh-tomo --run` auto-login or with a password; transparent re-login.
- `--check` and `--print-config` commands; logs on stderr only.
- Unit, protocol and contract tests; generated tool reference.
