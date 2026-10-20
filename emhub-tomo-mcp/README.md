# emhub-tomo-mcp (work in progress)

An MCP server that lets AI assistants inspect and operate EMhub-Tomo cryo-ET processing projects through the EMhub REST API. It is developed on branch `sc_mcp_server`, created from `devel`, and **must not be merged** until that is explicitly agreed.

The server itself (Phase 1 of the plan) has not been written yet. What is here so far is the tooling it will be developed and tested with:

| Path | What it is |
|---|---|
| `tests/support/emhub_instance.py` | Creates and serves EMhub instances inside an existing EMhub-Tomo installation: a throw-away one for tests (`emhub_instance()`), or the pieces for a long-lived one. Servers listen on 127.0.0.1 only, never run in debug mode, never auto-log users in, and get a random admin password. Standard library only. |
| `tests/fixtures/api/` | 31 real request/response pairs recorded from EMhub `devel` (paths and passwords masked). The MCP layer's unit and protocol tests run against them. |
| `scripts/record_api_samples.py` | Re-records `tests/fixtures/api/` against a throw-away server. |
| `scripts/dev_server.py` | `start`, `status` or `stop` a long-lived development server. Its admin password is in `INSTANCE_DIR/dev_admin_password` (mode 600). |
| `scripts/run_tutorial_via_emhub.py` | Runs the ApoF tutorial through a running server's REST API, with jobs submitted through a cluster queue, and follows them until they finish. Use it to check a site's queue set-up. |

All of them need `EMHUB_TOMO_HOME`, the EMhub-Tomo installation folder (the one with `emwrap.bashrc`). They run with any Python ≥ 3.9. For example:

```bash
export EMHUB_TOMO_HOME=/path/to/emhub-tomo-installation
python scripts/dev_server.py start "$EMHUB_TOMO_HOME/dev/instances/dev"
python scripts/run_tutorial_via_emhub.py --instance "$EMHUB_TOMO_HOME/dev/instances/dev" \
    --data "$EMHUB_TOMO_HOME/testdata/WarpApofTutorial" \
    --projects-dir "$EMHUB_TOMO_HOME/dev/projects" --queue <your queue> --gpus 3 --jobs small
python scripts/dev_server.py stop "$EMHUB_TOMO_HOME/dev/instances/dev"
```
