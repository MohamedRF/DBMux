# DBMux

An independent, self-hosted Oracle and PostgreSQL development gateway for AI coding agents. Developers receive individually revocable MCP tokens; database credentials stay encrypted on the server. The main transport is SDK v2 Streamable HTTP at `/mcp`.

DBMux combines bounded schema discovery, policy-checked changes, owner-bound confirmations, audit history, retained DML transactions, named migrations, schema snapshots/diffs and ordered SQL export. The browser UI manages connections and developer access; it is intentionally small.

Name candidates considered: DBMux, SchemaDock, DatumGate, QueryHarbor, SchemaRelay, DevCatalog, TablePort, ChangeLedger, SchemaPilot and DataSpan. DBMux matches this repository/workspace; no trademark or npm-scope ownership is claimed.

## Server installation

```bash
git clone <your-repository-url> dbmux
cd dbmux
cp .env.example .env
mkdir -p data secrets
openssl rand -hex 32 > secrets/mcp_master_key.txt
chmod 600 secrets/mcp_master_key.txt
openssl rand -hex 32 # paste this separate random value into SETUP_TOKEN in .env
docker compose up -d --build
```

Set `PUBLIC_URL` to the exact browser/client origin before starting. Compose binds to `127.0.0.1:3001` by default for a local reverse proxy. Set `HOST_PORT` in `.env` to change the published port; the container continues listening on port 3000. Update `PUBLIC_URL` to match the browser/client URL when changing ports. To use a private LAN interface, set `BIND_ADDRESS` to that interface's address and `PUBLIC_URL=http://SERVER_IP:3001` during initial setup. Use HTTPS for remote developer access. SQLite persists in the `dbmux_data` Docker volume; the `data` directory is used by local Node development. A named volume avoids host-directory ownership problems with the non-root container.

Open the configured URL. Enter the bootstrap token from `.env`, create an administrator with a password of at least 14 characters, then:

1. Add an Oracle or PostgreSQL development connection with MCP disabled.
2. Test it. Choose explicit allowed application schemas and an access level.
3. Enable MCP.
4. Create a separate scoped token for each developer; copy it immediately.
5. Copy the client configuration from Installation and set `DB_MCP_TOKEN` locally.

Never commit `.env`, secrets, raw tokens or database passwords. Back up the SQLite volume and master key separately; losing the key makes encrypted connections, snapshots and audit payloads unrecoverable.

## Using the MCP

Developers need only an MCP endpoint and their token. They do not need database passwords, Oracle Instant Client or PostgreSQL tools.

```json
{
  "mcpServers": {
    "development-db": {
      "url": "https://dbmcp.example.edu/mcp",
      "headers": { "Authorization": "Bearer ${DB_MCP_TOKEN}" }
    }
  }
}
```

This is a conceptual generic configuration. Environment expansion is client-specific: see [client instructions](docs/mcp-clients.md). A separate [local STDIO bridge](bridge/README.md) supports process-based clients; it contains no database implementation. The proposed npm package has not been published, so use its local absolute path until your organization publishes it.

## Feature workflow

Use `db_connections`, `db_schema_context`, `db_describe_table` and `db_object_dependencies` to inspect conventions. Capture `db_schema_snapshot` before a feature. Preview and apply `db_apply_migration` for ordinary CREATE/ALTER changes. Supply `context: {"project":"student-portal","branch":"feature/preferences"}` for writes.

Use bind arrays (`$1`) for PostgreSQL and named bind objects (`:id`) for Oracle. Queries default to 100 rows and cap at 1000. High-risk changes, including DELETE with WHERE, require `db_prepare_change`, developer confirmation and `db_execute_change`. UPDATE/DELETE without a top-level WHERE are denied by default.

Capture an after snapshot and compare with `db_schema_diff`. `db_change_history` shows SQL, binds, outcomes and context. `db_export_changes` returns ordered successful SQL plus a bind manifest; review before replay. Snapshot diffs describe schema changes; they cannot reconstruct row changes or generate exact SQL for external modifications. Oracle DDL implicitly commits. Oracle retained transactions accept DML only; PostgreSQL transactions also accept DDL.

## Local development and validation

Node 24 LTS and npm are required. Create the master key and environment settings as above, then:

```bash
npm ci
npm run check
npm test
npm run build
npm run format:check
node --env-file=.env dist/src/main.js
```

The live PostgreSQL tests are optional and visibly skipped without `TEST_PG_PASSWORD`. They operate only on the disposable test service at loopback port 55432:

```bash
export TEST_PG_PASSWORD="$(openssl rand -hex 24)"
docker compose -p dbmuxverify -f docker-compose.test.yml up -d --wait
npm test
docker compose -p dbmuxverify -f docker-compose.test.yml down
```

Do not point this test suite at a production database. See [Oracle validation](docs/oracle.md) for testing your existing Oracle 19c development instance. `npm run dbmcp -- status` uses the admin API; set `DBMUX_ADMIN_TOKEN` to your short-lived administrator session and optionally `DBMUX_URL`.

## Current acceptance boundary

This is a working implementation requiring Oracle acceptance and a deployment-specific security review before production use. See [verification and limitations](docs/verification.md). SQL policy deliberately denies unknown syntax, administrative SQL, arbitrary routine execution, RETURNING clauses, CASCADE and unsplit multi-statement scripts. Oracle stored procedure/function/trigger/package definitions require a single CREATE header and END terminator; live Oracle compilation remains unverified. Oracle Thin mode is implemented; Thick mode is not enabled. Confirmation tokens implement an API two-step flow; the agent/client must obtain actual human approval before sending `confirm:true`.

Documentation: [architecture](ARCHITECTURE.md), [security](docs/security.md), [installation/networking](docs/installation.md), [Oracle](docs/oracle.md), [PostgreSQL](docs/postgresql.md), [MCP clients](docs/mcp-clients.md). Licensed under MIT; no DBX code, assets or architecture were copied.
