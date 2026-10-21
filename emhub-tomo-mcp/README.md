# emhub-tomo-mcp

An [MCP](https://modelcontextprotocol.io) server that gives AI assistants (Claude Code, Claude Desktop, VS Code and other MCP clients) access to [EMhub-Tomo](https://3dem.github.io/emhub-tomo/) cryo-ET processing projects through the EMhub REST API.

With read access (the default), an assistant can answer questions such as "which of my projects have failed jobs?", "why did `WarpTsAlign/job004` fail?" or "how far did the ApoF tutorial get?". With write access, which the operator enables, it can also set up projects from workflow templates, edit parameters, and run, schedule and stop jobs, with checks on parameters, queues, GPUs and launch rates, and an audit log.

Status: **0.2.0** (Phases 1 and 2 of the development plan). Developed on the emhub branch `sc_mcp_server`.

## What it offers

| Tools | Purpose |
|---|---|
| `get_server_status` | Connection, identity, visible projects, optional EMhub features |
| `list_projects`, `get_project` | Projects you can access; one project's job graph, failed and active jobs, jobs ready to run |
| `get_job`, `get_job_logs` | One job's parameters, inputs, outputs, error lines and logs; warnings when a "finished" job shows signs of failure |
| `wait_for_jobs` | Bounded wait (≤ 10 min per call) with progress notifications |
| `list_job_types`, `describe_job_type` | Job types and their parameters, including the server's queues |
| `list_workflow_templates` | Ready-made workflows such as the ApoF tutorial |
| `list_project_files`, `read_project_file` | Files inside a project; text windows or PNG previews of images and MRC files |

With `EMHUB_TOMO_MCP_ACCESS=operate`:

| Tools | Purpose |
|---|---|
| `create_project`, `load_workflow_template` | New projects inside allowed folders; add a template's jobs |
| `save_job` | Edit a job's parameters, or create a job; checked against the form and by EMhub |
| `run_job`, `schedule_jobs`, `stop_jobs` | Launch now; schedule a pipeline (each job starts after its parents); stop or cancel |
| `annotate_job`, `tag_jobs`, `duplicate_jobs`, `export_workflow` | Names, comments, labels, copies, workflow files |

`admin` adds `delete_jobs`. Changing tools support `dry_run`.

There are also resources (background guides, a project's job graph, job-type forms) and two prompts (`diagnose_job`, `project_report`). See [docs/tools.md](docs/tools.md) for the full reference.

## Install

Requires Python ≥ 3.10. This is independent of the Python used by your EMhub-Tomo installation, and needs nothing from emhub, emwrap or emtools.

```bash
# from a checkout of the emhub repository
uv tool install ./emhub-tomo-mcp            # or: pip install ./emhub-tomo-mcp
emhub-tomo-mcp --version
```

## Configure and check

The server talks to a running EMhub-Tomo, typically one started with `emh-tomo --run`:

```bash
export EMHUB_SERVER_URL=http://127.0.0.1:5000    # the URL emh-tomo --run printed
emhub-tomo-mcp --check
```

`emh-tomo --run` logs every request in as `admin`, so no password is needed there. For other EMhub servers, set `EMHUB_USER` and `EMHUB_PASSWORD_FILE`. All settings are described in [docs/configuration.md](docs/configuration.md).

## Connect a client

Claude Code (`.mcp.json` in your project):

```json
{
  "mcpServers": {
    "emhub-tomo": {
      "command": "emhub-tomo-mcp",
      "env": { "EMHUB_SERVER_URL": "http://127.0.0.1:5000" }
    }
  }
}
```

[docs/client-setup.md](docs/client-setup.md) covers VS Code, Claude Desktop, and running the server on a cluster over SSH.

## Documentation

- [docs/configuration.md](docs/configuration.md): environment variables
- [docs/client-setup.md](docs/client-setup.md): Claude Code, VS Code, Claude Desktop, SSH
- [docs/security.md](docs/security.md): what the server can and cannot do, and how it handles untrusted content
- [docs/tools.md](docs/tools.md): tool, resource and prompt reference (generated)
- [docs/development.md](docs/development.md): architecture, tests, development tools
- [CHANGELOG.md](CHANGELOG.md)

## Acknowledgements

The REST-only design, addressing projects through EMhub entries, and listing workflow templates over REST follow J.M. de la Rosa Trevin's MCP prototype on the emhub branch `jm_mcp`.

## License

GPL-3.0-or-later, like EMhub.
