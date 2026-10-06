import pg from "pg";
import type { PoolClient } from "pg";
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
import { postgresCatalog } from "./postgres.metadata.js";
import { safeError } from "../../security/errors.js";
import { classify } from "../../security/sql-policy.js";

export class PostgresAdapter implements DatabaseAdapter {
  readonly engine = "postgres" as const;
  readonly pool: pg.Pool;
  private idleFailureCode?: string;
  constructor(
    private readonly config: ConnectionConfig,
    private readonly querySeconds = 30,
    private readonly ddlSeconds = 60,
  ) {
    this.pool = new pg.Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      max: config.poolMax,
      idleTimeoutMillis: config.poolTimeout * 1000,
      connectionTimeoutMillis: config.connectionTimeout * 1000,
      ssl: config.ssl ? { rejectUnauthorized: true, ca: config.sslCa } : false,
    });
    this.pool.on("error", (error) => {
      this.idleFailureCode = safeError(error).code;
    });
  }
  quote = quoteIdentifier;
  private values(binds: Binds): unknown[] {
    if (!Array.isArray(binds) && Object.keys(binds).length)
      throw new Error("PostgreSQL requires positional parameter arrays");
    return Array.isArray(binds) ? binds : [];
  }
  private async initialize(client: PoolClient, readOnly: boolean) {
    await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
    await client.query(
      "SELECT set_config('statement_timeout',$1,true),set_config('search_path',$2,true)",
      [
        String(this.querySeconds * 1000),
        this.config.policy.allowedSchemas.map(quoteIdentifier).join(","),
      ],
    );
  }
  private async query(
    client: PoolClient,
    sql: string,
    binds: Binds,
    limit: number,
  ): Promise<QueryResult> {
    const started = performance.now();
    // A server-side cursor bounds transferred rows even when the caller's SELECT has no LIMIT.
    await client.query(
      "DECLARE dbmux_cursor NO SCROLL CURSOR FOR " + sql,
      this.values(binds),
    );
    try {
      const result = await client.query(
        `FETCH FORWARD ${limit + 1} FROM dbmux_cursor`,
      );
      const rows = result.rows
        .slice(0, limit)
        .map((row) => normalize(row) as Record<string, unknown>);
      return {
        columns: result.fields.map((f) => ({
          name: f.name,
          type: String(f.dataTypeID),
        })),
        rows,
        rowCount: rows.length,
        executionMs: performance.now() - started,
        truncated: result.rows.length > limit,
      };
    } finally {
      await client.query("CLOSE dbmux_cursor");
    }
  }
  private async statement(
    client: PoolClient,
    sql: string,
    binds: Binds,
  ): Promise<StatementResult> {
    const start = performance.now();
    await client.query("SELECT set_config('statement_timeout',$1,true)", [
      String(
        (classify(sql).category.startsWith("DDL")
          ? this.ddlSeconds
          : this.querySeconds) * 1000,
      ),
    ]);
    const r = await client.query(sql, this.values(binds));
    return {
      rowsAffected: r.rowCount ?? 0,
      executionMs: performance.now() - start,
      implicitCommit: false,
    };
  }
  async executeQuery(sql: string, binds: Binds = [], limit = 100) {
    const client = await this.pool.connect();
    try {
      await this.initialize(client, true);
      const result = await this.query(
        client,
        sql.replace(/;\s*$/, ""),
        binds,
        limit,
      );
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        throw new AggregateError(
          [e, rollbackError],
          "Database operation and rollback failed",
          { cause: e },
        );
      });
      throw e;
    } finally {
      client.release();
    }
  }
  async executeStatement(sql: string, binds: Binds = []) {
    const tx = await this.beginTransaction();
    try {
      const result = await tx.execute(sql, binds);
      await tx.commit();
      return result;
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }
  async beginTransaction(): Promise<TransactionHandle> {
    const client = await this.pool.connect();
    try {
      await this.initialize(client, false);
    } catch (e) {
      client.release(true);
      throw e;
    }
    let done = false;
    const finish = async (sql: string) => {
      if (done) return;
      done = true;
      try {
        await client.query(sql);
      } finally {
        client.release();
      }
    };
    return {
      query: (s, b, l) => this.query(client, s.replace(/;\s*$/, ""), b, l),
      execute: (s, b) => this.statement(client, s, b),
      commit: () => finish("COMMIT"),
      rollback: () => finish("ROLLBACK"),
    };
  }
  async catalog(kind: CatalogKind, filter: CatalogFilter) {
    const values: unknown[] = [];
    const conditions: string[] = [];
    const bind = (value: unknown) => {
      values.push(value);
      return "$" + values.length;
    };
    if (filter.schema) conditions.push(`schema=${bind(filter.schema)}`);
    else
      conditions.push(
        `schema=ANY(${bind(this.config.policy.allowedSchemas)}::text[])`,
      );
    if (filter.table)
      conditions.push(
        `${["columns", "tables", "views", "dependencies"].includes(kind) ? "name" : "table_name"}=${bind(filter.table)}`,
      );
    if (filter.name) conditions.push(`name=${bind(filter.name)}`);
    if (filter.query)
      conditions.push(
        `CAST(row_to_json(catalog) AS text) ILIKE ${bind("%" + filter.query + "%")}`,
      );
    const sql = `SELECT row_to_json(catalog) AS entry FROM (${postgresCatalog[kind]}) catalog ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY CAST(row_to_json(catalog) AS text) OFFSET ${filter.offset ?? 0}`;
    const r = await this.executeQuery(
      sql,
      values as Binds,
      filter.limit ?? 100,
    );
    return {
      ...r,
      rows: r.rows.map((row) => row.entry as Record<string, unknown>),
    };
  }
  async describeTable(schema: string, table: string) {
    const [columns, constraints, indexes] = await Promise.all([
      this.catalog("columns", { schema, table, limit: 1000 }),
      this.catalog("constraints", { schema, table, limit: 1000 }),
      this.catalog("indexes", { schema, table, limit: 1000 }),
    ]);
    return {
      schema,
      table,
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
      truncated:
        columns.truncated || constraints.truncated || indexes.truncated,
    };
  }
  async getServerInfo() {
    const r = await this.executeQuery(
      "SELECT version() AS version,current_database() AS database,current_user AS username,current_schema() AS schema",
      [],
      1,
    );
    return r.rows[0] ?? {};
  }
  async testConnection() {
    const start = performance.now();
    return {
      ...(await this.getServerInfo()),
      latencyMs: performance.now() - start,
      connected: true,
      recoveredFromIdleError: this.idleFailureCode,
    };
  }
  async explain(sql: string, binds: Binds) {
    const client = await this.pool.connect();
    try {
      await this.initialize(client, true);
      const start = performance.now();
      const r = await client.query(
        "EXPLAIN (FORMAT JSON) " + sql,
        this.values(binds),
      );
      await client.query("ROLLBACK");
      return {
        columns: r.fields.map((f) => ({ name: f.name })),
        rows: r.rows,
        rowCount: r.rows.length,
        executionMs: performance.now() - start,
        truncated: false,
      };
    } catch (e) {
      await client.query("ROLLBACK").catch((rollbackError) => {
        throw new AggregateError(
          [e, rollbackError],
          "Database operation and rollback failed",
          { cause: e },
        );
      });
      throw e;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
