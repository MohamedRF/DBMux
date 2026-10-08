# Contributing to DBMux

Thanks for helping make development database access easier to understand, review and operate. Documentation, reproducible bug reports, focused fixes, security regression tests and engine validation are all useful contributions.

Read the [README](README.md) for the product workflow, [architecture](ARCHITECTURE.md) for the design, and [AGENTS.md](AGENTS.md) for repository engineering requirements. Report vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Before you start

- Search existing issues and pull requests before opening a new one.
- For a significant feature, new engine, dependency or public contract change, open an issue describing the problem and proposed approach before implementing it.
- Keep fixes focused. Avoid unrelated refactoring, generated output and dependency upgrades.
- Use synthetic data and disposable databases. Never share credentials, tokens, master keys, private SQL/binds or unredacted logs.

Good starting points include onboarding documentation, reproducible regression tests, UI accessibility, catalog correctness and clearer tool descriptions. Do not label an engine as supported solely on the basis of mocked tests.

## Local setup

Use Node.js **24.15.0 or later, below 25**, npm and Git. Docker with Compose is needed only for the disposable PostgreSQL tests or container validation.

1. Fork the repository and clone your fork.
2. Create a branch describing your change, for example `docs/improve-onboarding` or `fix/token-expiry`.
3. Install locked dependencies:

   ```bash
   npm ci
   ```

4. For a running gateway, follow the [README quick start](README.md#quick-start) to create `.env` and a master key, then run `npm run dev`.
5. If changing the STDIO bridge, run `npm ci` separately in `bridge/`.

The default test suite creates its own temporary storage and does not require your `.env` or a live database. Do not copy real server secrets into tests.

## Find the right layer

| Location                | Responsibility                                                                 |
| ----------------------- | ------------------------------------------------------------------------------ |
| `src/server/`           | HTTP and MCP transports.                                                       |
| `src/api/admin.ts`      | Authenticated administrator API.                                               |
| `src/mcp/tools.ts`      | Central MCP tool/resource registration and validated inputs.                   |
| `src/services/`         | Gateway authorization, orchestration, transactions, snapshots and activity.    |
| `src/security/`         | Identities, permissions, authenticated encryption, SQL policy and safe errors. |
| `src/database/`         | Adapter contract, connection management and engine-specific implementations.   |
| `src/storage/sqlite.ts` | Persistent gateway metadata and audit storage.                                 |
| `src/ui/`               | Browser administrator workspace and public user guide.                         |
| `bridge/`               | Optional STDIO-to-HTTP forwarding client.                                      |
| `tests/`                | Behavior, policy, protocol, UI and live integration tests.                     |
| `docs/`                 | Setup, security, engine and operational documentation.                         |

Use strict TypeScript, ES modules, npm, MCP SDK v2 and Zod. Follow existing conventions and reuse established services rather than introducing parallel execution paths. There is no separate ESLint command configured; TypeScript checks and Prettier are the configured static and formatting checks.

## Security and behavior requirements

These invariants are part of the contribution contract:

- Every user SQL execution path must pass through central authorization, SQL policy and audit. Keep tools free of dialect SQL and adapters free of HTTP/MCP concerns.
- Intersect token and connection grants and revalidate them on every call. Frontend visibility is not authorization.
- Never return stored credentials through MCP, REST, logs, errors or fixtures. Do not log request bodies or raw driver errors.
- Bind values and catalog predicates. Validate and quote identifiers only at adapter boundaries. Bound input sizes, query results and catalog discovery.
- Deny unknown and arbitrary procedural SQL. Do not weaken policy or database TLS verification to make a test pass.
- Persist audit intent before mutation. Preserve failed and partial migrations; an interrupted operation must not be silently replayed.
- Bind prepared changes to their owner and consume them atomically. Retained transactions must retain one physical connection, serialize operations, enforce ownership/expiry and roll back on shutdown.
- Oracle DDL commits implicitly and is forbidden inside retained DML transactions. Do not claim Oracle DDL is reversible.
- Preserve authenticated encryption, secure random tokens with SHA-256 storage and scrypt administrator passwords.

Changes to security boundaries need tests proving both permitted behavior and denial paths. See [the security model](docs/security.md) for deployment assumptions and indirect database effects.

### Adding an MCP tool

Register the tool in `src/mcp/tools.ts`, use a bounded Zod input schema and describe intent, output and risk clearly. Route authorization and execution through the gateway. Test invalid inputs, insufficient grants, disabled tools, out-of-scope connections/schemas and relevant confirmation/audit behavior. Update user documentation when the tool changes the workflow.

### Adding or changing an adapter

Implement `DatabaseAdapter` with pooling, bounded catalog discovery, safe normalization, parameter binding, identifier quoting, retained transaction acquisition and shutdown. Update validated connection configuration and manager selection as needed. Keep engine details inside the adapter.

Run against an actual disposable development engine and document its version and limitations before claiming support. Mocked tests alone do not establish catalog, driver or transaction correctness. Never run acceptance against production.

## Checks before a pull request

Run all four required commands from the repository root:

```bash
npm run check
npm test
npm run build
npm run format:check
```

| Command                | Checks                                                         |
| ---------------------- | -------------------------------------------------------------- |
| `npm run check`        | Strict TypeScript without emitting files.                      |
| `npm test`             | Node test runner through `tsx`, including optional live tests. |
| `npm run build`        | TypeScript compilation.                                        |
| `npm run format:check` | Repository formatting with Prettier.                           |

Format only the files you changed, for example:

```bash
npx --no-install prettier --write README.md CONTRIBUTING.md
```

`npm run format` rewrites the whole repository; avoid unrelated formatting changes. Review the complete diff, remove debug output and confirm that no secrets, local data or generated build output are included.

Add focused behavior tests for meaningful changes. Cover applicable failure cases, empty/null inputs, authorization, duplicate requests, concurrency and backward compatibility. Do not weaken existing tests. For UI changes, include a redacted screenshot and describe keyboard/responsive checks.

## Live PostgreSQL tests

The two live tests skip unless `TEST_PG_PASSWORD` is set. Use only the disposable PostgreSQL 17 service defined in `docker-compose.test.yml`: `127.0.0.1:55432`, database/user `dbmux_test`. Tests create and remove objects there. They do not use your saved gateway connections.

**macOS / Linux**

```bash
export TEST_PG_PASSWORD="$(node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))")"
docker compose -p dbmuxverify -f docker-compose.test.yml up -d --wait
npm test
docker compose -p dbmuxverify -f docker-compose.test.yml down
unset TEST_PG_PASSWORD
```

**Windows PowerShell**

```powershell
$env:TEST_PG_PASSWORD = node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))"
docker compose -p dbmuxverify -f docker-compose.test.yml up -d --wait
npm test
docker compose -p dbmuxverify -f docker-compose.test.yml down
Remove-Item Env:TEST_PG_PASSWORD
```

If startup fails, resolve that failure before running the tests. Run the cleanup commands even if tests fail. The database uses temporary storage; treat it as disposable. Ensure port 55432 is free and never forward it to a real database.

For Oracle changes, follow [Oracle acceptance](docs/oracle.md) using a dedicated disposable Oracle 19c development account. Record exactly what was exercised; live Oracle acceptance is currently outstanding.

The [CI workflow](.github/workflows/ci.yml) runs the four required checks with disposable PostgreSQL on pull requests and pushes. It does not establish Oracle or production acceptance.

## Submit a pull request

Explain the problem and resulting behavior for someone who has not read the issue discussion. Include relevant examples, validation results and limitations. Link the related issue and use the pull request template.

Before requesting review:

- [ ] The change is focused and follows the existing architecture.
- [ ] Behavior/security tests cover the affected boundaries.
- [ ] All four required checks passed, or failures/unavailable checks are explained.
- [ ] Live engine validation is recorded when adapter behavior changes.
- [ ] Documentation describes changed behavior and public contracts.
- [ ] No credentials, private data, debug artifacts or unrelated generated files are included.
- [ ] Security, transaction, concurrency and compatibility risks have been reviewed.

Do not make destructive migrations, alter secrets, add production dependencies or deploy production changes without explicit authorization. State skipped checks honestly; never treat a skipped live test as engine acceptance.

## Working together

Keep discussions respectful and specific. Explain reproduction steps and tradeoffs, welcome questions, and review the code rather than the person. Contributions remain covered by the repository's [MIT License](LICENSE).
