# DBMux STDIO bridge

Install locally with `npm ci` in this directory, then run `node index.mjs --url https://dbmcp.example.edu/mcp` with `DB_MCP_TOKEN` in the process environment. Standard output contains MCP protocol messages only. This package has no database adapters or credentials.

The package name is a proposed publishing scope; it has not been published to npm. After an authorized maintainer publishes it, clients can launch `npx -y @dbmux/db-mcp-bridge --url ...`. Until then use the local absolute path.
