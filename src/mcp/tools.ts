import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Gateway } from "../services/gateway.js";
import type { Identity } from "../security/auth.js";
import type { CatalogKind } from "../database/adapter.js";
import { GatewayError, safeError } from "../security/errors.js";
const connectionInput = { connectionId: z.string().min(1).max(64) };
const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_$#]*$/);
const page = {
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).max(1000000).default(0),
};
const context = z.record(z.string().max(32), z.string().max(200)).default({});
const scalar = z.union([
  z.string().max(65536),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const parameters = z
  .union([z.array(scalar), z.record(z.string(), scalar)])
  .default([]);
const sqlInput = {
  ...connectionInput,
  sql: z.string().min(1).max(100000),
  parameters,
  context,
};
const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});
export function registerTools(
  server: McpServer,
  gateway: Gateway,
  identity: Identity,
) {
  function tool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    fn: (args: z.infer<z.ZodObject<S>>) => Promise<unknown> | unknown,
  ) {
    server.registerTool(
      name,
      { description, inputSchema: z.object(shape) },
      async (args) => {
        try {
          gateway.auth.current(identity.id);
          return result(await fn(args as z.infer<z.ZodObject<S>>));
        } catch (e) {
          return {
            ...result({ success: false, error: safeError(e) }),
            isError: true,
          };
        }
      },
    );
  }
  tool(
    "db_connections",
    "List only enabled connections within your token scope; never returns credentials.",
    {},
    () => gateway.connections(identity),
  );
  for (const name of [
    "db_connection_status",
    "db_test_connection",
    "db_server_info",
  ])
    tool(
      name,
      "Test pooled connectivity and return database version, connected identity and latency.",
      connectionInput,
      async (a) => {
        const access = gateway.schema(identity, a.connectionId, name);
        return name === "db_server_info"
          ? access.adapter.getServerInfo()
          : access.adapter.testConnection();
      },
    );
  const catalogs: Record<string, CatalogKind> = {
    db_list_schemas: "schemas",
    db_list_tables: "tables",
    db_list_views: "views",
    db_list_indexes: "indexes",
    db_list_constraints: "constraints",
    db_list_foreign_keys: "constraints",
    db_list_sequences: "sequences",
    db_list_triggers: "triggers",
    db_list_routines: "routines",
    db_list_synonyms: "synonyms",
    db_list_enums: "enums",
    db_list_extensions: "extensions",
    db_list_materialized_views: "materializedViews",
  };
  for (const [name, kind] of Object.entries(catalogs))
    tool(
      name,
      `Inspect accessible ${kind} within configured schemas. Results are bounded; use offset for pagination.`,
      {
        ...connectionInput,
        schema: identifier.optional(),
        table: identifier.optional(),
        ...page,
      },
      async (a) => {
        const r = await gateway.catalog(
          identity,
          a.connectionId,
          name,
          kind,
          a,
        );
        return {
          ...r,
          rows:
            name === "db_list_foreign_keys"
              ? r.rows.filter((row) => ["R", "f"].includes(String(row.kind)))
              : name === "db_list_materialized_views"
                ? r.rows.filter(
                    (row) =>
                      row.kind === "m" || row.kind === "MATERIALIZED VIEW",
                  )
                : r.rows,
        };
      },
    );
  tool(
    "db_describe_table",
    "Describe columns, defaults, identities, generated columns, constraints and indexes before modifying an unfamiliar table.",
    { ...connectionInput, schema: identifier, table: identifier },
    (a) =>
      gateway.describe(
        identity,
        a.connectionId,
        "db_describe_table",
        a.schema,
        a.table,
      ),
  );
  tool(
    "db_get_routine_source",
    "Inspect routine/package source. PostgreSQL overloads include identity and arguments; Oracle returns ordered source lines.",
    { ...connectionInput, schema: identifier, name: identifier, ...page },
    (a) =>
      gateway.catalog(
        identity,
        a.connectionId,
        "db_get_routine_source",
        "source",
        a,
      ),
  );
  for (const name of ["db_search_objects", "db_search_routine_source"])
    tool(
      name,
      "Search accessible object names or stored source text; paginate large result sets.",
      {
        ...connectionInput,
        schema: identifier.optional(),
        query: z.string().min(1).max(200),
        ...page,
      },
      (a) =>
        gateway.catalog(
          identity,
          a.connectionId,
          name,
          name === "db_search_objects" ? "objects" : "source",
          a,
        ),
    );
  tool(
    "db_object_dependencies",
    "Inspect catalog dependencies before changing or dropping an object.",
    { ...connectionInput, schema: identifier, name: identifier, ...page },
    (a) =>
      gateway.catalog(
        identity,
        a.connectionId,
        "db_object_dependencies",
        "dependencies",
        a,
      ),
  );
  tool(
    "db_schema_context",
    "Build compact context from selected tables and optional relations/indexes. Sample data is excluded.",
    {
      ...connectionInput,
      schemas: z.array(identifier).max(10).optional(),
      tables: z.array(identifier).max(50).optional(),
      includeRelations: z.boolean().default(true),
      includeIndexes: z.boolean().default(false),
      includeSampleData: z.literal(false).default(false),
      limit: z.number().int().min(1).max(50).default(20),
      offset: page.offset,
    },
    async (a) => {
      const access = gateway.schema(
        identity,
        a.connectionId,
        "db_schema_context",
      );
      const output: string[] = [];
      let truncated = false;
      for (const schema of a.schemas ?? access.config.policy.allowedSchemas) {
        const tables = await gateway.catalog(
          identity,
          a.connectionId,
          "db_schema_context",
          "tables",
          { schema, limit: a.limit, offset: a.offset },
        );
        truncated ||= tables.truncated;
        for (const table of tables.rows) {
          if (a.tables && !a.tables.includes(String(table.name))) continue;
          const d = await gateway.describe(
            identity,
            a.connectionId,
            "db_schema_context",
            schema,
            String(table.name),
          );
          output.push(`\n${schema}.${table.name}`);
          for (const c of d.columns as Record<string, unknown>[])
            output.push(
              `${c.column_name} ${c.data_type}${c.char_length ? "(" + c.char_length + ")" : ""} ${c.is_nullable === "NO" || c.is_nullable === "N" ? "NOT NULL" : ""}`,
            );
          if (a.includeRelations)
            output.push("Constraints: " + JSON.stringify(d.constraints));
          if (a.includeIndexes)
            output.push("Indexes: " + JSON.stringify(d.indexes));
        }
      }
      const value = output.join("\n");
      return {
        context: value.slice(0, 60000),
        truncated: truncated || value.length > 60000,
      };
    },
  );
  tool(
    "db_query",
    "Run a bounded SELECT with binds. Default 100 rows, maximum 1000. Modifications and unknown SQL are rejected.",
    { ...sqlInput, limit: page.limit },
    (a) =>
      gateway.run(
        identity,
        a.connectionId,
        "db_query",
        a.sql,
        a.parameters,
        a.context,
        { queryOnly: true, limit: a.limit },
      ),
  );
  tool(
    "db_execute",
    "Execute one allowed DML/DDL statement through policy and audit. High-risk SQL requires prepare/confirm.",
    sqlInput,
    (a) =>
      gateway.run(
        identity,
        a.connectionId,
        "db_execute",
        a.sql,
        a.parameters,
        a.context,
      ),
  );
  for (const name of ["db_execute_script", "db_apply_migration"])
    tool(
      name,
      "Apply explicit SQL statements as a unique named migration. Preview first. High-risk statements require separate confirmation. Failures retain partial progress.",
      {
        ...connectionInput,
        name: z.string().min(1).max(100),
        statements: z.array(z.string().min(1).max(100000)).min(1).max(100),
        context,
      },
      (a) =>
        gateway.migration(
          identity,
          a.connectionId,
          a.name,
          a.statements,
          a.context,
        ),
    );
  const ddl: Record<string, [string, string]> = {};
  for (const type of [
    "table",
    "index",
    "sequence",
    "view",
    "trigger",
    "routine",
  ])
    for (const op of ["create", "drop"])
      ddl[`db_${op}_${type}`] = [
        op === "create" ? "DDL_CREATE" : "DDL_DROP",
        type.toUpperCase(),
      ];
  ddl.db_alter_table = ["DDL_ALTER", "TABLE"];
  ddl.db_replace_view = ["DDL_CREATE", "VIEW"];
  ddl.db_replace_routine = ["DDL_CREATE", "ROUTINE"];
  for (const [name, [category, objectType]] of Object.entries(ddl))
    tool(
      name,
      `${category} ${objectType} with supplied dialect SQL. Central policy applies. Use prepare/confirm for high risk. Oracle stored definitions must end with END; do not include a SQL client slash delimiter. Arbitrary procedural execution remains denied.`,
      sqlInput,
      (a) =>
        gateway.run(
          identity,
          a.connectionId,
          name,
          a.sql,
          a.parameters,
          a.context,
          {
            expected: {
              category,
              objectType,
            },
          },
        ),
    );
  for (const name of ["db_preview_change", "db_prepare_change"])
    tool(
      name,
      name === "db_prepare_change"
        ? "Bind exact SQL and parameters to a single-use, owner-bound confirmation valid for five minutes. Obtain developer confirmation before execution."
        : "Classify SQL and show permissions, risk and Oracle implicit commit behavior without execution.",
      sqlInput,
      (a) =>
        name === "db_prepare_change"
          ? gateway.prepare(
              identity,
              a.connectionId,
              name,
              a.sql,
              a.parameters,
              a.context,
            )
          : gateway.preview(identity, a.connectionId, name, a.sql),
    );
  tool(
    "db_execute_change",
    "Execute an exact prepared change once after developer confirmation. Owner, connection, SQL and binds are verified.",
    { ...connectionInput, changeId: z.uuid(), confirm: z.literal(true) },
    (a) => gateway.confirm(identity, a.connectionId, a.changeId),
  );
  tool(
    "db_sample_rows",
    "Return at most 100 rows using explicitly selected columns. Sensitive table/column policy applies.",
    {
      ...connectionInput,
      schema: identifier,
      table: identifier,
      columns: z.array(identifier).min(1).max(100),
      limit: z.number().int().min(1).max(100).default(10),
    },
    (a) => {
      const access = gateway.schema(
        identity,
        a.connectionId,
        "db_sample_rows",
        a.schema,
      );
      const sql = `SELECT ${a.columns.map(access.adapter.quote).join(",")} FROM ${access.adapter.quote(a.schema)}.${access.adapter.quote(a.table)}`;
      return gateway.run(
        identity,
        a.connectionId,
        "db_sample_rows",
        sql,
        [],
        {},
        { queryOnly: true, limit: a.limit },
      );
    },
  );
  tool(
    "db_explain",
    "Return an estimated plan for allowed SELECT/UPDATE/DELETE. Never executes EXPLAIN ANALYZE.",
    sqlInput,
    async (a) => {
      const preview = gateway.preview(
        identity,
        a.connectionId,
        "db_explain",
        a.sql,
      );
      if (!["READ", "UPDATE", "DELETE"].includes(preview.category))
        throw new GatewayError(
          "EXPLAIN_UNSUPPORTED",
          "Only SELECT, UPDATE and DELETE may be explained.",
        );
      return gateway
        .authorize(identity, a.connectionId, "db_explain")
        .adapter.explain(a.sql, a.parameters);
    },
  );
  tool(
    "db_transaction_begin",
    "Begin an owner-bound retained physical connection; Oracle accepts DML only, PostgreSQL also accepts transactional DDL. Automatically rolls back after expiry.",
    connectionInput,
    (a) => {
      const access = gateway.authorize(
        identity,
        a.connectionId,
        "db_transaction_begin",
      );
      if (
        !access.permissions.insert &&
        !access.permissions.update &&
        !access.permissions.delete
      )
        throw new GatewayError(
          "MCP_DB_PERMISSION_DENIED",
          "Token has no DML permissions.",
        );
      return gateway.transactions.begin(
        identity.id,
        a.connectionId,
        access.adapter,
      );
    },
  );
  tool(
    "db_transaction_execute",
    "Execute SELECT/DML on your retained transaction connection. Oracle DDL and unconfirmed high-risk statements are denied.",
    { ...sqlInput, transactionId: z.uuid(), limit: page.limit },
    (a) =>
      gateway.run(
        identity,
        a.connectionId,
        "db_transaction_execute",
        a.sql,
        a.parameters,
        a.context,
        { transactionId: a.transactionId, limit: a.limit },
      ),
  );
  for (const name of ["db_transaction_commit", "db_transaction_rollback"])
    tool(
      name,
      "Finish your retained DML transaction and release its physical connection.",
      { ...connectionInput, transactionId: z.uuid() },
      (a) =>
        gateway.finishTransaction(
          identity,
          a.connectionId,
          a.transactionId,
          name === "db_transaction_commit",
        ),
    );
  tool(
    "db_schema_snapshot",
    "Persist schema definitions before/after changes. External concurrent DDL may affect snapshot consistency.",
    {
      ...connectionInput,
      schema: identifier,
      name: z.string().min(1).max(100),
    },
    (a) => {
      const access = gateway.schema(
        identity,
        a.connectionId,
        "db_schema_snapshot",
        a.schema,
      );
      return gateway.snapshots.capture(
        access.adapter,
        a.connectionId,
        a.schema,
        a.name,
        identity.id,
      );
    },
  );
  tool(
    "db_schema_diff",
    "Compare snapshots of the same connection/schema; report added, removed and changed definitions.",
    {
      ...connectionInput,
      beforeSnapshotId: z.uuid(),
      afterSnapshotId: z.uuid(),
    },
    (a) => {
      gateway.schema(identity, a.connectionId, "db_schema_diff");
      return gateway.snapshots.compare(
        a.beforeSnapshotId,
        a.afterSnapshotId,
        a.connectionId,
      );
    },
  );
  tool(
    "db_change_history",
    "Show bounded change history including failures, SQL/binds, project and branch.",
    { ...connectionInput, ...page },
    (a) =>
      gateway.history(
        identity,
        a.connectionId,
        "db_change_history",
        a.limit,
        a.offset,
      ),
  );
  tool(
    "db_export_changes",
    "Generate ordered successful SQL and bind manifest by project/branch. Excludes uncommitted/rolled-back DML.",
    {
      ...connectionInput,
      project: z.string().max(200).optional(),
      branch: z.string().max(200).optional(),
    },
    (a) => gateway.export(identity, a.connectionId, a.project, a.branch),
  );
  tool(
    "db_migration_history",
    "Inspect successful, running and failed migrations; names cannot accidentally be replayed.",
    connectionInput,
    (a) => {
      gateway.schema(identity, a.connectionId, "db_migration_history");
      return gateway.manager.store.db
        .prepare(
          "SELECT name,payload FROM mcp_migrations WHERE connection_id=? ORDER BY name LIMIT 100",
        )
        .all(a.connectionId)
        .map((r) => JSON.parse(String(r.payload)));
    },
  );
  server.registerResource(
    "connections",
    "db://connections",
    { description: "Enabled connections within your token scope." },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(gateway.connections(identity)),
        },
      ],
    }),
  );
  const resource = (
    name: string,
    template: string,
    fn: (v: Record<string, string | string[]>) => Promise<unknown>,
  ) =>
    server.registerResource(
      name,
      new ResourceTemplate(template, { list: undefined }),
      { description: "Read-only, permission-scoped database metadata." },
      async (uri, v) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(await fn(v)),
          },
        ],
      }),
    );
  resource("schemas", "db://connections/{connectionId}/schemas", (v) =>
    gateway.catalog(
      identity,
      String(v.connectionId),
      "db_list_schemas",
      "schemas",
      {},
    ),
  );
  resource(
    "tables",
    "db://connections/{connectionId}/schemas/{schema}/tables",
    (v) =>
      gateway.catalog(
        identity,
        String(v.connectionId),
        "db_list_tables",
        "tables",
        { schema: String(v.schema) },
      ),
  );
  resource(
    "table",
    "db://connections/{connectionId}/schemas/{schema}/tables/{table}",
    (v) =>
      gateway.describe(
        identity,
        String(v.connectionId),
        "db_describe_table",
        String(v.schema),
        String(v.table),
      ),
  );
  resource("context", "db://connections/{connectionId}/schema-context", (v) =>
    gateway.catalog(
      identity,
      String(v.connectionId),
      "db_schema_context",
      "tables",
      {},
    ),
  );
}
