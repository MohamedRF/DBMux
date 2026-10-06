# Implementation plan

Build and verify each phase before advancing:

1. Foundation: strict TypeScript, Node 24 LTS, SDK v2 HTTP, Zod, Pino, SQLite, configuration, health and tests.
2. Connection system: encryption, adapter interface, Oracle/PG pools, sanitized connection management.
3. Metadata: bounded catalogs, table definitions, routines and compact context.
4. Read MCP: discovery, bounded queries, resources and protocol tests.
5. Safety: conservative SQL tokenizer, permissions, protected schemas, risk, single-use confirmations, durable audit.
6. Changes: DML/DDL, retained-client transactions and recorded migrations.
7. Intelligence: snapshots/diff, dependencies, source search and ordered SQL export.
8. Administration: bootstrap/login, connections, tokens, audit and installation UI.
9. Deployment: non-root multi-stage Docker, Compose, secrets, health and network/proxy documentation.
10. Bridge: independently packaged STDIO client bridge without database dependencies.
11. Acceptance: unit/security/protocol/integration tests, build, formatting, dependency audit and Docker smoke test.

Live Oracle acceptance requires a supplied development database. Do not claim it passed without execution. Maintain a requirements/limitations section documenting unsupported catalog details or conservative policy denials.

Implemented phases 1–10, with the bounded execution and catalog restrictions recorded in `docs/verification.md`. Phase 11 has 13 passing tests when disposable PostgreSQL is enabled, including SDK v2 remote/bridge protocol checks and a feature workflow. Live Oracle acceptance, deployment-specific security review and npm publication remain external acceptance steps. No production deployment has been performed.
