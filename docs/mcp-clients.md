# MCP client installation

DBMux speaks authenticated, stateless **Streamable HTTP** at `/mcp` over HTTPS. It does not serve the legacy standalone SSE transport, and it serves **both protocol revisions**: `2026-07-28` (stateless, `server/discover`, per-request `_meta` envelope and the `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` headers) and 2025-era stateless (`initialize` handshake). Current Codex, Claude Code, Cursor, VS Code and GitHub Copilot builds speak `2026-07-28`; older clients keep working through the same endpoint. Unauthenticated requests are refused with `401` and a `WWW-Authenticate: Bearer realm="dbmux", error="invalid_token"` challenge.

Set your individually issued `DB_MCP_TOKEN` in the environment of the **process, container or remote runner that actually executes the client** — not in a shared file, and never in the repository. Every configuration below contains only a reference to that variable. Environment-variable substitution syntax differs by client; check the profile for your client before pasting.

All examples use the HTTPS placeholder `https://dbmcp.example.edu/mcp`. Replace it with the endpoint your administrator gave you; if you were given a different path, keep it exactly as provided. Do not use plain HTTP off loopback.

## Codex

In the user configuration `~/.codex/config.toml` (on Windows: `%USERPROFILE%\.codex\config.toml`). Codex also reads a project-scoped `.codex/config.toml` for trusted projects:

```toml
[mcp_servers.dbmux-dev]
url = "https://dbmcp.example.edu/mcp"
bearer_token_env_var = "DB_MCP_TOKEN"
```

Codex reads the bearer token from `DB_MCP_TOKEN` at connection time; the value is never stored in `config.toml`. See [official OpenAI MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Claude Code

Use `.mcp.json` at the project root (project scope, approved interactively on first use), or add it personally with `claude mcp add --transport http dbmux-dev https://dbmcp.example.edu/mcp --scope user --header 'Authorization: Bearer ${DB_MCP_TOKEN}'` — keep the header in single quotes so your shell stores the `${DB_MCP_TOKEN}` reference instead of a shell-expanded token value (which would land in `~/.claude.json` in plaintext; note that `claude mcp get` prints the stored header):

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

Claude Code expands `${VAR}` (and `${VAR:-default}`) in the `command`, `args`, `env`, `url` and `headers` values of `.mcp.json`. Prefer the variable reference over a literal token or a shell-expanded CLI header if you want to avoid persisting the token value in client configuration. A JSON entry with a `url` but no `type` is a configuration error — always set `"type": "http"`. See [Claude Code MCP](https://code.claude.com/docs/en/mcp).

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

Cursor resolves `${env:NAME}` in `command`, `args`, `env`, `url` and `headers`. Restart Cursor (or toggle the server under **Customize**) after setting the environment. See [Cursor MCP](https://cursor.com/docs/mcp).

## VS Code — editor-managed configuration

This is the configuration for the **editor-managed** MCP client (the Local harness, which is deprecated and scheduled for removal in February 2027). Save as `.vscode/mcp.json` in your project, or in your user profile to apply to all workspaces:

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

Editor-managed configuration uses the top-level `servers` key and `${env:NAME}` references. It supports inputs and per-server sandboxing, but those are not portable. For new setups prefer the [GitHub Copilot profile](#github-copilot-native-harness) below, which the native Copilot harness reads directly. See [VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## GitHub Copilot — native harness

The native Copilot harness (GitHub Copilot CLI, and Copilot in VS Code when the Copilot harness is selected) reads a **portable** configuration with a top-level `mcpServers` key and braced `${NAME}` environment-variable references in header values. Two locations are supported:

- **User-level `~/.copilot/mcp-config.json`** — personal, applies across workspaces. When `COPILOT_HOME` is set, the file is `$COPILOT_HOME/mcp-config.json` instead.
- **Workspace-root `.mcp.json`** — shared with everyone who opens the repository. In VS Code, the workspace-root destination is offered in guided setup when the `chat.mcp.workspaceRootConfig.enabled` setting is on; existing `.mcp.json` files keep working either way.

Use the user-level file for personal access; use the workspace-root file to share the server definition with your team (it must contain references only — never real tokens). Both use the same format:

```json
{
  "mcpServers": {
    "dbmux-dev": {
      "type": "http",
      "url": "https://dbmcp.example.edu/mcp",
      "headers": { "Authorization": "Bearer ${DB_MCP_TOKEN}" },
      "tools": ["*"]
    }
  }
}
```

Field notes: `type` is `http` for Streamable HTTP; `url` and `headers` are the endpoint and request headers; `${DB_MCP_TOKEN}` (not `${env:DB_MCP_TOKEN}` — that is the editor-managed syntax) is resolved in the environment of the host that connects to the server; `tools: ["*"]` exposes all server tools but does not bypass tool approvals. In the guided-setup form the workspace-root variant rejects `${...}` expressions — edit the reference through **Other Properties** in the form, or edit `.mcp.json` directly; the runtime reads the reference fine. Do not copy editor-managed-only fields (`${input:...}`, `envFile`, nested `oauth`) into this file; a pre-registered OAuth client uses the flat `oauthClientId` field.

**Provide the token to the host that executes the harness**, not to the repository:

- Local CLI/terminal: `export DB_MCP_TOKEN="YOUR_PERSONAL_TOKEN"` (macOS/Linux) or `$env:DB_MCP_TOKEN = "YOUR_PERSONAL_TOKEN"` (PowerShell) before launching `copilot` or VS Code.
- Dev container / container runner: set `DB_MCP_TOKEN` in the container's environment (e.g. `containerEnv`, `docker run -e`, or the runner's secret store), or use the runner's secret-injection support — never bake it into a Dockerfile or committed compose file.
- Remote sessions (SSH, Codespaces, Dev Containers): the harness reads its configuration and environment on the **remote host**, not on your laptop. Set `DB_MCP_TOKEN` on that host or in the remote environment; your local `~/.copilot/mcp-config.json` is not forwarded.
- CI / unattended runners: use a short-lived scoped token issued for the runner; do not reuse a personal token on shared infrastructure.

See [VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) and [Adding MCP servers for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

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

The bridge inherits `DB_MCP_TOKEN`; use the client's environment facility if inheritance is unavailable. There are no database drivers or passwords in this package. The proposed `@dbmux/db-mcp-bridge` package is not published; do not assume `npx` can install it yet. Once an authorized maintainer publishes it, the pinned launch command is:

```bash
npx -y @dbmux/db-mcp-bridge@0.1.0 --url https://dbmcp.example.edu/mcp
```

Pin the exact version; review the package before upgrading. Until a release is available, use the local absolute path. Only HTTPS or loopback HTTP is permitted by the bridge, and redirects are rejected to protect Authorization headers.

## Let the harness install it for you (copy-paste prompts)

Each block below is a self-contained prompt. Paste it into the harness; the harness edits the configuration file or runs the client CLI for you, you restart/reconnect the client, and the harness finishes by calling `db_connections` (a read-only call) and reporting the connection IDs it sees.

Before pasting:

- **`DB_MCP_TOKEN` must already be in the harness's environment** — the prompts require it and will stop if it is missing. They never contain the token value and must not be edited to.
- **Replace `https://dbmcp.example.edu/mcp`** with the endpoint your administrator gave you (keep HTTPS).
- The harness cannot restart itself, approve a project-scoped server, or pick up a new environment variable you set after launch — expect to be asked to restart the client or run `/mcp` / reconnect once.
- Every prompt ends with the same verification: call `db_connections` and report the IDs. If it reports an empty list, an auth error or a failed handshake, see [Verify the connection](#verify-the-connection) — `dbmcp doctor` separates a rejected token (exit `4`) from a network/TLS (exit `3`) or protocol (exit `5`) problem.
- Never let the harness write a literal token into a file, commit one, or call any other DBMux tool during setup.

### Codex (CLI)

```text
Install the DBMux MCP server for this Codex client and verify it.

Endpoint: https://dbmcp.example.edu/mcp — replace with the endpoint my administrator gave me.
Token: DB_MCP_TOKEN must already be set in this environment; if it is not, stop and ask me to set it first. Never print the token or write it into any file.

Steps:
1. Run: codex mcp add dbmux-dev --url <endpoint> --bearer-token-env-var DB_MCP_TOKEN
   (If the CLI is unavailable, open ~/.codex/config.toml — %USERPROFILE%\.codex\config.toml on Windows — and add, updating any existing section instead of duplicating it:
   [mcp_servers.dbmux-dev]
   url = "<endpoint>"
   bearer_token_env_var = "DB_MCP_TOKEN")
2. Confirm the entry exists with the bearer_token_env_var reference, not a token value.
3. Tell me to restart Codex (or run /mcp). A new session may be required for the server to load; in the next session (or in this one, if dbmux-dev is already loaded), call the db_connections tool on the dbmux-dev server and report the connection IDs it returns.
Do not call any other DBMux tool, do not modify any database, and do not commit any file.
```

### Claude Code

```text
Install the DBMux MCP server for this Claude Code client and verify it.

Endpoint: https://dbmcp.example.edu/mcp — replace with the endpoint my administrator gave me.
Token: DB_MCP_TOKEN must already be set in this environment; if it is not, stop and ask me to set it first. Never print the token or write it into any file.

Steps:
1. Write or merge .mcp.json at the repository root (do not drop existing entries):
   {"mcpServers": {"dbmux-dev": {"type": "http", "url": "<endpoint>", "headers": {"Authorization": "Bearer ${DB_MCP_TOKEN}"}}}}
   The header value must be exactly the reference ${DB_MCP_TOKEN} — do not alter it to ${env:DB_MCP_TOKEN} or ${env.DB_MCP_TOKEN}, and never substitute the token value. Claude Code expands the reference from your environment at connection time; the token is never stored in the file. (If I ask for a personal cross-project install instead, run: claude mcp add --transport http dbmux-dev <endpoint> --scope user --header 'Authorization: Bearer ${DB_MCP_TOKEN}' — single quotes, so the shell stores the reference, not an expanded token.)
2. Confirm .mcp.json is valid JSON and contains only the ${DB_MCP_TOKEN} reference — no token value. Project-scoped servers need my interactive approval on first use.
3. Tell me to restart Claude Code or reconnect the server. A new session may be required for the server to load; in the next session (or in this one, if dbmux-dev is already loaded), call the db_connections tool on the dbmux-dev server and report the connection IDs it returns.
Do not call any other DBMux tool, do not modify any database, and do not commit any file containing a token.
```

### Cursor

```text
Install the DBMux MCP server for this Cursor client and verify it.

Endpoint: https://dbmcp.example.edu/mcp — replace with the endpoint my administrator gave me.
Token: DB_MCP_TOKEN must already be set in this environment; if it is not, stop and ask me to set it first. Never print the token or write it into any file.

Steps:
1. Open ~/.cursor/mcp.json (or .cursor/mcp.json in the project if I ask for project scope). Merge — do not drop existing entries — this block:
   {"mcpServers": {"dbmux-dev": {"url": "<endpoint>", "headers": {"Authorization": "Bearer ${env:DB_MCP_TOKEN}"}}}}
   Use the ${env:DB_MCP_TOKEN} reference exactly as written.
2. Confirm the merged file is valid JSON and contains only the ${env:DB_MCP_TOKEN} reference.
3. Tell me to fully quit and relaunch Cursor from a shell where DB_MCP_TOKEN is set (or that it is available in my OS user environment). A relaunch is required for the server to load; after relaunching, call the db_connections tool on dbmux-dev and report the connection IDs it returns.
Do not call any other DBMux tool, do not modify any database, and do not commit any file.
```

### VS Code (editor-managed, deprecated Local harness)

```text
Install the DBMux MCP server for this VS Code client and verify it.

Endpoint: https://dbmcp.example.edu/mcp — replace with the endpoint my administrator gave me.
Token: DB_MCP_TOKEN must already be set in this environment; if it is not, stop and ask me to set it first. Never print the token or write it into any file.

Note: this installs the editor-managed configuration (deprecated, Local harness, removal planned for February 2027). For new setups prefer the native GitHub Copilot configuration in the GitHub Copilot section of the MCP client guide instead.

Steps:
1. Open .vscode/mcp.json in this project (or the user-profile mcp.json if I ask for it). Merge — do not drop existing entries — this block:
   {"servers": {"dbmux-dev": {"type": "http", "url": "<endpoint>", "headers": {"Authorization": "Bearer ${env:DB_MCP_TOKEN}"}}}}
   Use the ${env:DB_MCP_TOKEN} reference exactly as written.
2. Tell me to reload VS Code and start the server from the MCP controls. In the next session, call the db_connections tool on dbmux-dev and report the connection IDs it returns.
Do not call any other DBMux tool, do not modify any database, and do not commit any file.
```

### GitHub Copilot (native harness)

```text
Install the DBMux MCP server for this GitHub Copilot harness and verify it.

Endpoint: https://dbmcp.example.edu/mcp — replace with the endpoint my administrator gave me.
Token: DB_MCP_TOKEN must already be set in this environment; if it is not, stop and ask me to set it first. Never print the token or write it into any file.

Steps:
1. Decide the destination with me if unsure: ~/.copilot/mcp-config.json for my user (or $COPILOT_HOME/mcp-config.json when COPILOT_HOME is set) to use the server across workspaces, or .mcp.json at the workspace root to share the definition with the team.
2. Merge into that file (do not drop existing entries):
   {"mcpServers": {"dbmux-dev": {"type": "http", "url": "<endpoint>", "headers": {"Authorization": "Bearer ${DB_MCP_TOKEN}"}, "tools": ["*"]}}}
   Use the ${DB_MCP_TOKEN} reference exactly as written. If the client is running in a remote host or Dev Container, DB_MCP_TOKEN must be set on that host or in the container environment — my local user config file and environment are not forwarded; tell me if that applies here.
3. Confirm the file is valid JSON with the ${DB_MCP_TOKEN} reference and no token value.
4. Tell me to restart the harness (or reconnect the server). A new session may be required for the server to load; in the next session, call the db_connections tool on dbmux-dev and report the connection IDs it returns.
Do not call any other DBMux tool, do not modify any database, and do not commit any file.
```

### STDIO bridge

```text
Install the DBMux STDIO bridge for this client and verify it.

Endpoint: https://dbmcp.example.edu/mcp — replace with the endpoint my administrator gave me.
Token: DB_MCP_TOKEN must already be set in this environment; if it is not, stop and ask me to set it first. Never print the token or write it into any file.

Steps:
1. Locate the DBMux checkout (ask me if the path is unknown). Run npm ci in its bridge directory.
2. Merge into this client's MCP configuration (ask me for the file and the top-level key — mcpServers or servers):
   {"dbmux-dev": {"command": "node", "args": ["<absolute path to bridge/index.mjs>", "--url", "<endpoint>"]}}
3. Confirm the client process will inherit DB_MCP_TOKEN, the endpoint uses HTTPS (or loopback HTTP), and no token appears in the file.
4. Tell me to restart the client. A new session may be required for the server to load; in the next session, call the db_connections tool on dbmux-dev and report the connection IDs it returns.
Do not call any other DBMux tool, do not modify any database, and do not commit any file.
```

### Generic MCP / any other harness

```text
Install the DBMux MCP server for this client and verify it.

Endpoint: https://dbmcp.example.edu/mcp — replace with the endpoint my administrator gave me.
Token: DB_MCP_TOKEN must already be set in this environment; if it is not, stop and ask me to set it first. Never print the token or write it into any file.

Steps:
1. Find this client's MCP configuration file and format. Add a Streamable HTTP server named dbmux-dev with this URL and an Authorization header "Bearer <reference to DB_MCP_TOKEN using this client's own environment-variable syntax, e.g. ${DB_MCP_TOKEN} or ${env:DB_MCP_TOKEN}>".
2. If this client cannot reference environment variables in headers, stop and tell me — do not write a literal token into a file.
3. Confirm HTTPS is used and the config contains only the variable reference.
4. Tell me to restart this client. A new session may be required for the server to load; in the next session, call the db_connections tool on dbmux-dev and report the connection IDs it returns.
Do not call any other DBMux tool, do not modify any database, and do not commit any file.
```

The prompts contain no credentials — a committed prompt file, chat log or screenshot never leaks a token. The only secret stays in your environment, exactly as in the manual setup.

## Verify the connection

The first read-only check is `db_connections`: it lists the enabled connections inside your token scope and never returns credentials. If it works, your endpoint, token and client configuration are all correct.

### From `dbmcp doctor`

`dbmcp doctor` verifies endpoint reachability, protocol negotiation, tool discovery and a `db_connections` call with only your `DB_MCP_TOKEN` — no administrator credentials needed:

```bash
DB_MCP_TOKEN=... npm run dbmcp -- doctor --url https://dbmcp.example.edu/mcp
```

Without `--url`, the `DBMUX_URL` convention is used (`DBMUX_URL=https://dbmcp.example.edu` → `/mcp` is appended; a value already ending in `/mcp` is used as-is). Exit codes: `0` success, `2` usage/configuration error, `3` network or TLS failure (including refused redirects), `4` rejected credentials (`401`/`403`), `5` protocol or tool-discovery failure, `6` access OK but zero connections visible to your token. The command never prints your token and bounds the total runtime.

### From your client

Restart or reconnect the client, then ask your agent:

> Use DBMux to call db_connections and list my available development connections without making changes.

### With curl before debugging your client

This splits "the server rejects my token" from "my client config is wrong". Use the endpoint and token the administrator gave you:

```bash
curl -i -X POST "https://dbmcp.example.edu/mcp" \
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

`dbmcp doctor` (see above) performs the equivalent checks plus the `db_connections` call and prints the same distinction as exit codes.

For a 2025-era (legacy) client, the equivalent probe omits `_meta` and sends `"method": "initialize"` with `protocolVersion`, `capabilities` and `clientInfo`; a healthy server answers `200` with `serverInfo.name` `dbmux`.

These configuration examples were checked against official documentation on 2026-11-16. Individual GUI clients were not installed/tested as part of protocol acceptance; see the compatibility matrix below.

## Compatibility matrix

Legend: **Verified (real run)** = a human or agent ran the client against a live DBMux and executed `db_connections`; **Automated protocol test** = `npm test` coverage through the real MCP SDK over HTTP/STDIO without a GUI; **Documentation check** = configuration keys and locations checked against official docs, not executed; **Not run** = not available in the test environment.

| Client                                                     | Transport        | Result                  | Notes                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ---------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code (CLI 2.1.322)                                  | Streamable HTTP  | Verified (real run)     | Two runs against a scratch loopback instance: headless `claude -p` over `--mcp-config`; and the harness-install prompt writing a project-scope `.mcp.json` with a `${DB_MCP_TOKEN}` reference, fresh session returned `verify-dev` |
| `dbmcp doctor` (CLI)                                       | Streamable HTTP  | Verified (real run)     | Against the same scratch loopback instance: exit `0` with one scoped connection; exit `4` for a rejected token; `db_connections` never prints the token                                                                            |
| GitHub Copilot CLI                                         | Streamable HTTP  | Not run                 | Not installed on the test host (`copilot` shim reports CLI missing); official docs check only; native harness config generated but not exercised                                                                                   |
| GitHub Copilot / VS Code (native harness)                  | Streamable HTTP  | Not run                 | VS Code present; the Copilot harness flow was not exercised end to end                                                                                                                                                             |
| VS Code editor-managed (`.vscode/mcp.json`, Local harness) | Streamable HTTP  | Not run                 | Deprecated path; official docs check only                                                                                                                                                                                          |
| Codex CLI                                                  | Streamable HTTP  | Not run                 | Not installed on the test host; official docs check only                                                                                                                                                                           |
| Cursor                                                     | Streamable HTTP  | Not run                 | Not installed on the test host; official docs check only                                                                                                                                                                           |
| STDIO bridge (`@dbmux/db-mcp-bridge`)                      | STDIO to HTTP    | Automated protocol test | Real SDK client over STDIO through the bridge; `db_connections` exercised (tests/bridge.test.ts); installed-tarball executable verified against the same scratch instance                                                          |
| curl `server/discover` probe                               | HTTPS (expected) | Automated protocol test | Covered by SDK-level tests and the curl recipe above                                                                                                                                                                               |

`dbmcp doctor` is the recommended verification step for any client not listed as a verified real run.
