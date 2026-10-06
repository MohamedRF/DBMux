import { randomUUID } from "node:crypto";
import type { DatabaseAdapter, CatalogKind } from "../database/adapter.js";
import type { Store } from "../storage/sqlite.js";
import { GatewayError } from "../security/errors.js";
export interface Snapshot {
  id: string;
  connectionId: string;
  schema: string;
  name: string;
  owner: string;
  timestamp: string;
  objects: Record<string, unknown>;
}
export function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const changes: Array<{
    object: string;
    change: "added" | "removed" | "changed";
    before?: unknown;
    after?: unknown;
  }> = [];
  for (const key of [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort()) {
    if (!(key in before))
      changes.push({ object: key, change: "added", after: after[key] });
    else if (!(key in after))
      changes.push({ object: key, change: "removed", before: before[key] });
    else if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      changes.push({
        object: key,
        change: "changed",
        before: before[key],
        after: after[key],
      });
  }
  return {
    changes,
    summary:
      changes.map((c) => `${c.change}: ${c.object}`).join("\n") ||
      "No schema changes detected.",
  };
}
export class Snapshots {
  constructor(private readonly store: Store) {}
  async capture(
    adapter: DatabaseAdapter,
    connectionId: string,
    schema: string,
    name: string,
    owner: string,
  ) {
    const objects: Record<string, unknown> = {};
    let count = 0;
    const kinds: CatalogKind[] = [
      "tables",
      "columns",
      "constraintColumns",
      "indexColumns",
      "materializedViews",
      "views",
      "indexes",
      "constraints",
      "sequences",
      "triggers",
      "routines",
      "source",
      "enums",
      "extensions",
      "synonyms",
    ];
    for (const kind of kinds) {
      let offset = 0;
      for (;;) {
        const result = await adapter.catalog(kind, {
          schema,
          limit: 1000,
          offset,
        });
        for (const row of result.rows) {
          if (++count > 50000)
            throw new GatewayError(
              "SNAPSHOT_LIMIT",
              "Schema exceeds snapshot object limit; use a smaller schema.",
            );
          const key = [
            kind,
            row.schema,
            row.name,
            row.identity ?? row.kind ?? "",
            row.line ?? row.ordinal ?? row.column_name ?? row.position ?? "",
          ].join("/");
          objects[key] = row;
          if (JSON.stringify(row).includes('"truncated":true'))
            throw new GatewayError(
              "SNAPSHOT_INCOMPLETE",
              "A catalog definition exceeds the capture size limit; narrow the schema or inspect its source separately.",
            );
        }
        if (!result.truncated) break;
        offset += 1000;
      }
    }
    const snapshot: Snapshot = {
      id: randomUUID(),
      connectionId,
      schema,
      name,
      owner,
      timestamp: new Date().toISOString(),
      objects,
    };
    this.store.put("snapshot", snapshot.id, {
      id: snapshot.id,
      connectionId,
      sealed: this.store.vault.seal(snapshot),
    });
    return {
      snapshotId: snapshot.id,
      timestamp: snapshot.timestamp,
      objectCount: Object.keys(objects).length,
      consistency:
        "Catalog reads are not atomic across concurrent external DDL; capture during a quiet development interval.",
    };
  }
  get(id: string, connectionId: string) {
    const row = this.store.get<{ connectionId: string; sealed: string }>(
      "snapshot",
      id,
    );
    if (!row || row.connectionId !== connectionId)
      throw new GatewayError(
        "SNAPSHOT_UNAVAILABLE",
        "Snapshot unavailable.",
        404,
      );
    return this.store.vault.open<Snapshot>(row.sealed);
  }
  compare(beforeId: string, afterId: string, connectionId: string) {
    const before = this.get(beforeId, connectionId);
    const after = this.get(afterId, connectionId);
    if (before.schema !== after.schema)
      throw new GatewayError(
        "SNAPSHOT_SCOPE",
        "Snapshots must refer to the same schema.",
      );
    return {
      ...diffObjects(before.objects, after.objects),
      before: before.timestamp,
      after: after.timestamp,
    };
  }
}
