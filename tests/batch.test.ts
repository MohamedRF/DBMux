import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/sqlite.js";
import { Vault } from "../src/security/encryption.js";
import { Auth } from "../src/security/auth.js";
import { ConnectionManager } from "../src/database/manager.js";
import { Gateway } from "../src/services/gateway.js";
import { permissions } from "../src/security/permissions.js";
import type { Binds, QueryResult } from "../src/database/adapter.js";

async function setup(engine: "postgres" | "oracle" = "postgres") {
  const directory = mkdtempSync(join(tmpdir(), "dbmux-batch-"));
  const store = new Store(directory, new Vault(randomBytes(32)));
  const auth = new Auth(store);
  auth.setup("admin", "synthetic-administrator-password");
  const manager = new ConnectionManager(store, {
    QUERY_TIMEOUT_SECONDS: 30,
    DDL_TIMEOUT_SECONDS: 60,
  });
  await manager.save({
    id: "app",
    name: "App",
    engine,
    host: "localhost",
    port: engine === "oracle" ? 1521 : 5432,
    database: engine === "oracle" ? "ORCL" : "dev",
    username: "dev",
    password: "synthetic-password",
    enabled: true,
    permissions: permissions("full-development"),
    policy: { allowedSchemas: [engine === "oracle" ? "APP" : "public"] },
  });
  const gateway = new Gateway(manager, auth, 300, () => undefined, 1800);
  const alice = auth.resolve(
    auth.create("Alice", ["app"], permissions("full-development"), 1).token,
  );
  const adapter = manager.adapter("app");
  return { directory, store, manager, gateway, alice, adapter };
}

function fakeWrite(failOn?: string) {
  const calls: string[] = [];
  return {
    calls,
    execute: async (sql: string) => {
      calls.push("e:" + sql);
      if (failOn && sql.includes(failOn)) throw new Error("synthetic failure");
      return { rowsAffected: 1, executionMs: 1, implicitCommit: false };
    },
  };
}

test("batch executes statements in order and reports per-statement results", async () => {
  const { directory, store, gateway, alice, adapter } = await setup();
  const fake = fakeWrite();
  adapter.executeStatement = fake.execute as typeof adapter.executeStatement;
  adapter.executeQuery = async (sql: string) =>
    ({
      columns: [{ name: "one" }],
      rows: [{ one: 1 }],
      rowCount: 1,
      executionMs: 1,
      truncated: false,
    }) as never;
  try {
    const result = await gateway.batch(
      alice,
      "app",
      "db_execute_batch",
      "INSERT INTO public.t VALUES (1);\nSELECT 1;\nINSERT INTO public.t VALUES (2)",
      {},
      {},
    );
    assert.equal(result.success, true);
    assert.equal(result.statementsExecuted, 3);
    assert.equal(result.total, 3);
    assert.equal(result.atomic, false);
    assert.deepEqual(fake.calls, [
      "e:INSERT INTO public.t VALUES (1)",
      "e:INSERT INTO public.t VALUES (2)",
    ]);
    assert.equal(result.results[1]?.rowCount, 1);
    const history = store.history("app");
    for (const row of history) {
      const context = (row.payload as { context?: Record<string, unknown> })
        .context;
      assert.equal(context?.batchId, result.batchId);
    }
  } finally {
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("batch rolls the whole script back when a statement fails", async () => {
  const { directory, store, gateway, alice, adapter } = await setup();
  const calls: string[] = [];
  const handle = {
    query: async () => {
      calls.push("query");
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionMs: 1,
        truncated: false,
      };
    },
    execute: async (sql: string) => {
      calls.push("execute:" + sql);
      if (sql.includes("FAIL")) throw new Error("synthetic failure");
      return { rowsAffected: 1, executionMs: 1, implicitCommit: false };
    },
    commit: async () => {
      calls.push("commit");
    },
    rollback: async () => {
      calls.push("rollback");
    },
  };
  adapter.beginTransaction = async () => handle as never;
  try {
    const result = await gateway.batch(
      alice,
      "app",
      "db_execute_batch",
      "INSERT INTO public.t VALUES (1); INSERT INTO public.FAIL VALUES (2); INSERT INTO public.t VALUES (3)",
      { useTransaction: true },
      {},
    );
    assert.equal(result.success, false);
    assert.equal(result.atomic, true);
    assert.equal(result.rolledBack, true);
    assert.equal(result.statementsExecuted, 1);
    assert.equal(result.failedIndex, 1);
    assert.ok(!calls.includes("commit"));
    assert.equal(calls.at(-1), "rollback");
  } finally {
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("batch rejects high-risk statements before executing anything", async () => {
  const { directory, store, gateway, alice, adapter } = await setup();
  const fake = fakeWrite();
  adapter.executeStatement = fake.execute as typeof adapter.executeStatement;
  try {
    await assert.rejects(
      gateway.batch(
        alice,
        "app",
        "db_execute_batch",
        "INSERT INTO public.t VALUES (1); DROP TABLE public.t;",
        {},
        {},
      ),
      /CONFIRMATION_REQUIRED|requires confirmation/,
    );
    assert.deepEqual(fake.calls, []);
  } finally {
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("batch rejects stored definitions instead of auto-splitting them", async () => {
  const { directory, store, gateway, alice } = await setup();
  try {
    await assert.rejects(
      gateway.batch(
        alice,
        "app",
        "db_execute_batch",
        "CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;",
        {},
        {},
      ),
      /stored definition/,
    );
  } finally {
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("batch rejects bind placeholders and empty scripts", async () => {
  const { directory, store, gateway, alice } = await setup();
  try {
    await assert.rejects(
      gateway.batch(
        alice,
        "app",
        "db_execute_batch",
        "INSERT INTO public.t VALUES ($1)",
        {},
        {},
      ),
      /bind placeholders/,
    );
    await assert.rejects(
      gateway.batch(
        alice,
        "app",
        "db_execute_batch",
        "-- only a comment\n",
        {},
        {},
      ),
      /no statements/,
    );
    await assert.rejects(
      gateway.batch(
        alice,
        "app",
        "db_execute_batch",
        "SELECT 1",
        { useTransaction: true, continueOnError: true },
        {},
      ),
      /cannot continue on error/,
    );
  } finally {
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("oracle transactional batch allows DML but rejects DDL", async () => {
  const { directory, store, gateway, alice } = await setup("oracle");
  try {
    await assert.rejects(
      gateway.batch(
        alice,
        "app",
        "db_execute_batch",
        "INSERT INTO APP.T VALUES (1); CREATE TABLE APP.U (id NUMBER)",
        { useTransaction: true },
        {},
      ),
      /implicit-commits under Oracle/,
    );
  } finally {
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("DB_MCP_READ_ONLY forces read-only statements for the process", async () => {
  const { directory, store, gateway, alice, adapter } = await setup();
  const fake = fakeWrite();
  adapter.executeStatement = fake.execute as typeof adapter.executeStatement;
  adapter.executeQuery = async () =>
    ({
      columns: [{ name: "one" }],
      rows: [{ one: 1 }],
      rowCount: 1,
      executionMs: 1,
      truncated: false,
    }) as never;
  process.env.DB_MCP_READ_ONLY = "0";
  try {
    await assert.rejects(
      gateway.run(
        alice,
        "app",
        "db_execute",
        "INSERT INTO public.t VALUES (1)",
        [],
      ),
      /READ_ONLY/,
    );
    const read = (await gateway.run(
      alice,
      "app",
      "db_query",
      "SELECT 1",
      [],
    )) as QueryResult;
    assert.equal(read.rowCount, 1);
    const batch = await gateway.batch(
      alice,
      "app",
      "db_execute_batch",
      "SELECT 1",
      {},
      {},
    );
    assert.equal(batch.success, true);
    await assert.rejects(
      gateway.batch(
        alice,
        "app",
        "db_execute_batch",
        "SELECT 1; INSERT INTO public.t VALUES (1)",
        {},
        {},
      ),
      /READ_ONLY/,
    );
    assert.deepEqual(fake.calls, []);
  } finally {
    delete process.env.DB_MCP_READ_ONLY;
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
