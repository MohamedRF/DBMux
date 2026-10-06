import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, connectionSchema } from "../src/database/adapter.js";
import { permissions } from "../src/security/permissions.js";
import { PostgresAdapter } from "../src/database/postgres/postgres.adapter.js";
test("normalization hides binary and retains big integers", () => {
  assert.deepEqual(
    normalize({ blob: Buffer.alloc(7), id: 999999999999999999n }),
    { blob: { binary: true, bytes: 7 }, id: "999999999999999999" },
  );
});
test("PostgreSQL transaction retains and releases the same acquired client", async () => {
  const c = connectionSchema.parse({
    id: "test",
    name: "test",
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "dev",
    username: "dev",
    password: "synthetic",
    permissions: permissions("full-development"),
    policy: { allowedSchemas: ["public"] },
  });
  const adapter = new PostgresAdapter(c);
  const queries: string[] = [];
  let released = 0;
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rowCount: 1 };
    },
    release: () => released++,
  };
  adapter.pool.connect = (async () =>
    client) as unknown as typeof adapter.pool.connect;
  const tx = await adapter.beginTransaction();
  await tx.execute("INSERT INTO public.t VALUES($1)", [1]);
  await tx.commit();
  assert.ok(queries[0] === "BEGIN");
  assert.ok(queries.some((s) => s.startsWith("INSERT")));
  assert.equal(queries.at(-1), "COMMIT");
  assert.equal(released, 1);
  await adapter.close();
});
