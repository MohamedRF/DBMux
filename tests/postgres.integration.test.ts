import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionSchema } from "../src/database/adapter.js";
import { PostgresAdapter } from "../src/database/postgres/postgres.adapter.js";
import { permissions } from "../src/security/permissions.js";
test(
  "live PostgreSQL adapter metadata, bounded rows, binds, rollback and read-only side effects",
  { skip: !process.env.TEST_PG_PASSWORD },
  async () => {
    const config = connectionSchema.parse({
      id: "integration",
      name: "Integration",
      engine: "postgres",
      host: "127.0.0.1",
      port: 55432,
      database: "dbmux_test",
      username: "dbmux_test",
      password: process.env.TEST_PG_PASSWORD,
      permissions: permissions("full-development"),
      policy: { allowedSchemas: ["public"] },
    });
    const db = new PostgresAdapter(config);
    try {
      await db.executeStatement(
        "CREATE TABLE IF NOT EXISTS public.dbmux_integration(id integer PRIMARY KEY,label text)",
      );
      await db.executeStatement("DELETE FROM public.dbmux_integration");
      await db.executeStatement(
        "INSERT INTO public.dbmux_integration SELECT g, 'row' FROM generate_series(1,12) g",
      );
      const result = await db.executeQuery(
        "SELECT id,label FROM public.dbmux_integration ORDER BY id",
        [],
        5,
      );
      assert.equal(result.rowCount, 5);
      assert.equal(result.truncated, true);
      const table = await db.describeTable("public", "dbmux_integration");
      assert.equal((table.columns as unknown[]).length, 2);
      const tx = await db.beginTransaction();
      await tx.execute("INSERT INTO public.dbmux_integration VALUES($1,$2)", [
        99,
        "rollback",
      ]);
      await tx.rollback();
      assert.equal(
        (
          await db.executeQuery(
            "SELECT id FROM public.dbmux_integration WHERE id=$1",
            [99],
          )
        ).rowCount,
        0,
      );
      await db.executeStatement(
        "CREATE OR REPLACE FUNCTION public.dbmux_write() RETURNS integer LANGUAGE plpgsql AS $$BEGIN INSERT INTO public.dbmux_integration VALUES(100,'bad'); RETURN 1; END$$",
      );
      await assert.rejects(db.executeQuery("SELECT public.dbmux_write()"));
    } finally {
      await db.executeStatement("DROP FUNCTION IF EXISTS public.dbmux_write()");
      await db.executeStatement(
        "DROP TABLE IF EXISTS public.dbmux_integration",
      );
      await db.close();
    }
  },
);
