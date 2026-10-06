# PostgreSQL

The adapter uses node-postgres Pool. Configuration includes host/port/database/user/password, max pool size, acquisition timeout, idle timeout and TLS. TLS certificate verification is always enabled when SSL is selected; an optional CA can be supplied via the authenticated API. No insecure `rejectUnauthorized:false` fallback exists.

Catalog discovery uses information_schema and pg_catalog with visibility checks. It includes tables/partitions, columns/defaults/identity/generated expressions, views/materialized views, constraints, indexes, sequences, triggers, functions/procedures with overload identities, enum labels and extensions. Discovery is scoped to configured schemas and bounded by pagination.

SQL uses positional bind arrays. Standalone SELECT runs in BEGIN READ ONLY with a server-side cursor and statement_timeout. Retained DML transactions acquire one client for BEGIN, all statements and COMMIT/ROLLBACK. Failed transactions cannot be reported as committed. Transactions serialize operations, have owner-bound IDs and automatically expire. Statement timeout is set with bound set_config values.

PostgreSQL migrations use one retained transaction for DDL and DML together, rolling back the full migration on failure. High-risk migrations must be split into prepared/confirmed changes. Named migrations are uniquely reserved in SQLite before execution; inspect running/failed records before retrying.

Optional disposable PostgreSQL 17 Compose integration tests cover bounded rows, metadata, parameterized writes, rollback and read-only function side effects. Oracle is never bundled.

Primary reference: [node-postgres transactions](https://node-postgres.com/features/transactions).
