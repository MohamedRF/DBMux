# Reporting security issues

Do not publish vulnerabilities, database credentials, tokens, master keys or private audit data in public issues or pull requests.

If GitHub private vulnerability reporting is enabled, use **Security → Report a vulnerability** on the [DBMux repository](https://github.com/MohamedRF/DBMux/security). Otherwise, arrange a private channel with the repository owner before sharing technical details. A dedicated public security contact address has not yet been configured; do not assume ordinary GitHub issues are private.

Include the affected commit/version, impact, prerequisites and a minimal reproduction using synthetic data. Never attach `.env`, tokens, master keys, metadata databases or unredacted audit exports. Coordinate disclosure with the maintainer before publishing details. No response-time guarantee or maintained release support window is currently published.

Read [the security model](docs/security.md). This development gateway requires least-privilege accounts, HTTPS, private database networking, protected metadata backups and client-side human approval for confirmations.
