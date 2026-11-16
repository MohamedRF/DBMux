# MCP OAuth / browser sign-in — status and integration plan

**Status: not implemented.** DBMux currently has no external identity provider in its deployment, no prior client registration details, and no approval for the one new production dependency that statement-free JWT validation requires. This document records what inspection found, what an implementation needs, and what remains unverified. Scoped DBMux bearer tokens (`DB_MCP_TOKEN`) remain the supported mechanism for CI and unattended runners, unchanged.

## What exists today

- **Authentication**: administrators sign in with name + scrypt-hashed password (8-hour admin session token, hashed with SHA-256). Developers receive random MCP bearer tokens (`mcp_live_*`, SHA-256-hashed at rest) with connection scopes, permission flags, expiry and DB-backed revocation. Every tool call re-resolves the identity (`gateway.auth.current`) and intersects token grants with connection grants; SQL policy and auditing are applied centrally.
- **MCP endpoint**: authenticated Streamable HTTP at `/mcp`, challenge `WWW-Authenticate: Bearer realm="dbmux", error="invalid_token"` on `401`.
- **Deployment**: self-hosted Node process behind the operator's reverse proxy; no OIDC/OAuth provider anywhere in configuration, Compose files, environment examples or documentation.

## What the MCP authorization spec expects

For interactive clients (Codex, Claude Code, Cursor, VS Code, Copilot), remote MCP servers advertise OAuth so the client can drive a browser authorization-code flow with PKCE:

1. **Protected Resource Metadata** (RFC 9728) served from `/.well-known/oauth-protected-resource[/<path>]` listing the authorization server(s), the resource identifier (this server's URL), supported scopes and methods (`Authorization` header).
2. **`WWW-Authenticate` challenges** that include `resource_metadata` so clients can discover the document from a `401` (RFC 9728 §5.1).
3. **Resource-bound tokens** (RFC 8707, `aud` = the resource URL from PRM) verified on every request — signature, issuer, audience, expiry.
4. The **authorization server** is external (an existing org IdP or AS) and supports the client's registration mode — dynamic client registration (RFC 7591), Client ID Metadata Documents (CIMD, draft-ietf-oauth-client-id-metadata-document), or a pre-registered client.

## Reusable pieces already in the dependency tree

`@modelcontextprotocol/server` exports the resource-server primitives (`oauthMetadataResponse`, `buildOAuthProtectedResourceMetadata`, `verifyBearerToken`, `requireBearerAuth`, `getOAuthProtectedResourceMetadataUrl`, `OAuthTokenVerifier`), so serving the discovery documents and gating requests needs no new dependencies by itself.

## The missing dependency

Resource-bound access token **validation** is the one gap. Verifying JWT signatures requires a JWKS-capable verifier. The candidate is **`jose`** — it is only a _transitive_ dependency of `@modelcontextprotocol/client` today; importing it from server code without declaring it would be incorrect, and declaring it is approval for a new production dependency. Alternatives that avoid the new dependency:

- **RFC 7662 token introspection** against the authorization server — no JWT library needed, but requires the AS to expose `/introspect`, a confidential credential for the resource server, an encrypted store entry for that credential, and a per-request or cached introspection decision (this weakens the "no per-call external call" posture unless cached with a short TTL, and revocation semantics then match the DB's existing checks only as closely as the cache TTL).

Either path also needs: an **issuer**, an **audience/resource identifier**, and a **client registration decision** (DCR vs CIMD vs pre-registered static client per supported client).

## Mapping identities onto DBMux grants (design, unverified)

- Store an `oauth-identity` record in SQLite keyed by `issuer` + `sub`, holding the connection scope and permission flags exactly like an `Identity` (id, name, connections, permissions, expiresAt, revoked=false, hash-unused).
- A token verifier returns an `AuthInfo` whose `clientId` is the DBMux principal id; the existing per-request factory (`createMcpFactory`) then resolves the identity and applies the _same_ per-call permission checks, ownership binding, SQL policy and audit logging as `DB_MCP_TOKEN` today. Confirmations, owner-bound consumption and revocation semantics are preserved.
- OAuth access tokens are stateless and short-lived; revocation of the mapped identity removes grants at the next call, but an AS-issued access token cannot be revoked at the AS by DBMux. Short token TTLs plus identity revocation (the same kill switch as today) are the intended semantics.
- `DB_MCP_TOKEN` remains available for CI and unattended runners; the two authenticator types share the authorization boundary and audit trail, distinguished only by the `actor` label in activity rows.

## What still needs verification

1. Choice of external AS (e.g. Keycloak, Authentik, Entra ID, Auth0, Okta, or the org's existing IdP) and its issuer URL.
2. Client registration per supported client (Codex and Claude Code support CIMD/DCR and static client IDs; Cursor supports static `auth.CLIENT_ID` and dynamic registration; Copilot supports flat `oauthClientId` and DCR) and the exact callback/redirect URIs each requires.
3. End-to-end interactive flow on at least one supported client, including the `resource` parameter reaching the AS and the returned `aud` matching this resource.
4. PRM and challenge correctness from an external network (not just localhost).
5. Revocation behavior of the mapped identity, rotation of AS keys in the JWKS, and failure mode when the AS is unavailable.
6. Approval of `jose` (or the introspection design) as a direct production dependency.

Nothing on this list is deployed even behind a flag; the current codebase paths are unchanged. Once an AS and registration details exist and the dependency decision is approved, implementation order is: PRM + challenge → verifier + `oauth-identity` store → identity mapping → live client tests → audit/activity labelling → docs and matrix updates.
