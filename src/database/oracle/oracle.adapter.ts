import oracledb from "oracledb";
import type {
  DatabaseAdapter,
  ConnectionConfig,
  Binds,
  QueryResult,
  StatementResult,
  TransactionHandle,
  CatalogKind,
  CatalogFilter,
} from "../adapter.js";
import { normalize, quoteIdentifier } from "../adapter.js";
import { oracleCatalog } from "./oracle.metadata.js";
import { classify } from "../../security/sql-policy.js";

export class OracleAdapter implements DatabaseAdapter {
  readonly engine = "oracle" as const;
  private pool?: oracledb.Pool;
  private opening?: Promise<oracledb.Pool>;
  constructor(
    private readonly config: ConnectionConfig,
    private readonly querySeconds = 30,
    private readonly ddlSeconds = 60,
  ) {}
  quote = quoteIdentifier;
  private async getPool() {
    if (this.pool) return this.pool;
    if (!this.opening) {
      const c = this.config;
      const connectString =
        c.connectString ??
        (c.sid
          ? `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${c.host})(PORT=${c.port}))(CONNECT_DATA=(SID=${c.database})))`
          : `${c.host}:${c.port}/${c.database}`);
      this.opening = oracledb
        .createPool({
          user: c.username,
          password: c.password,
          connectString,
          poolMin: c.poolMin,
          poolMax: c.poolMax,
          poolIncrement: c.poolIncrement,
          poolTimeout: c.poolTimeout,
          queueTimeout: c.connectionTimeout * 1000,
          connectTimeout: c.connectionTimeout,
        })
        .then((pool) => {
          this.pool = pool;
          return pool;
        })
        .finally(() => {
          this.opening = undefined;
        });
    }
    return this.opening;
  }
  private async acquire() {
    const c = await (await this.getPool()).getConnection();
    c.callTimeout = this.querySeconds * 1000;
    try {
      await c.execute(
        `ALTER SESSION SET CURRENT_SCHEMA=${quoteIdentifier(this.config.policy.allowedSchemas[0]!)}`,
      );
      return c;
    } catch (e) {
      await c.close();
      throw e;
    }
  }
  private async query(
    client: oracledb.Connection,
    sql: string,
    binds: Binds,
    limit: number,
  ): Promise<QueryResult> {
    const start = performance.now();
    client.callTimeout = this.querySeconds * 1000;
    const r = await client.execute<Record<string, unknown>>(
      sql.replace(/;\s*$/, ""),
      binds as oracledb.BindParameters,
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        resultSet: true,
        fetchTypeHandler: (meta) =>
          meta.dbType === oracledb.DB_TYPE_NUMBER
            ? { type: oracledb.STRING }
            : undefined,
      },
    );
    const rs = r.resultSet;
    try {
      const raw = rs ? await rs.getRows(limit + 1) : [];
      const rows = [];
      for (const row of raw) {
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          if (
            v &&
            typeof v === "object" &&
            "close" in v &&
            typeof v.close === "function"
          ) {
            safe[k] = { binary: true, type: "LOB" };
            await v.close();
          } else safe[k] = normalize(v);
        }
        if (rows.length < limit) rows.push(safe);
      }
      return {
        columns: (r.metaData ?? []).map((m) => ({
          name: m.name,
          type: String(m.dbTypeName),
        })),
        rows,
        rowCount: rows.length,
        executionMs: performance.now() - start,
        truncated: raw.length > limit,
      };
    } finally {
      await rs?.close();
    }
  }
  private async statement(
    client: oracledb.Connection,
    sql: string,
    binds: Binds,
  ) {
    const start = performance.now();
    const ddl =
      classify(sql, "oracle").category.startsWith("DDL") ||
      classify(sql, "oracle").category === "TRUNCATE";
    client.callTimeout = (ddl ? this.ddlSeconds : this.querySeconds) * 1000;
    const r = await client.execute(
      ["PROCEDURE", "FUNCTION", "TRIGGER", "PACKAGE"].includes(
        classify(sql, "oracle").objectType ?? "",
      )
        ? sql
        : sql.replace(/;\s*$/, ""),
      binds as oracledb.BindParameters,
      { autoCommit: false },
    );
    return {
      rowsAffected: r.rowsAffected ?? 0,
      executionMs: performance.now() - start,
      implicitCommit: ddl,
    };
  }
  async executeQuery(sql: string, binds: Binds = {}, limit = 100) {
    const client = await this.acquire();
    try {
      return await this.query(client, sql, binds, limit);
    } finally {
      await client.close();
    }
  }
  async executeStatement(
    sql: string,
    binds: Binds = {},
  ): Promise<StatementResult> {
    const client = await this.acquire();
    try {
      const r = await this.statement(client, sql, binds);
      if (!r.implicitCommit) await client.commit();
      return r;
    } catch (e) {
      await client.rollback();
      throw e;
    } finally {
      await client.close();
    }
  }
  async beginTransaction(): Promise<TransactionHandle> {
    const client = await this.acquire();
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      done = true;
      try {
        if (commit) await client.commit();
        else await client.rollback();
      } finally {
        await client.close();
      }
    };
    return {
      query: (s, b, l) => this.query(client, s, b, l),
      execute: (s, b) => this.statement(client, s, b),
      commit: () => finish(true),
      rollback: () => finish(false),
    };
  }
  async catalog(kind: CatalogKind, filter: CatalogFilter) {
    const binds: Record<string, string | number | boolean | null> = {};
    const conditions: string[] = [];
    const schemas = filter.schema
      ? [filter.schema]
      : this.config.policy.allowedSchemas;
    conditions.push(
      `"schema" IN (${schemas
        .map((s, i) => {
          binds["s" + i] = s;
          return ":s" + i;
        })
        .join(",")})`,
    );
    if (filter.table) {
      binds.table = filter.table;
      conditions.push(
        `"${["columns", "tables", "views", "dependencies"].includes(kind) ? "name" : "table_name"}"=:table`,
      );
    }
    if (filter.name) {
      binds.name = filter.name;
      conditions.push('"name"=:name');
    }
    if (filter.query) {
      binds.query = "%" + filter.query.toUpperCase() + "%";
      conditions.push(
        kind === "source"
          ? 'UPPER("definition") LIKE :query'
          : 'UPPER("name") LIKE :query',
      );
    }
    // LONG dictionary fields cannot be sorted/grouped. Stable identity order is sufficient.
    const order =
      kind === "schemas"
        ? '"schema"'
        : kind === "source"
          ? '"schema","name","kind","line"'
          : kind === "columns"
            ? '"schema","name","ordinal_position"'
            : '"schema","name"';
    const r = await this.executeQuery(
      `SELECT ${[...new Set([...oracleCatalog[kind].matchAll(/AS "([^"]+)"/g)].map((m) => 'catalog."' + m[1] + '"'))].join(",")} FROM (${oracleCatalog[kind]}) catalog WHERE ${conditions.join(" AND ")} ORDER BY ${order} OFFSET ${filter.offset ?? 0} ROWS`,
      binds,
      filter.limit ?? 100,
    );
    return r;
  }
  async describeTable(schema: string, table: string) {
    const [columns, constraints, indexes] = await Promise.all([
      this.catalog("columns", { schema, table, limit: 1000 }),
      this.catalog("constraints", { schema, table, limit: 1000 }),
      this.catalog("indexes", { schema, table, limit: 1000 }),
    ]);
    const constraintColumns = await this.executeQuery(
      'SELECT constraint_name AS "name",column_name AS "column_name",position AS "position" FROM all_cons_columns WHERE owner=:schema AND table_name=:table ORDER BY constraint_name,position',
      { schema, table },
      1000,
    );
    const indexColumns = await this.executeQuery(
      'SELECT index_name AS "name",column_name AS "column_name",column_position AS "position",descend AS "direction" FROM all_ind_columns WHERE table_owner=:schema AND table_name=:table ORDER BY index_name,column_position',
      { schema, table },
      1000,
    );
    return {
      schema,
      table,
      columns: columns.rows,
      constraints: constraints.rows.map((row) => ({
        ...row,
        columns: constraintColumns.rows.filter((c) => c.name === row.name),
      })),
      indexes: indexes.rows.map((row) => ({
        ...row,
        columns: indexColumns.rows.filter((c) => c.name === row.name),
      })),
      truncated:
        columns.truncated ||
        constraints.truncated ||
        indexes.truncated ||
        constraintColumns.truncated ||
        indexColumns.truncated,
    };
  }
  async getServerInfo() {
    const client = await this.acquire();
    try {
      const identity = await this.query(
        client,
        "SELECT SYS_CONTEXT('USERENV','DB_NAME') AS \"database\",SYS_CONTEXT('USERENV','SESSION_USER') AS \"username\",SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS \"schema\" FROM dual",
        {},
        1,
      );
      return { version: client.oracleServerVersionString, ...identity.rows[0] };
    } finally {
      await client.close();
    }
  }
  async testConnection() {
    const start = performance.now();
    return {
      ...(await this.getServerInfo()),
      latencyMs: performance.now() - start,
      connected: true,
    };
  }
  async explain(sql: string, binds: Binds) {
    const client = await this.acquire();
    const id = "DBMUX_" + Date.now().toString(36);
    try {
      await client.execute(
        `EXPLAIN PLAN SET STATEMENT_ID='${id}' FOR ${sql.replace(/;\s*$/, "")}`,
        binds as oracledb.BindParameters,
      );
      return await this.query(
        client,
        "SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE',:id,'BASIC'))",
        { id },
        1000,
      );
    } finally {
      await client.rollback();
      await client.close();
    }
  }
  async close() {
    if (this.opening) await this.opening;
    if (this.pool) {
      await this.pool.close(10);
      this.pool = undefined;
    }
  }
}
