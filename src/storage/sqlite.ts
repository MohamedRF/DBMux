import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import type { Vault } from "../security/encryption.js";

export class Store {
  readonly db: DatabaseSync;
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
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,timestamp TEXT NOT NULL,owner TEXT NOT NULL,connection_id TEXT NOT NULL,tool TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mcp_migrations(connection_id TEXT NOT NULL,name TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(connection_id,name));`);
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
  ): number {
    return Number(
      this.db
        .prepare(
          "INSERT INTO audit_log(timestamp,owner,connection_id,tool,status,payload) VALUES(?,?,?,?,?,?)",
        )
        .run(
          new Date().toISOString(),
          owner,
          connectionId,
          tool,
          "pending",
          this.vault.seal(payload),
        ).lastInsertRowid,
    );
  }
  finishAudit(id: number, status: string, payload: unknown) {
    this.db
      .prepare("UPDATE audit_log SET status=?,payload=? WHERE id=?")
      .run(status, this.vault.seal(payload), id);
  }
  history(connectionId: string, limit = 100, offset = 0) {
    return this.db
      .prepare(
        "SELECT id,timestamp,owner,connection_id,tool,status,payload FROM audit_log WHERE connection_id=? ORDER BY id LIMIT ? OFFSET ?",
      )
      .all(connectionId, limit, offset)
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
  close() {
    this.db.close();
  }
}
