# Administrator workspace

Manage DBMux in the browser at your configured `PUBLIC_URL`. First-time setup uses `SETUP_TOKEN`; subsequent access requires an administrator session. The public [user guide](../README.md#connect-your-coding-client) is available at `/guide.html`.

## Connections and team handoff

Follow the [initial connection setup](../README.md#3-add-a-database-and-issue-access) before issuing developer tokens. Stored passwords are never displayed; leave the password blank when editing to retain it. A blank custom Oracle connect string also preserves the stored value.

The **MCP installation → Copy team setup guide** action includes the endpoint, selected client configuration and public guide link. The public guide can also be copied as text or printed/saved as PDF. Send each developer's token privately and separately.

**Rotate** replaces and immediately revokes the old token; copy and privately deliver the replacement. **Revoke** removes access without changing database credentials.

For the administrator CLI, `npm run dbmcp -- status` calls the admin API. Set `DBMUX_ADMIN_TOKEN` to your short-lived administrator session and optionally set `DBMUX_URL`. Developer MCP tokens cannot serve as administrator sessions.

## Portal access management and activity

The MCP access page supports creating, editing, rotating and revoking developer tokens. Edits preserve the secret and revalidate access on each call. An omitted expiry preserves its current value; a supplied number of days sets expiry from the update time. Inactive tokens can be deleted without removing their recorded activity.

Activity logs record portal API and MCP transport requests plus individual registered tool outcomes. Administrator-only filters and NDJSON exports are available at `/api/activity` and `/api/activity/export`. Exports include all matching records in bounded batches. Database history also has a complete connection export at `/api/audit/export?connectionId=...`; its existing encrypted SQL audit remains separate.

Activity records contain assigned caller names and IDs, direct peer addresses, normalized routes or tool names, timestamps, request IDs, durations, HTTP statuses and safe error codes. They exclude request bodies, credentials, forwarded headers and raw errors. HTTP success describes transport delivery; tool outcomes describe execution. A token identifies its assigned owner rather than proving who used it. Reverse proxies appear as the source address. Logs start when this version is installed and are retained in SQLite without automatic deletion; monitor storage growth. NDJSON downloads can be large and are buffered by the browser before saving.

## Dashboard, effective access and request timelines

The Dashboard summarizes requests and HTTP failures separately from MCP tool calls and tool failures. It includes seven days of traffic, tools taking at least one second, tokens expiring within seven days and the last explicit connection-test results. Today follows the browser’s UTC offset. Dashboard refreshes read metadata only; they do not probe databases. Tests are explicit actions, and changing a saved connection invalidates its cached health result.

MCP access uses named connection checkboxes and permission toggles for token grants. The connection editor also uses permission toggles. Effective-access previews intersect token and connection grants and show unavailable access for disabled, removed, expired or revoked connections/tokens. SQL policy, schema restrictions, blocked objects and disabled tools remain authoritative. Routine execution stays blocked; existing routine grant flags are preserved during edits.

Activity supports text search (`q`) plus exact caller ID (`actorId`), connection ID (`connectionId`) and operation (`operation`) filters alongside the existing caller/type/outcome/date filters. Downloads use the same filters. Connection IDs are recorded only after resolving an authorized, stored connection, so out-of-scope requests do not persist arbitrary requested IDs.

`GET /api/activity/requests/:requestId` provides independently paginated request/tool events (`offset`) and SQL-audit metadata (`auditOffset`), with a bounded `limit` of 1–100. `GET /api/audit/:id` opens the encrypted SQL audit on demand. Both require an administrator session. New audit correlation columns link the incoming request ID and its tool-event ID. Existing audit payload `requestId` fields keep their original per-execution meaning; old audits remain available without invented links to previous requests. Upgrades add nullable columns and indexes without removing existing history. Failed migration results are recorded as tool failures even when the migration service returns structured partial progress instead of throwing.

[Back to the README](../README.md)
