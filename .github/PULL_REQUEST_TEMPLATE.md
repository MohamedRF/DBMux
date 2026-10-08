## What changes and why

Describe the problem and resulting behavior. Link related issues.

## Validation

- `npm run check`:
- `npm test` (include skipped tests):
- `npm run build`:
- `npm run format:check`:
- Live engine version/results, when relevant:
- UI screenshots/manual checks, when relevant (redacted):

## Risks and compatibility

Describe relevant authorization, SQL policy, audit, transaction, concurrency or public contract changes. Explain limitations and checks that could not be run.

## Checklist

- [ ] Changes follow CONTRIBUTING.md and AGENTS.md.
- [ ] Behavior/security tests cover the affected boundaries.
- [ ] User SQL stays behind central authorization, policy and audit.
- [ ] No credentials, private data, raw errors or request bodies are exposed.
- [ ] Documentation reflects changed behavior.
- [ ] The diff contains no unrelated formatting or generated output.
