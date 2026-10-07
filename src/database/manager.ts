import type { Store } from "../storage/sqlite.js";
import {
  connectionSchema,
  type ConnectionConfig,
  type DatabaseAdapter,
} from "./adapter.js";
import { OracleAdapter } from "./oracle/oracle.adapter.js";
import { PostgresAdapter } from "./postgres/postgres.adapter.js";
import { GatewayError } from "../security/errors.js";
import type { Config } from "../config/index.js";

export interface SavedConnection {
  id: string;
  name: string;
  engine: "oracle" | "postgres";
  enabled: boolean;
  permissions: ConnectionConfig["permissions"];
  policy: ConnectionConfig["policy"];
  sealed: string;
}
export class ConnectionManager {
  private readonly adapters = new Map<string, DatabaseAdapter>();
  constructor(
    readonly store: Store,
    private readonly config: Pick<
      Config,
      "QUERY_TIMEOUT_SECONDS" | "DDL_TIMEOUT_SECONDS"
    >,
  ) {}
  list() {
    return this.store
      .list<SavedConnection>("connection")
      .map(({ sealed, ...safe }) => {
        const c = this.store.vault.open<ConnectionConfig>(sealed);
        return {
          ...safe,
          host: c.host,
          port: c.port,
          database: c.database,
          username: c.username,
          poolMin: c.poolMin,
          poolMax: c.poolMax,
          ssl: c.ssl,
          sid: c.sid,
        };
      });
  }
  configFor(id: string): ConnectionConfig {
    const saved = this.store.get<SavedConnection>("connection", id);
    if (!saved)
      throw new GatewayError(
        "CONNECTION_NOT_FOUND",
        "Connection is unavailable.",
        404,
      );
    return this.store.vault.open<ConnectionConfig>(saved.sealed);
  }
  async save(input: unknown) {
    const c = connectionSchema.parse(input);
    if (
      c.policy.allowedSchemas.some((s) =>
        [
          "SYS",
          "SYSTEM",
          "XDB",
          "MDSYS",
          "CTXSYS",
          "ORDSYS",
          "PG_CATALOG",
          "INFORMATION_SCHEMA",
          ...c.policy.protectedSchemas.map((x) => x.toUpperCase()),
        ].includes(s.toUpperCase()),
      )
    )
      throw new GatewayError(
        "PROTECTED_SCHEMA",
        "Protected schemas cannot be configured as application schemas.",
      );

    await this.evict(c.id);
    this.store.remove("connection-health", c.id);
    this.store.put("connection", c.id, {
      id: c.id,
      name: c.name,
      engine: c.engine,
      enabled: c.enabled,
      permissions: c.permissions,
      policy: c.policy,
      sealed: this.store.vault.seal(c),
    } satisfies SavedConnection);
    return this.list().find((x) => x.id === c.id)!;
  }
  adapter(id: string) {
    const cached = this.adapters.get(id);
    if (cached) return cached;
    const c = this.configFor(id);
    const adapter =
      c.engine === "oracle"
        ? new OracleAdapter(
            c,
            this.config.QUERY_TIMEOUT_SECONDS,
            this.config.DDL_TIMEOUT_SECONDS,
          )
        : new PostgresAdapter(
            c,
            this.config.QUERY_TIMEOUT_SECONDS,
            this.config.DDL_TIMEOUT_SECONDS,
          );
    this.adapters.set(id, adapter);
    return adapter;
  }
  async evict(id: string) {
    const a = this.adapters.get(id);
    if (a) {
      await a.close();
      this.adapters.delete(id);
    }
  }
  async remove(id: string) {
    await this.evict(id);
    this.store.remove("connection", id);
    this.store.remove("connection-health", id);
  }
  async close() {
    await Promise.all([...this.adapters.values()].map((a) => a.close()));
    this.adapters.clear();
  }
}
