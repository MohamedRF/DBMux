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
import { diffObjects } from "../src/services/schema-diff.service.js";
test("scoped tokens, one-time confirmations, audit and credential secrecy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dbmux-"));
  const store = new Store(dir, new Vault(randomBytes(32)));
  const auth = new Auth(store);
  const manager = new ConnectionManager(store, {
    QUERY_TIMEOUT_SECONDS: 30,
    DDL_TIMEOUT_SECONDS: 60,
  });
  const gateway = new Gateway(manager, auth);
  try {
    auth.setup("admin", "synthetic-admin-password");
    assert.throws(() => auth.setup("other", "synthetic-admin-password"));
    assert.throws(() => auth.login("admin", "wrong-password"));
    const adminSession = auth.login("admin", "synthetic-admin-password");
    auth.admin(adminSession);
    assert.throws(() => auth.resolve(adminSession));
    await manager.save({
      id: "app",
      name: "App",
      engine: "postgres",
      host: "localhost",
      port: 5432,
      database: "dev",
      username: "dev",
      password: "synthetic-password-never-return",
      enabled: true,
      permissions: permissions("full-development"),
      policy: { allowedSchemas: ["public"] },
    });
    assert.ok(
      !JSON.stringify(manager.list()).includes(
        "synthetic-password-never-return",
      ),
    );
    const issued = auth.create(
      "Alice",
      ["app"],
      permissions("full-development"),
      1,
    );
    const alice = auth.resolve(issued.token);
    const other = auth.resolve(
      auth.create("Bob", ["app"], permissions("full-development"), 1).token,
    );
    assert.throws(() => gateway.authorize(alice, "other", "db_query"));
    const adapter = manager.adapter("app");
    let writes = 0;
    adapter.executeStatement = async () => {
      writes++;
      return { rowsAffected: 1, executionMs: 1, implicitCommit: false };
    };
    await assert.rejects(
      gateway.run(alice, "app", "db_drop_table", "DROP TABLE public.t", []),
    );
    const p = gateway.prepare(
      alice,
      "app",
      "db_prepare_change",
      "DROP TABLE public.t",
      [],
      {},
    );
    await assert.rejects(gateway.confirm(other, "app", p.changeId));
    await gateway.confirm(alice, "app", p.changeId);
    await assert.rejects(gateway.confirm(alice, "app", p.changeId));
    assert.equal(writes, 1);
    assert.equal(store.history("app")[0]?.status, "success");
    auth.revoke(alice.id);
    assert.throws(() => gateway.authorize(alice, "app", "db_query"));
    const exp = auth.resolve(
      auth.create("Expired", ["app"], permissions("read-only"), 1).token,
    );
    store.put("token", exp.id, { ...exp, expiresAt: Date.now() - 1 });
    assert.throws(() => auth.current(exp.id));
  } finally {
    await gateway.close();
    store.close();
    rmSync(dir, { recursive: true });
  }
});
test("schema diff reports added, removed, datatype/default/nullable changes", () => {
  const result = diffObjects(
    { "columns/T/ID": { type: "NUMBER", nullable: true }, "tables/OLD": {} },
    {
      "columns/T/ID": { type: "VARCHAR2", nullable: false, default: "0" },
      "tables/NEW": {},
    },
  );
  assert.deepEqual(
    result.changes.map((c) => c.change),
    ["changed", "added", "removed"],
  );
});
