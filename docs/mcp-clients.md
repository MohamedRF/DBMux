# MCP client installation

Set your individually issued `DB_MCP_TOKEN` in the client environment. Never store real tokens in a repository. The server supports authenticated, stateless Streamable HTTP, not legacy standalone SSE. Environment variable interpolation differs by client.

## Codex

In the user configuration:

```toml
[mcp_servers.dbmux-dev]
url = "https://dbmcp.example.edu/mcp"
bearer_token_env_var = "DB_MCP_TOKEN"
```

See [official OpenAI MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Claude Code

Use `.mcp.json`:

```json
{
  "mcpServers": {
    "dbmux-dev": {
      "type": "http",
      "url": "https://dbmcp.example.edu/mcp",
      "headers": { "Authorization": "Bearer ${DB_MCP_TOKEN}" }
    }
  }
}
```

Claude Code expands environment variables in headers. Prefer this over a shell-expanded CLI header if you want to avoid persisting the token value in client configuration. See [Claude Code MCP](https://code.claude.com/docs/en/mcp).

## Cursor

In the user `~/.cursor/mcp.json` or project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "dbmux-dev": {
      "url": "https://dbmcp.example.edu/mcp",
      "headers": { "Authorization": "Bearer ${env:DB_MCP_TOKEN}" }
    }
  }
}
```

Restart the client after setting the environment. See [Cursor MCP](https://cursor.com/docs/mcp).

## VS Code

In user configuration or `.vscode/mcp.json`:

```json
{
  "servers": {
    "dbmux-dev": {
      "type": "http",
      "url": "https://dbmcp.example.edu/mcp",
      "headers": { "Authorization": "Bearer ${env:DB_MCP_TOKEN}" }
    }
  }
}
```

See [VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## Local STDIO bridge

```bash
cd bridge
npm ci
DB_MCP_TOKEN=... node index.mjs --url https://dbmcp.example.edu/mcp
```

Client process configuration:

```json
{
  "mcpServers": {
    "dbmux-dev": {
      "command": "node",
      "args": [
        "/absolute/path/to/dbmux/bridge/index.mjs",
        "--url",
        "https://dbmcp.example.edu/mcp"
      ]
    }
  }
}
```

The bridge inherits `DB_MCP_TOKEN`; use the client's environment facility if inheritance is unavailable. There are no database drivers or passwords in this package. The proposed `@dbmux/db-mcp-bridge` package is not published; do not assume `npx` can install it yet. Only HTTPS or loopback HTTP is permitted by the bridge, and redirects are rejected to protect Authorization headers.

These configuration examples were checked against official documentation on 2026-10-06. Individual GUI clients were not installed/tested as part of protocol acceptance.
