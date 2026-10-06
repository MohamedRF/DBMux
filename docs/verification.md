# Verification and remaining acceptance

Executed locally: strict TypeScript checks/build; foundation/encryption/storage tests; policy/permission tests; scoped tokens, revocation/expiry and single-use confirmation tests; mocked transaction client-retention test; real SDK v2 HTTP handshake/tool/resource tests; live disposable PostgreSQL adapter tests; npm production dependency audits; multi-stage Docker build. Updated final counts/results are recorded in the completion message.

Not yet verified against an actual Oracle 19c instance: connection modes, catalogs, LONG dictionary fields, LOB normalization, implicit DDL commit and the complete enrollment-feature acceptance flow. No server credentials were supplied. No npm publication or production deployment was performed.

Deliberate restrictions: unknown SQL, arbitrary procedural execution, RETURNING, CASCADE and unsplit scripts are denied. High-risk statements must be prepared/confirmed individually. Oracle retained transactions are DML-only. Exact ALTER SQL for externally performed changes is not synthesized from catalog diffs; exports use actual MCP execution history. Bind manifests accompany parameterized SQL. Some specialized Oracle catalog details and complete materialized-view definitions require further adapter work.

Snapshots are bounded and not an atomic view of external concurrent DDL. Large stored definitions are bounded by result normalization; snapshots reject detected truncation instead of silently comparing incomplete definitions. Export currently has a 10,000 audit-record bound and project/branch filters. Single-process SQLite storage, deployment-specific TLS/firewall/proxy configuration, independent security review and Oracle acceptance are prerequisites before describing this as production-ready.
