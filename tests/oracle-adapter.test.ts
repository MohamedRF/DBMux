import { test } from "node:test";
import assert from "node:assert/strict";
import { OracleAdapter } from "../src/database/oracle/oracle.adapter.js";
import { connectionSchema, type Binds } from "../src/database/adapter.js";
import { permissions } from "../src/security/permissions.js";

const config = connectionSchema.parse({
  id: "oracle",
  name: "Oracle",
  engine: "oracle",
  host: "localhost",
  port: 1521,
  database: "ORCL",
  username: "dev",
  password: "synthetic-password",
  enabled: true,
  permissions: permissions("full-development"),
  policy: { allowedSchemas: ["APP"] },
});

class CapturingOracleAdapter extends OracleAdapter {
  readonly captured: Array<{
    sql: string;
    binds: Record<string, string | number | boolean | null>;
    limit: number;
  }> = [];
  override async executeQuery(sql: string, binds: Binds = {}, limit = 100) {
    this.captured.push({
      sql,
      binds: binds as Record<string, string | number | boolean | null>,
      limit,
    });
    return {
      columns: [{ name: "entry" }],
      rows: [{ entry: { schema: "APP" } }],
      rowCount: 1,
      executionMs: 1,
      truncated: false,
    };
  }
}

test("catalog queries bind predicates and clamp offset/limit", async () => {
  const adapter = new CapturingOracleAdapter(config, 30, 60);
  await adapter.catalog("tables", {
    schema: "APP",
    table: "T",
    offset: -5,
    limit: 99999,
  });
  const call = adapter.captured.at(-1)!;
  assert.match(call.sql, /"schema" IN \(:s0\)/);
  assert.match(call.sql, /"name"=:table/);
  assert.match(call.sql, /OFFSET 0 ROWS/);
  assert.equal(call.binds.s0, "APP");
  assert.equal(call.binds.table, "T");
  assert.equal(call.limit, 1000);
});

test("catalog name search binds the uppercased pattern", async () => {
  const adapter = new CapturingOracleAdapter(config, 30, 60);
  await adapter.catalog("tables", { query: "foo", offset: 2.9 });
  const call = adapter.captured.at(-1)!;
  assert.match(call.sql, /UPPER\("name"\) LIKE :query/);
  assert.match(call.sql, /OFFSET 2 ROWS/);
  assert.equal(call.binds.query, "%FOO%");
});

test("catalog without schema falls back to allowed schemas with named binds", async () => {
  const adapter = new CapturingOracleAdapter(config, 30, 60);
  await adapter.catalog("columns", { schema: undefined });
  const call = adapter.captured.at(-1)!;
  assert.equal(call.binds.s0, "APP");
});

test("statements keep stored definitions intact and mark DDL as implicit commit", async () => {
  const adapter = new CapturingOracleAdapter(config, 30, 60);
  const calls: string[] = [];
  const fakeClient = {
    callTimeout: 0,
    execute: async (sql: string) => {
      calls.push(sql);
      return { rowsAffected: 0 };
    },
  };
  const statement = (
    adapter as unknown as {
      statement(
        client: typeof fakeClient,
        sql: string,
        binds: Binds,
      ): Promise<{ implicitCommit: boolean }>;
    }
  ).statement.bind(adapter);
  const ddl = await statement(fakeClient, "CREATE TABLE APP.T (id NUMBER)", {});
  assert.equal(ddl.implicitCommit, true);
  const truncate = await statement(fakeClient, "TRUNCATE TABLE APP.T", {});
  assert.equal(truncate.implicitCommit, true);
  const dml = await statement(fakeClient, "INSERT INTO APP.T VALUES (:id);", {
    id: 1,
  });
  assert.equal(dml.implicitCommit, false);
  const plsql = await statement(
    fakeClient,
    "CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;",
    {},
  );
  assert.equal(plsql.implicitCommit, true);
  assert.equal(
    calls.at(-1),
    "CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;",
    "PL/SQL bodies keep their exact terminator",
  );
  const plain = await statement(fakeClient, "INSERT INTO APP.T VALUES (:id);", {
    id: 2,
  });
  assert.equal(plain.implicitCommit, false);
});

test("describeTable fans out bounded catalog and column-detail lookups", async () => {
  const adapter = new CapturingOracleAdapter(config, 30, 60);
  const described = await adapter.describeTable("APP", "T");
  assert.equal(described.schema, "APP");
  assert.equal(described.table, "T");
  assert.equal(adapter.captured.length, 5);
  const sqls = adapter.captured.map((c) => c.sql);
  assert.ok(sqls.some((s) => s.includes("all_cons_columns")));
  assert.ok(sqls.some((s) => s.includes("all_ind_columns")));
});
