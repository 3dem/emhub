# Client setup

The server uses the stdio transport: the MCP client starts `emhub-tomo-mcp` as a subprocess. It must be able to reach EMhub's URL from where it runs.

In the examples, replace `http://127.0.0.1:5000` with the URL `emh-tomo --run` printed. If `emhub-tomo-mcp` is not on the client's `PATH`, use its absolute path (`uv tool install` puts it in `~/.local/bin`).

## Claude Code

Project scope, in `.mcp.json` at the project root (shared with the project; Claude Code asks before using it):

```json
{
  "mcpServers": {
    "emhub-tomo": {
      "command": "emhub-tomo-mcp",
      "env": {
        "EMHUB_SERVER_URL": "http://127.0.0.1:${EMHUB_TOMO_PORT:-5000}"
      }
    }
  }
}
```

Claude Code expands `${VAR}` and `${VAR:-default}` from its own environment, so the port can change between `emh-tomo --run` sessions without editing the file.

Or, for yourself only:

```bash
claude mcp add emhub-tomo --env EMHUB_SERVER_URL=http://127.0.0.1:5000 -- emhub-tomo-mcp
```

Check it with `/mcp` inside Claude Code.

## VS Code

In `.vscode/mcp.json`:

```json
{
  "servers": {
    "emhub-tomo": {
      "type": "stdio",
      "command": "emhub-tomo-mcp",
      "env": { "EMHUB_SERVER_URL": "http://127.0.0.1:5000" }
    }
  }
}
```

## Claude Desktop

In `claude_desktop_config.json`. Claude Desktop runs on your own computer, so EMhub must be reachable from there, for example through the SSH tunnel `emh-tomo --run` prints:

```json
{
  "mcpServers": {
    "emhub-tomo": {
      "command": "/Users/me/.local/bin/emhub-tomo-mcp",
      "env": { "EMHUB_SERVER_URL": "http://127.0.0.1:5000" }
    }
  }
}
```

## EMhub on a cluster

Two set-ups work when EMhub-Tomo runs on a cluster login node and the MCP client runs elsewhere:

1. **Server on the cluster, over SSH.** The client starts the server remotely; stdio goes through SSH. Nothing listens on the network.

   ```json
   {
     "mcpServers": {
       "emhub-tomo": {
         "command": "ssh",
         "args": ["-T", "login-node", "EMHUB_SERVER_URL=http://127.0.0.1:5000 ~/.local/bin/emhub-tomo-mcp"]
       }
     }
   }
   ```

2. **Server on your computer, EMhub through a tunnel.** Keep the tunnel from `emh-tomo --run` open (`ssh -L 5000:127.0.0.1:<port> login-node`) and configure the server locally with `EMHUB_SERVER_URL=http://127.0.0.1:5000`. The server reads everything through EMhub's REST API, so it does not need the project files on your computer.

## Several EMhub servers

Add one entry per server with different names, e.g. `emhub-tomo-facility` and `emhub-tomo-mine`, each with its own `EMHUB_SERVER_URL` (and credentials).
