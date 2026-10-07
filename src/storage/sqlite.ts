import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import type { Vault } from "../security/encryption.js";

export interface ActivityQuery {
  kind?: string;
  status?: string;
  actor?: string;
  actorId?: string;
  connectionId?: string;
  operation?: string;
  q?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
  beforeId?: number;
  snapshotId?: number;
  count?: boolean;
}

export class Store {
  readonly db: DatabaseSync;
  private closed = false;
  constructor(
    directory: string,
    readonly vault: Vault,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, "dbmux.sqlite");
    this.db = new DatabaseSync(file);
    if (process.platform !== "win32") chmodSync(file, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS activity_log(id INTEGER PRIMARY KEY AUTOINCREMENT,timestamp TEXT NOT NULL,kind TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,operation TEXT NOT NULL,source TEXT NOT NULL,request_id TEXT NOT NULL,status TEXT NOT NULL,duration_ms INTEGER NOT NULL DEFAULT 0,http_status INTEGER,error_code TEXT);
      CREATE INDEX IF NOT EXISTS activity_time ON activity_log(timestamp,id);
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,timestamp TEXT NOT NULL,owner TEXT NOT NULL,connection_id TEXT NOT NULL,tool TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_migrations(connection_id TEXT NOT NULL,name TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(connection_id,name));`);
    // Add nullable correlation fields without rewriting or discarding old audits.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [table, column, definition] of [
        ["activity_log", "connection_id", "TEXT"],
        ["audit_log", "request_id", "TEXT"],
        ["audit_log", "activity_id", "INTEGER"],
      ] as const) {
        const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
        if (!columns.some((row) => row.name === column))
          this.db.exec(
            `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
          );
      }
      this.db
        .exec(`CREATE INDEX IF NOT EXISTS activity_request ON activity_log(request_id,id);
        CREATE INDEX IF NOT EXISTS activity_actor ON activity_log(actor_id,id);
        CREATE INDEX IF NOT EXISTS activity_connection ON activity_log(connection_id,id);
        CREATE INDEX IF NOT EXISTS activity_operation ON activity_log(operation,id);
        CREATE INDEX IF NOT EXISTS audit_request ON audit_log(request_id,id); COMMIT`);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT payload FROM records WHERE kind=? AND id=?")
      .get(kind, id);
    return row ? (JSON.parse(String(row.payload)) as T) : undefined;
  }
  list<T>(kind: string): T[] {
    return this.db
      .prepare("SELECT payload FROM records WHERE kind=? ORDER BY id")
      .all(kind)
      .map((row) => JSON.parse(String(row.payload)) as T);
  }
  listEntries<T>(kind: string) {
    return this.db
      .prepare("SELECT id,payload FROM records WHERE kind=? ORDER BY id")
      .all(kind)
      .map((row) => ({
        id: String(row.id),
        value: JSON.parse(String(row.payload)) as T,
      }));
  }
  put(kind: string, id: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload",
      )
      .run(kind, id, JSON.stringify(value));
  }
  remove(kind: string, id: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  consume<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare("DELETE FROM records WHERE kind=? AND id=? RETURNING payload")
      .get(kind, id);
    return row ? (JSON.parse(String(row.payload)) as T) : undefined;
  }
  audit(
    owner: string,
    connectionId: string,
    tool: string,
    payload: unknown,
    correlation?: { requestId: string; toolActivityId?: number },
  ): number {
    return Number(
      this.db
        .prepare(
          "INSERT INTO audit_log(timestamp,owner,connection_id,tool,status,payload,request_id,activity_id) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          new Date().toISOString(),
          owner,
          connectionId,
          tool,
          "pending",
          this.vault.seal(payload),
          correlation?.requestId ?? null,
          correlation?.toolActivityId ?? null,
        ).lastInsertRowid,
    );
  }
  finishAudit(id: number, status: string, payload: unknown) {
    this.db
      .prepare("UPDATE audit_log SET status=?,payload=? WHERE id=?")
      .run(status, this.vault.seal(payload), id);
  }
  history(
    connectionId: string,
    limit = 100,
    offset = 0,
    snapshotId = Number.MAX_SAFE_INTEGER,
  ) {
    return this.db
      .prepare(
        "SELECT id,timestamp,owner,connection_id,tool,status,payload FROM audit_log WHERE connection_id=? AND id<=? ORDER BY id LIMIT ? OFFSET ?",
      )
      .all(connectionId, snapshotId, limit, offset)
      .map((row) => ({
        id: Number(row.id),
        timestamp: String(row.timestamp),
        owner: String(row.owner),
        connection_id: String(row.connection_id),
        tool: String(row.tool),
        status: String(row.status),
        payload: this.vault.open<Record<string, unknown>>(String(row.payload)),
      }));
  }
  startActivity(event: {
    kind: string;
    actorId: string;
    actorName: string;
    operation: string;
    source: string;
    requestId: string;
  }) {
    return Number(
      this.db
        .prepare(
          "INSERT INTO activity_log(timestamp,kind,actor_id,actor_name,operation,source,request_id,status) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          new Date().toISOString(),
          event.kind,
          event.actorId,
          event.actorName,
          event.operation,
          event.source,
          event.requestId,
          "pending",
        ).lastInsertRowid,
    );
  }
  identifyActivity(id: number, actorId: string, actorName: string) {
    this.db
      .prepare("UPDATE activity_log SET actor_id=?,actor_name=? WHERE id=?")
      .run(actorId, actorName, id);
  }
  attachActivityConnection(id: number, connectionId: string) {
    this.db
      .prepare(
        "UPDATE activity_log SET connection_id=? WHERE id=? AND connection_id IS NULL",
      )
      .run(connectionId, id);
  }
  finishActivity(
    id: number,
    status: string,
    duration: number,
    httpStatus?: number,
    errorCode?: string,
  ) {
    // Response close events may arrive after graceful storage shutdown.
    if (this.closed) return;
    this.db
      .prepare(
        "UPDATE activity_log SET status=?,duration_ms=?,http_status=?,error_code=? WHERE id=?",
      )
      .run(status, duration, httpStatus ?? null, errorCode ?? null, id);
  }
  activity(query: ActivityQuery) {
    const predicates: string[] = [];
    const values: string[] = [];
    for (const [column, value, operator] of [
      ["kind", query.kind, "="],
      ["status", query.status, "="],
      ["actor_name", query.actor, "="],
      ["actor_id", query.actorId, "="],
      ["connection_id", query.connectionId, "="],
      ["operation", query.operation, "="],
      ["timestamp", query.from, ">="],
      ["timestamp", query.to, "<="],
    ]) {
      if (value) {
        predicates.push(`${column} ${operator} ?`);
        values.push(value);
      }
    }
    if (query.q) {
      predicates.push(
        "(actor_name LIKE ? ESCAPE '\\' OR actor_id LIKE ? ESCAPE '\\' OR operation LIKE ? ESCAPE '\\' OR connection_id LIKE ? ESCAPE '\\' OR request_id LIKE ? ESCAPE '\\')",
      );
      const pattern =
        "%" + query.q.replace(/[\\%_]/g, (value) => "\\" + value) + "%";
      values.push(pattern, pattern, pattern, pattern, pattern);
    }
    if (query.beforeId !== undefined) {
      predicates.push("id < ?");
      values.push(String(query.beforeId));
    }
    if (query.snapshotId !== undefined) {
      predicates.push("id <= ?");
      values.push(String(query.snapshotId));
    }
    const where = predicates.length ? " WHERE " + predicates.join(" AND ") : "";
    const total =
      query.count === false
        ? 0
        : Number(
            this.db
              .prepare("SELECT COUNT(*) AS total FROM activity_log" + where)
              .get(...values)?.total,
          );
    const rows = this.db
      .prepare(
        "SELECT id,timestamp,kind,actor_id,actor_name,operation,source,request_id,status,duration_ms,http_status,error_code,connection_id FROM activity_log" +
          where +
          " ORDER BY id DESC LIMIT ? OFFSET ?",
      )
      .all(...values, query.limit, query.offset);
    return { rows, total, limit: query.limit, offset: query.offset };
  }
  requestTimeline(
    requestId: string,
    limit: number,
    offset: number,
    auditOffset: number,
  ) {
    const total = Number(
      this.db
        .prepare(
          "SELECT COUNT(*) AS total FROM activity_log WHERE request_id=?",
        )
        .get(requestId)?.total,
    );
    const auditTotal = Number(
      this.db
        .prepare("SELECT COUNT(*) AS total FROM audit_log WHERE request_id=?")
        .get(requestId)?.total,
    );
    const rows = this.db
      .prepare(
        "SELECT id,timestamp,kind,actor_id,actor_name,operation,source,request_id,status,duration_ms,http_status,error_code,connection_id FROM activity_log WHERE request_id=? ORDER BY id LIMIT ? OFFSET ?",
      )
      .all(requestId, limit, offset);
    // The timeline lists audit metadata; SQL and binds require opening the audit.
    const audits = this.db
      .prepare(
        "SELECT id,timestamp,owner,connection_id,tool,status,request_id,activity_id FROM audit_log WHERE request_id=? ORDER BY id LIMIT ? OFFSET ?",
      )
      .all(requestId, limit, auditOffset);
    return {
      requestId,
      rows,
      audits,
      total,
      auditTotal,
      limit,
      offset,
      auditOffset,
    };
  }
  auditDetail(id: number) {
    const row = this.db
      .prepare(
        "SELECT id,timestamp,owner,connection_id,tool,status,payload,request_id,activity_id FROM audit_log WHERE id=?",
      )
      .get(id);
    if (!row) return undefined;
    return {
      id: Number(row.id),
      timestamp: String(row.timestamp),
      owner: String(row.owner),
      connection_id: String(row.connection_id),
      tool: String(row.tool),
      status: String(row.status),
      request_id: row.request_id === null ? null : String(row.request_id),
      activity_id: row.activity_id === null ? null : Number(row.activity_id),
      payload: this.vault.open<Record<string, unknown>>(String(row.payload)),
    };
  }
  dashboardActivity(
    from: string,
    weekFrom: string,
    timezoneOffset: number,
    slowMs: number,
    snapshotId: number,
  ) {
    const metrics = this.db
      .prepare(
        `SELECT
      COALESCE(SUM(CASE WHEN kind IN ('api','mcp') THEN 1 ELSE 0 END),0) AS requests,
      COALESCE(SUM(CASE WHEN kind IN ('api','mcp') AND status='error' THEN 1 ELSE 0 END),0) AS failedRequests,
      COALESCE(SUM(CASE WHEN kind='tool' THEN 1 ELSE 0 END),0) AS toolCalls,
      COALESCE(SUM(CASE WHEN kind='tool' AND status='error' THEN 1 ELSE 0 END),0) AS failedTools,
      COALESCE(SUM(CASE WHEN kind='tool' AND status IN ('success','error') AND duration_ms>=? THEN 1 ELSE 0 END),0) AS slowTools
      FROM activity_log WHERE timestamp>=? AND id<=?`,
      )
      .get(slowMs, from, snapshotId);
    const daily = this.db
      .prepare(
        `SELECT strftime('%Y-%m-%d',timestamp,?) AS date,
      SUM(CASE WHEN kind IN ('api','mcp') THEN 1 ELSE 0 END) AS requests,
      SUM(CASE WHEN kind='tool' THEN 1 ELSE 0 END) AS tools,
      SUM(CASE WHEN kind='tool' AND status='error' THEN 1 ELSE 0 END) AS failedTools
      FROM activity_log WHERE timestamp>=? AND id<=? GROUP BY date ORDER BY date`,
      )
      .all(`${timezoneOffset} minutes`, weekFrom, snapshotId);
    const slow = this.db
      .prepare(
        "SELECT id,timestamp,actor_name,actor_id,connection_id,operation,duration_ms,status,request_id FROM activity_log WHERE kind='tool' AND status IN ('success','error') AND duration_ms>=? AND timestamp>=? AND id<=? ORDER BY duration_ms DESC,id DESC LIMIT 10",
      )
      .all(slowMs, from, snapshotId);
    return { metrics, daily, slow };
  }
  close() {
    this.db
      .prepare(
        "UPDATE activity_log SET status='aborted' WHERE status='pending'",
      )
      .run();
    this.closed = true;
    this.db.close();
  }
}
