# DBMux STDIO bridge

Local STDIO ⇄ remote authenticated DBMux MCP bridge for clients that only speak STDIO. Install locally with `npm ci` in this directory, then run `node index.mjs --url https://dbmcp.example.edu/mcp` with `DB_MCP_TOKEN` in the process environment. Standard output contains MCP protocol messages only; diagnostics go to standard error. This package has no database adapters or credentials.

The bridge speaks the current MCP protocol revision (`2026-07-28`) and forwards it transparently to the server, which also accepts 2025-era clients. It performs no MCP parsing of its own beyond framing, so protocol upgrades on the server side do not require a bridge rebuild beyond its MCP SDK dependency.

Only HTTPS endpoints — or HTTP on loopback (`localhost`, `127.0.0.1`, `[::1]`) — are permitted, and redirects are rejected so the `Authorization` header is never forwarded to a different destination. The token is read from `DB_MCP_TOKEN` only; it is never a command-line argument and never printed.

## Client launch command

Until the package is published, use an absolute path:

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

After an authorized maintainer publishes `@dbmux/db-mcp-bridge`, the pinned launch command is:

```bash
npx -y @dbmux/db-mcp-bridge@0.1.0 --url https://dbmcp.example.edu/mcp
```

Always pin the exact version and review the release before upgrading. Publication requires separate authorization; it is not part of the normal development workflow, and does not happen automatically from CI.

The client process must inherit `DB_MCP_TOKEN`. Provide it to the process, container or remote runner that actually executes the client — for example `docker run -e DB_MCP_TOKEN ...`, the dev-container `containerEnv`, or your runner's secret facility. Do not put the token in the bridge's `args`, in a `.mcp.json` file, or in a committed environment file.

## Maintainer release checklist (no publish without authorization)

1. `npm ci` in `bridge/` and run the repository test suite (`npm test`) — it includes end-to-end STDIO coverage against a live in-process DBMux.
2. `npm pack --dry-run --json` and confirm the tarball contains exactly `index.mjs`, `README.md`, `LICENSE`, `package.json` and nothing else.
3. Local package test: install the tarball into a scratch directory (`npm install ./dbmux-db-mcp-bridge-<version>.tgz`), then run the installed executable (`node_modules/.bin/db-mcp-bridge`) against a test DBMux — once with a valid token (expect the MCP handshake) and once with an invalid token (expect a non-zero exit and a stderr diagnostic that does not contain the token).
4. `npm publish --dry-run` and review the file list and metadata once more.
5. Only with explicit release authorization: `npm publish`. Tag the release and record the checksum.

The package name `@dbmux/db-mcp-bridge` under the `@dbmux` scope is a proposed publication scope; it has not been published to npm. Until a release is available, use the local checkout.
