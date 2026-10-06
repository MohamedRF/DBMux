# Architecture guide

See [root architecture](../ARCHITECTURE.md) and [agent engineering rules](../AGENTS.md).

`src/server` handles HTTP and MCP transports; `src/mcp/tools.ts` registers bounded, clearly described tools/resources. `src/services/gateway.ts` intersects permissions and applies SQL policy/audit before adapter execution. `src/security` contains authenticated encryption, identity management, conservative classification and safe errors. `src/database` contains pooled, dialect-specific catalog/SQL implementations. `src/storage` persists gateway metadata in SQLite. The UI calls the authenticated admin API; the optional bridge only forwards protocol messages.

To add an engine, implement DatabaseAdapter, pooling, retained transactions, bounded catalogs, safe normalization, identifier quoting and shutdown. Add connection validation and manager selection. To add a tool, register a bounded Zod schema, document intent and risk, call gateway authorization/execution, and add tests proving denial paths cannot bypass policy. Never perform user-supplied SQL execution directly from tool/API code.
