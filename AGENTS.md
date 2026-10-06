# Engineering DBMux

Use strict TypeScript, npm, Node 24 LTS, SDK v2 and Zod. Run `npm run check`, `npm test`, `npm run build` and `npm run format:check`. Keep adapters free of HTTP/MCP concerns and tools free of dialect SQL. Never log request bodies or raw driver errors.

Never introduce a database execution path that bypasses the central SQL policy and audit layers.

Never expose stored connection credentials through MCP responses, REST responses, logs, test fixtures or errors.

Add tools through the central tool registry and gateway authorization boundary. Add behavior/security tests and meaningful tool descriptions. New engines implement DatabaseAdapter and bounded catalog queries, transaction acquisition and shutdown. Test with an actual development engine before claiming support.

Oracle DDL commits implicitly and is forbidden in retained DML transactions. PostgreSQL transactions must use one acquired client. Serialise each transaction's operations, bind ownership, enforce expiry and roll back on shutdown. Treat unknown or procedural SQL as denied. Bind catalog predicates and query parameters; validate/quote identifiers only at adapter boundaries.

Credentials use authenticated encryption. Tokens use secure randomness and SHA-256 storage; administrator passwords use scrypt. Permissions intersect connection and token grants, revalidated per call. Confirmations are owner-bound and atomically consumed. Audit intent must persist before mutation. Do not erase failed or partial migrations.
