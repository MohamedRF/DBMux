# DBMux

Connect your AI coding client to Oracle and PostgreSQL development databases through one self-hosted gateway. DBMux lets your team inspect schemas, preview SQL, apply permitted changes and review the change trail. Database passwords stay encrypted on the server; each developer uses a personal, revocable MCP token.

**Administrators:** use the browser workspace to manage database connections, permissions, developer tokens and audit history. **Developers:** use DBMux from your existing MCP-compatible coding client. You do not need a browser administrator account, database passwords or local database drivers.

The browser includes a **User guide** at `/guide.html`, available without administrator sign-in. Share its URL with your team, copy the guide as text, or print/save it as a PDF. **MCP installation → Copy team setup guide** creates a handoff containing your endpoint, the selected client configuration and the guide link. Send each personal token privately and separately.

## Start here

| Your role       | What you need                                                           | Where to start                                            |
| --------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| Server operator | A host, Docker, development database access and a configured public URL | [Server installation](#server-installation)               |
| Administrator   | The bootstrap token for first setup, then an administrator account      | [Prepare team access](#prepare-team-access)               |
| Developer       | Your MCP endpoint and personal token from an administrator              | [Connect your coding client](#connect-your-coding-client) |

DBMux is a development gateway. Live Oracle acceptance and a deployment-specific security review remain prerequisites before production use; see [current limitations](#current-acceptance-boundary).

## Server installation

```bash
git clone <your-repository-url> dbmux
cd dbmux
cp .env.example .env
mkdir -p dbmux_data secrets
openssl rand -hex 32 > secrets/mcp_master_key.txt
sudo chown 1000:1000 secrets/mcp_master_key.txt dbmux_data
sudo chmod 400 secrets/mcp_master_key.txt
sudo chmod 700 dbmux_data
openssl rand -hex 32 # paste this separate random value into SETUP_TOKEN in .env
docker compose up -d --build
```

Set `PUBLIC_URL` to the exact browser/client origin before starting. Compose binds to `127.0.0.1:3001` by default for a local reverse proxy. Set `HOST_PORT` in `.env` to change the published port; the container continues listening on port 3000. Update `PUBLIC_URL` to match the browser/client URL when changing ports. To use a private LAN interface, set `BIND_ADDRESS` to that interface's address and `PUBLIC_URL=http://SERVER_IP:3001` during initial setup. Use HTTPS for remote developer access. SQLite persists in the host directory `dbmux_data`, mounted at `/app/data`; the `data` directory is used by local Node development. The Linux permission commands above allow the container's non-root user (UID/GID 1000) to read the key and write metadata. They assume standard rootful Docker without user namespace remapping; Docker Desktop uses host filesystem sharing permissions.

Open the configured URL. Enter the bootstrap token from `.env` and create an administrator with a password of at least 14 characters. For future visits, sign in with that administrator account.

Never commit `.env`, secrets, raw tokens or database passwords. Back up the SQLite volume and master key separately; losing the key makes encrypted connections, snapshots and audit payloads unrecoverable. Stop the gateway before copying SQLite files or use a SQLite-aware backup tool; copying the main file during active WAL writes is insufficient.

## Prepare team access

In the browser workspace:

1. **Connections → Add a connection.** Choose a stable ID (for example `project-dev`), engine, host, port, service/database and dedicated application credentials. Keep MCP disabled initially.
2. **Set access and safeguards.** Choose explicit allowed application schemas and the minimum permissions needed. Keep the default WHERE requirements for UPDATE and DELETE.
3. **Save → Test → Enable MCP.** Confirm connectivity before exposing the connection to developer clients. Stored passwords are never displayed; leave the password blank when editing to retain it. A blank custom Oracle connect string also preserves the stored value.
4. **MCP access → Create token.** Specify a developer name, permitted connection IDs, permissions and expiry. Copy the token immediately; it cannot be retrieved later. Deliver it privately to its owner.
5. **MCP installation.** Select the developer’s client and copy the team setup guide. Share it alongside the user guide URL, with the token delivered separately.

Effective access is the intersection of connection permissions and token permissions, rechecked on every call. Read Only permits inspection and reads. Development Write adds INSERT, UPDATE, DELETE, CREATE and ALTER. Full Development also permits DROP and TRUNCATE, subject to policy and human confirmation. Custom connection grants can restrict individual operations. Arbitrary routine execution remains denied.

**Rotate** immediately replaces and revokes a token; copy and privately deliver the replacement. **Revoke** removes access without changing database credentials.

## Connect your coding client

1. Get the MCP endpoint, your personal token and permitted connection IDs from your administrator.
2. Set `DB_MCP_TOKEN` in the environment used to launch your coding client. Replace the placeholder locally:

   **PowerShell**

   ```powershell
   $env:DB_MCP_TOKEN = "YOUR_PERSONAL_TOKEN"
   ```

   **macOS / Linux**

   ```bash
   export DB_MCP_TOKEN="YOUR_PERSONAL_TOKEN"
   ```

   **Windows Command Prompt**

   ```bat
   set "DB_MCP_TOKEN=YOUR_PERSONAL_TOKEN"
   ```

   These commands apply to the current shell session. Launch your client from that session; desktop clients must be able to read the same environment. Never commit the token.

3. Save your client configuration. The browser’s MCP installation page provides client-specific examples, file locations and copy buttons. See [client instructions](docs/mcp-clients.md) for Codex, Claude Code, Cursor and VS Code.
4. Restart or reconnect the client, then ask your agent:

   ```text
   Use DBMux to call db_connections and list my available development connections. Do not make changes.
   ```

The server uses authenticated, stateless Streamable HTTP at `/mcp`. This generic template illustrates the endpoint and Authorization header:

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

Environment expansion is client-specific; adapt this template rather than assuming every client accepts it. A separate [local STDIO bridge](bridge/README.md) supports process-based clients and inherits `DB_MCP_TOKEN`; it contains no database implementation. Run `npm ci` in `bridge` and configure its local absolute path. The proposed npm package has not been published. The bridge permits HTTPS or loopback HTTP only.

If no connections appear, ask the administrator to check MCP enablement and token scope. For authentication errors, check expiry/revocation and whether the client process can read `DB_MCP_TOKEN`. See the in-app User guide for more troubleshooting.

## Make your first change

1. **Inspect:** use `db_connections`, `db_schema_context`, `db_describe_table` and `db_object_dependencies` to understand existing conventions.
2. **Capture:** call `db_schema_snapshot` before the feature and keep the snapshot ID.
3. **Preview:** use `db_preview_change` for each proposed statement and review permissions and risk.
4. **Apply:** use `db_apply_migration` with a unique name and explicit statements for ordinary CREATE/ALTER changes. Supply `context: {"project":"student-portal","branch":"feature/preferences"}` for writes.
5. **Review:** capture an after snapshot, compare with `db_schema_diff`, and check `db_change_history`.

Use bind arrays (`$1`) for PostgreSQL and named bind objects (`:id`) for Oracle. Queries default to 100 rows and cap at 1000. High-risk changes, including DELETE with WHERE, require `db_prepare_change`, developer confirmation and `db_execute_change`. UPDATE/DELETE without a top-level WHERE are denied by default.

Prepared changes are single-use, owner-bound and valid for five minutes. Obtain actual human approval before sending `confirm:true` with the returned `changeId`. A WHERE clause alone does not guarantee a narrow or safe change. Review failed or pending migrations against the actual database state before retrying: some statements may already have applied.

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

## Portal access management and activity

The MCP access page supports creating, editing, rotating and revoking developer tokens. Edits preserve the secret and revalidate access on each call. An omitted expiry preserves its current value; a supplied number of days sets expiry from the update time. Inactive tokens can be deleted without removing their recorded activity.

Activity logs records portal API and MCP transport requests plus individual registered tool outcomes. Administrator-only filters and NDJSON exports are available at `/api/activity` and `/api/activity/export`. Exports include all matching records in bounded batches. Database history also has a complete connection export at `/api/audit/export?connectionId=...`; its existing encrypted SQL audit remains separate.

Activity records contain assigned caller names and IDs, direct peer addresses, normalized routes or tool names, timestamps, request IDs, durations, HTTP statuses and safe error codes. They exclude request bodies, credentials, forwarded headers and raw errors. HTTP success describes transport delivery; tool outcomes describe execution. A token identifies its assigned owner rather than proving who used it. Reverse proxies appear as the source address. Logs start when this version is installed and are retained in SQLite without automatic deletion; monitor storage growth. NDJSON downloads can be large and are buffered by the browser before saving.

## Dashboard, effective access and request timelines

The Dashboard summarizes requests and HTTP failures separately from MCP tool calls and tool failures. It includes seven days of traffic, tools taking at least one second, tokens expiring within seven days and the last explicit connection-test results. Today follows the browser’s UTC offset. Dashboard refreshes read metadata only; they do not probe databases. Tests are explicit actions, and changing a saved connection invalidates its cached health result.

MCP access uses named connection checkboxes and permission toggles for token grants. The connection editor also uses permission toggles. Effective-access previews intersect token and connection grants and show unavailable access for disabled, removed, expired or revoked connections/tokens. SQL policy, schema restrictions, blocked objects and disabled tools remain authoritative. Routine execution stays blocked; existing routine grant flags are preserved during edits.

Activity supports text search (`q`) plus exact caller ID (`actorId`), connection ID (`connectionId`) and operation (`operation`) filters alongside the existing caller/type/outcome/date filters. Downloads use the same filters. Connection IDs are recorded only after resolving an authorized, stored connection, so out-of-scope requests do not persist arbitrary requested IDs.

`GET /api/activity/requests/:requestId` provides independently paginated request/tool events (`offset`) and SQL-audit metadata (`auditOffset`), with a bounded `limit` of 1–100. `GET /api/audit/:id` opens the encrypted SQL audit on demand. Both require an administrator session. New audit correlation columns link the incoming request ID and its tool-event ID. Existing audit payload `requestId` fields keep their original per-execution meaning; old audits remain available without invented links to previous requests. Upgrades add nullable columns and indexes without removing existing history. Failed migration results are recorded as tool failures even when the migration service returns structured partial progress instead of throwing.
