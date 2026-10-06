# DBMux architecture

DBMux is an independent MCP-first development gateway. Database credentials stay on the server, encrypted with AES-256-GCM. Developers receive individually revocable, hashed bearer tokens scoped to connections and explicit permissions.

Streamable HTTP and the admin API call application services. SQL enters one policy and audit boundary before adapters acquire pooled connections. Oracle Thin mode and PostgreSQL implement the same adapter interface. SQLite stores application metadata, encrypted configurations, identities, tokens, confirmations, snapshots, migrations and audit events.

Oracle DDL implicitly commits; migrations report partial progress rather than promising rollback. PostgreSQL transactions retain a single physical client. Transactions are owner-bound, serialized, expire and roll back during shutdown. Arbitrary procedural blocks are denied because their effects cannot be safely inferred.

Snapshots capture accessible catalog definitions. Diffs compare object identity and normalized definitions, including columns, defaults, nullability, constraints, indexes and stored source. Audit-based migration export preserves execution order; catalog diffs cannot reconstruct changed row data or changes made outside DBMux.

Trust boundaries: HTTP authentication, token/connection permission intersection, SQL classification, protected schemas, adapter parameter binding, encrypted metadata. High-risk changes require expiring, single-use confirmation records tied to owner, connection and exact SQL. Administrator sessions cannot serve as developer tokens.

No database credentials are returned through REST, MCP, health or logs. SQL/parameters may contain sensitive values: audit stores encrypted statement payloads and exports require the same connection authorization. Public errors contain safe codes only.

Deploy one process per SQLite volume behind HTTPS. Back up metadata and the master key separately. Application policy supplements, and cannot replace, least-privilege development database accounts and network isolation.
