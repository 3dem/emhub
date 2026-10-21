# Changelog

## 0.1.0 (unreleased)

First version: read-only access to EMhub-Tomo processing projects.

- Tools: `get_server_status`, `list_projects`, `get_project`, `get_job`, `get_job_logs`, `wait_for_jobs`, `list_job_types`, `describe_job_type`, `list_workflow_templates`, `list_project_files`, `read_project_file`.
- Resources: background guides, a project's job graph, job-type forms. Prompts: `diagnose_job`, `project_report`.
- Project visibility following EMhub's processing page (owner, shared as editor or viewer, admin), plus an optional project allowlist.
- Warnings when a job marked finished shows signs of failure (traceback, error lines, missing outputs).
- Authentication through `emh-tomo --run` auto-login or with a password; transparent re-login.
- `--check` and `--print-config` commands; logs on stderr only.
- Unit, protocol and contract tests; generated tool reference.
