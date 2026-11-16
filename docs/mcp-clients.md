# MCP client installation

Set your individually issued `DB_MCP_TOKEN` in the client environment. Never store real tokens in a repository. The server supports authenticated, stateless **Streamable HTTP** at `/mcp` — not legacy standalone SSE — and serves **both protocol revisions**: `2026-07-28` (stateless, `server/discover`, per-request `_meta` envelope and the `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` headers) and 2025-era stateless (`initialize` handshake). Current Claude Code, Codex and Cursor builds speak `2026-07-28`; older clients are kept working through the same endpoint. Unauthenticated requests are refused with `401` and a `WWW-Authenticate: Bearer realm="dbmux", error="invalid_token"` challenge. Environment variable interpolation differs by client.

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

## Verify with curl before debugging your client

This splits "the server rejects my token" from "my client config is wrong". Use the endpoint and token the administrator gave you:

```bash
curl -i -X POST "http://10.150.0.175:3001/mcp" \
  -H "Authorization: Bearer $DB_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: server/discover" \
  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

Reading the result:

| Result                                                          | Meaning                                                                             |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `200` with `supportedVersions` and `capabilities`               | Server and token are fine; fix the client configuration                             |
| `401` with `WWW-Authenticate: Bearer ... error="invalid_token"` | Token is missing, expired, revoked or mistyped                                      |
| `400` with `-32020` (HeaderMismatch)                            | Required modern headers are missing/wrong — this is the probe shape, not your token |
| `403 HOST_DENIED` / `ORIGIN_DENIED`                             | URL host/origin does not match the server's `PUBLIC_URL`                            |
| `405`                                                           | Wrong method — only `POST` is served                                                |

For a 2025-era (legacy) client, the equivalent probe omits `_meta` and sends `"method": "initialize"` with `protocolVersion`, `capabilities` and `clientInfo`; a healthy server answers `200` with `serverInfo.name` `dbmux`.

These configuration examples were checked against official documentation on 2026-10-06. Individual GUI clients were not installed/tested as part of protocol acceptance.
