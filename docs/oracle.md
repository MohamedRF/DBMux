# Oracle

The official node-oracledb adapter uses Thin mode and pooled connections. Configure a LAN hostname, port (usually 1521), service name, username/password, pool limits/timeouts and an explicit application schema. `host:port/service` is the normal connect string. SID mode creates a descriptor; a custom descriptor is available to administrators. Thick mode/Instant Client loading is not implemented.

Metadata uses accessible ALL_* dictionary views for tables, columns (including default/nullability/identity/virtual attributes), constraints and their columns, indexes and their columns, sequences, views, triggers, stored source, routines, objects, synonyms and dependencies. It does not require DBA views. Quoted identifiers are restricted to simple identifier characters. NUMBER values are fetched as strings to preserve precision; dates are normalized to ISO strings. RAW/BLOB/CLOB values return bounded metadata rather than raw binary or unlimited LOB text. Stored ALL_SOURCE lines are available for packages, procedures, functions and triggers.

Oracle DDL commits implicitly, including the transaction preceding DDL. DBMux reports `implicitCommit:true` and prohibits DDL inside retained DML transactions. Oracle migrations record each completed statement and may leave partial changes after failure; rollback does not reverse CREATE/ALTER/DROP. Migration export is an ordered history of actual MCP SQL, not a claim of reversible Oracle migrations.

For live acceptance, configure an existing disposable Oracle 19c DEV account through the UI, test it, then use the workflow in README. Create a uniquely named table, inspect constraints/indexes, snapshot it, add a column, compare snapshots, insert/update rows with named binds, prepare/confirm DELETE, and export changes by project/branch. Verify with an independent SQL session. Never run this against production.

Live Oracle tests have not been run without a supplied server. Oracle stored CREATE definitions with an END terminator are classified separately from executable PL/SQL blocks; compilation must be verified against your Oracle server. Full materialized-view definitions, index expressions, identity sequence options and specialized type attributes need further Oracle catalog acceptance. Synonym indirection is not a substitute for schema authorization; use direct application objects and least-privilege accounts.

Primary reference: [node-oracledb API](https://oracle.github.io/node-oracledb/doc/api.html).
