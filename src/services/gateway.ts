import { randomUUID } from "node:crypto";
import type { ConnectionManager } from "../database/manager.js";
import type { Binds, CatalogKind, CatalogFilter } from "../database/adapter.js";
import type { Auth, Identity } from "../security/auth.js";
import { intersect } from "../security/permissions.js";
import { assertPolicy, classify } from "../security/sql-policy.js";
import { GatewayError, safeError } from "../security/errors.js";
import { hash } from "../security/encryption.js";
import { Transactions } from "./transaction.service.js";
import { Snapshots } from "./schema-diff.service.js";
import { requestActivity } from "./activity.js";
interface Prepared {
  owner: string;
  connectionId: string;
  expiresAt: number;
  sealed: string;
}
export class Gateway {
  readonly transactions: Transactions;
  readonly snapshots: Snapshots;
  constructor(
    readonly manager: ConnectionManager,
    readonly auth: Auth,
    seconds = 300,
    onFailure: (id: string) => void = () => undefined,
  ) {
    this.transactions = new Transactions(seconds, onFailure);
    this.snapshots = new Snapshots(manager.store);
  }
  authorize(identity: Identity, id: string, tool: string) {
    const current = this.auth.current(identity.id);
    if (!current.connections.includes(id))
      throw new GatewayError(
        "CONNECTION_DENIED",
        "Connection is outside token scope.",
        403,
      );
    const config = this.manager.configFor(id);
    const activityId = requestActivity.getStore()?.toolActivityId;
    if (activityId) this.manager.store.attachActivityConnection(activityId, id);
    if (!config.enabled)
      throw new GatewayError(
        "MCP_DISABLED",
        "MCP is disabled for this connection.",
        403,
      );
    if (config.policy.disabledTools.includes(tool))
      throw new GatewayError("TOOL_DISABLED", "This tool is disabled.", 403);
    return {
      config,
      permissions: intersect(current.permissions, config.permissions),
      adapter: this.manager.adapter(id),
    };
  }
  connections(identity: Identity) {
    const token = this.auth.current(identity.id);
    return this.manager
      .list()
      .filter((c) => c.enabled && token.connections.includes(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        engine: c.engine,
        permissions: intersect(c.permissions, token.permissions),
      }));
  }
  schema(identity: Identity, id: string, tool: string, schema?: string) {
    const access = this.authorize(identity, id, tool);
    if (!access.permissions.read)
      throw new GatewayError(
        "MCP_DB_PERMISSION_DENIED",
        "Schema inspection is disabled.",
        403,
      );
    if (schema && !access.config.policy.allowedSchemas.includes(schema))
      throw new GatewayError(
        "SCHEMA_DENIED",
        "Schema is outside configured scope.",
        403,
      );
    return access;
  }
  async catalog(
    identity: Identity,
    id: string,
    tool: string,
    kind: CatalogKind,
    filter: CatalogFilter,
  ) {
    const a = this.schema(identity, id, tool, filter.schema);
    if (
      filter.table &&
      a.config.policy.blockedTables.some(
        (t) => t.toUpperCase() === filter.table!.toUpperCase(),
      )
    )
      throw new GatewayError("SENSITIVE_OBJECT", "Table inspection disabled.");
    const r = await a.adapter.catalog(kind, filter);
    return {
      ...r,
      rows: r.rows.filter(
        (row) =>
          !a.config.policy.blockedTables.some(
            (t) =>
              t.toUpperCase() ===
              String(row.table_name ?? row.name).toUpperCase(),
          ) &&
          !a.config.policy.blockedColumns.some(
            (c) => c.toUpperCase() === String(row.column_name).toUpperCase(),
          ),
      ),
    };
  }
  async describe(
    identity: Identity,
    id: string,
    tool: string,
    schema: string,
    table: string,
  ) {
    const a = this.schema(identity, id, tool, schema);
    if (
      a.config.policy.blockedTables.some(
        (t) => t.toUpperCase() === table.toUpperCase(),
      )
    )
      throw new GatewayError("SENSITIVE_OBJECT", "Table inspection disabled.");
    return a.adapter.describeTable(schema, table);
  }
  preview(identity: Identity, id: string, tool: string, sql: string) {
    const a = this.authorize(identity, id, tool);
    const analysis = assertPolicy(sql, a.permissions, {
      ...a.config.policy,
      engine: a.config.engine,
    });
    return {
      ...analysis,
      database: a.config.engine,
      allowed: true,
      implicitCommit:
        a.config.engine === "oracle" &&
        (analysis.category.startsWith("DDL") ||
          analysis.category === "TRUNCATE"),
      impact: analysis.requiresConfirmation
        ? [
            "Potential data loss or dependent object invalidation. Inspect dependencies and take a snapshot.",
          ]
        : [],
    };
  }
  prepare(
    identity: Identity,
    id: string,
    tool: string,
    sql: string,
    parameters: Binds,
    context: Record<string, string>,
  ) {
    const analysis = this.preview(identity, id, tool, sql);
    const changeId = randomUUID();
    this.manager.store.put("confirmation", changeId, {
      owner: identity.id,
      connectionId: id,
      expiresAt: Date.now() + 300000,
      sealed: this.manager.store.vault.seal({ sql, parameters, context }),
    } satisfies Prepared);
    return {
      changeId,
      ...analysis,
      expiresIn: 300,
      requiresConfirmation: true,
    };
  }
  async confirm(identity: Identity, id: string, changeId: string) {
    this.authorize(identity, id, "db_execute_change");
    const p = this.manager.store.get<Prepared>("confirmation", changeId);
    if (
      !p ||
      p.owner !== identity.id ||
      p.connectionId !== id ||
      p.expiresAt <= Date.now()
    )
      throw new GatewayError(
        "CONFIRMATION_UNAVAILABLE",
        "Confirmation is unavailable or expired.",
      );
    const consumed = this.manager.store.consume<Prepared>(
      "confirmation",
      changeId,
    );
    if (!consumed)
      throw new GatewayError(
        "CONFIRMATION_USED",
        "Confirmation was already used.",
      );
    const payload = this.manager.store.vault.open<{
      sql: string;
      parameters: Binds;
      context: Record<string, string>;
    }>(p.sealed);
    return this.run(
      identity,
      id,
      "db_execute_change",
      payload.sql,
      payload.parameters,
      payload.context,
      { confirmed: true },
    );
  }
  async run(
    identity: Identity,
    id: string,
    tool: string,
    sql: string,
    parameters: Binds,
    context: Record<string, string> = {},
    options: {
      confirmed?: boolean;
      queryOnly?: boolean;
      transactionId?: string;
      limit?: number;
      expected?: { category: string; objectType: string };
    } = {},
  ) {
    const a = this.authorize(identity, id, tool);
    const analysis = assertPolicy(sql, a.permissions, {
      ...a.config.policy,
      engine: a.config.engine,
    });
    if (options.queryOnly && analysis.category !== "READ")
      throw new GatewayError(
        "READ_REQUIRED",
        "Use db_execute for modifications.",
      );
    if (
      options.expected &&
      (analysis.category !== options.expected.category ||
        (analysis.objectType !== options.expected.objectType &&
          !(
            options.expected.objectType === "ROUTINE" &&
            ["FUNCTION", "PROCEDURE", "PACKAGE"].includes(
              analysis.objectType ?? "",
            )
          )))
    )
      throw new GatewayError(
        "TOOL_SQL_MISMATCH",
        "SQL does not match this tool operation.",
      );
    if (analysis.requiresConfirmation && !options.confirmed)
      throw new GatewayError(
        "CONFIRMATION_REQUIRED",
        "Use db_prepare_change followed by db_execute_change.",
      );
    if (
      options.transactionId &&
      a.config.engine === "oracle" &&
      analysis.category !== "READ" &&
      !["INSERT", "UPDATE", "DELETE"].includes(analysis.category)
    )
      throw new GatewayError(
        "DML_TRANSACTION_ONLY",
        "Retained transactions accept DML only; Oracle DDL commits implicitly.",
      );
    const auditPayload = {
      requestId: randomUUID(),
      tokenName: identity.name,
      sql,
      parameters,
      context,
      analysis,
      transactionId: options.transactionId,
    };
    const auditId = this.manager.store.audit(
      identity.id,
      id,
      tool,
      auditPayload,
      requestActivity.getStore(),
    );
    try {
      const execute = async (
        handle: Pick<typeof a.adapter, "executeQuery" | "executeStatement">,
      ) =>
        analysis.category === "READ"
          ? handle.executeQuery(sql, parameters, options.limit ?? 100)
          : handle.executeStatement(sql, parameters);
      const result = options.transactionId
        ? await this.transactions.run(
            options.transactionId,
            identity.id,
            (t) => {
              assertPolicy(
                sql,
                this.authorize(identity, id, tool).permissions,
                this.manager.configFor(id).policy,
              );
              if (t.connectionId !== id)
                throw new GatewayError(
                  "TRANSACTION_SCOPE",
                  "Transaction belongs to another connection.",
                );
              return execute({
                executeQuery: t.handle.query.bind(t.handle),
                executeStatement: t.handle.execute.bind(t.handle),
              });
            },
          )
        : await execute(a.adapter);
      this.manager.store.finishAudit(
        auditId,
        options.transactionId ? "uncommitted" : "success",
        { ...auditPayload, result },
      );
      return result;
    } catch (error) {
      this.manager.store.finishAudit(auditId, "failed", {
        ...auditPayload,
        error: safeError(error),
      });
      throw error;
    }
  }
  history(
    identity: Identity,
    id: string,
    tool: string,
    limit: number,
    offset: number,
  ) {
    this.schema(identity, id, tool);
    return this.manager.store.history(id, limit, offset);
  }
  async finishTransaction(
    identity: Identity,
    id: string,
    txId: string,
    commit: boolean,
  ) {
    this.authorize(
      identity,
      id,
      commit ? "db_transaction_commit" : "db_transaction_rollback",
    );
    const t = this.transactions.get(txId, identity.id);
    if (t.connectionId !== id)
      throw new GatewayError(
        "TRANSACTION_SCOPE",
        "Transaction belongs to another connection.",
      );
    const event = this.manager.store.audit(
      identity.id,
      id,
      commit ? "db_transaction_commit" : "db_transaction_rollback",
      { transactionId: txId },
      requestActivity.getStore(),
    );
    try {
      await this.transactions.finish(txId, identity.id, commit);
      this.manager.store.finishAudit(event, "success", {
        transactionId: txId,
        committed: commit,
      });
      return { transactionId: txId, committed: commit };
    } catch (e) {
      this.manager.store.finishAudit(event, "failed", {
        transactionId: txId,
        error: safeError(e),
      });
      throw e;
    }
  }
  async migration(
    identity: Identity,
    id: string,
    name: string,
    statements: string[],
    context: Record<string, string>,
  ) {
    const a = this.authorize(identity, id, "db_apply_migration");
    for (const sql of statements) {
      const preview = this.preview(identity, id, "db_apply_migration", sql);
      if (preview.requiresConfirmation)
        throw new GatewayError(
          "CONFIRMATION_REQUIRED",
          "High-risk statements must be prepared and confirmed separately.",
        );
      if (preview.category === "READ")
        throw new GatewayError(
          "MIGRATION_READ",
          "Migration requires modification statements.",
        );
    }
    const checksum = hash(JSON.stringify(statements));
    const initial = {
      name,
      checksum,
      owner: identity.id,
      startedAt: new Date().toISOString(),
      status: "running",
      statementsExecuted: 0,
    };
    const reservation = this.manager.store.db
      .prepare(
        "INSERT INTO mcp_migrations(connection_id,name,payload) VALUES(?,?,?) ON CONFLICT(connection_id,name) DO NOTHING",
      )
      .run(id, name, JSON.stringify(initial));
    if (!reservation.changes)
      throw new GatewayError(
        "MIGRATION_EXISTS",
        "Migration name already recorded; inspect its status before retrying.",
        409,
      );
    let executed = 0;
    const start = performance.now();
    let transactionId: string | undefined;
    try {
      if (a.config.engine === "postgres")
        transactionId = (
          await this.transactions.begin(identity.id, id, a.adapter)
        ).transactionId;
      for (const sql of statements) {
        await this.run(identity, id, "db_apply_migration", sql, [], context, {
          transactionId,
        });
        executed++;
      }
      if (transactionId)
        await this.finishTransaction(identity, id, transactionId, true);
      const result = {
        ...initial,
        status: "success",
        success: true,
        database: a.config.engine,
        statementsExecuted: executed,
        durationMs: performance.now() - start,
        atomic: !!transactionId,
      };
      this.manager.store.db
        .prepare(
          "UPDATE mcp_migrations SET payload=? WHERE connection_id=? AND name=?",
        )
        .run(JSON.stringify(result), id, name);
      return result;
    } catch (error) {
      let cleanupError: unknown;
      if (transactionId && this.transactions.has(transactionId, identity.id)) {
        try {
          await this.transactions.finish(transactionId, identity.id, false);
        } catch (rollbackError) {
          cleanupError = rollbackError;
        }
      }
      const result = {
        ...initial,
        status: "failed",
        success: false,
        statementsExecuted: executed,
        durationMs: performance.now() - start,
        error: safeError(error),
        partialChangesPossible: !transactionId || !!cleanupError,
        cleanupError: cleanupError ? safeError(cleanupError) : undefined,
      };
      this.manager.store.db
        .prepare(
          "UPDATE mcp_migrations SET payload=? WHERE connection_id=? AND name=?",
        )
        .run(JSON.stringify(result), id, name);
      return result;
    }
  }
  export(identity: Identity, id: string, project?: string, branch?: string) {
    const a = this.schema(identity, id, "db_export_changes");
    const rows = this.manager.store.history(id, 10000, 0);
    if (rows.length === 10000)
      throw new GatewayError(
        "EXPORT_LIMIT",
        "History exceeds export limit; narrow the date range in a future export.",
      );
    const committed = new Set(
      rows
        .filter(
          (r) => r.tool === "db_transaction_commit" && r.status === "success",
        )
        .map((r) => r.payload.transactionId),
    );
    const selected = rows.filter((r) => {
      const p = r.payload;
      const context = p.context as Record<string, string> | undefined;
      return (
        (r.status === "success" ||
          (r.status === "uncommitted" && committed.has(p.transactionId))) &&
        typeof p.sql === "string" &&
        (p.analysis as { category?: string })?.category !== "READ" &&
        (!project || context?.project === project) &&
        (!branch || context?.branch === branch)
      );
    });
    const statements = selected.map((r) => ({
      auditId: r.id,
      timestamp: r.timestamp,
      sql: r.payload.sql,
      parameters: r.payload.parameters,
      context: r.payload.context,
    }));
    const sql = [
      "-- Generated by DBMux",
      "-- Engine: " + a.config.engine,
      "-- Captures successful MCP operations; external changes and row-level diffs are not reconstructed.",
      ...statements.flatMap((s) => [
        "-- Audit " + s.auditId + " " + s.timestamp,
        "-- Parameters: " +
          JSON.stringify(s.parameters).replace(/[\r\n]/g, " "),
        String(s.sql).replace(/;\s*$/, "") + ";",
      ]),
    ].join("\n");
    return {
      sql,
      filename:
        new Date().toISOString().replace(/[:.]/g, "-") +
        "_" +
        id +
        "." +
        a.config.engine +
        ".sql",
      statements,
      replayWarning:
        "Parameterized statements require the accompanying bind values. Review against schema conventions before replay.",
    };
  }
  async close() {
    await this.transactions.close();
    await this.manager.close();
  }
}
