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
test(
  "live feature workflow: snapshots, migration, verification, binds, confirmation, history and SQL export",
  { skip: !process.env.TEST_PG_PASSWORD },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "dbmux-feature-"));
    const store = new Store(directory, new Vault(randomBytes(32)));
    const auth = new Auth(store);
    const manager = new ConnectionManager(store, {
      QUERY_TIMEOUT_SECONDS: 30,
      DDL_TIMEOUT_SECONDS: 60,
    });
    const gateway = new Gateway(manager, auth);
    const context = {
      project: "enrollment-test",
      branch: "feature/preferences",
    };
    try {
      await manager.save({
        id: "feature",
        name: "Feature test",
        engine: "postgres",
        host: "127.0.0.1",
        port: 55432,
        database: "dbmux_test",
        username: "dbmux_test",
        password: process.env.TEST_PG_PASSWORD,
        enabled: true,
        permissions: permissions("full-development"),
        policy: { allowedSchemas: ["public"] },
      });
      const identity = auth.resolve(
        auth.create(
          "Developer",
          ["feature"],
          permissions("full-development"),
          1,
        ).token,
      );
      const readOnly = auth.resolve(
        auth.create("Reader", ["feature"], permissions("read-only"), 1).token,
      );
      const adapter = manager.adapter("feature");
      const before = await gateway.snapshots.capture(
        adapter,
        "feature",
        "public",
        "before",
        identity.id,
      );
      const migration = await gateway.migration(
        identity,
        "feature",
        "preferences-v1",
        [
          "CREATE TABLE public.dbmux_feature_preference(id integer PRIMARY KEY,student_id integer NOT NULL,status varchar(1) DEFAULT 'A')",
          "CREATE INDEX dbmux_feature_student_idx ON public.dbmux_feature_preference(student_id)",
        ],
        context,
      );
      assert.equal(migration.success, true);
      assert.ok("atomic" in migration && migration.atomic);
      const failed = await gateway.migration(
        identity,
        "feature",
        "atomic-failure",
        [
          "CREATE TABLE public.dbmux_feature_atomic_failure(id integer)",
          "INSERT INTO public.dbmux_missing_table(id) VALUES(1)",
        ],
        context,
      );
      assert.equal(failed.success, false);
      assert.equal(
        (
          await adapter.catalog("tables", {
            schema: "public",
            name: "dbmux_feature_atomic_failure",
          })
        ).rows.length,
        0,
      );
      const definition = await gateway.describe(
        identity,
        "feature",
        "db_describe_table",
        "public",
        "dbmux_feature_preference",
      );
      assert.equal((definition.columns as unknown[]).length, 3);
      await gateway.run(
        identity,
        "feature",
        "db_execute",
        "INSERT INTO public.dbmux_feature_preference(id,student_id) VALUES($1,$2)",
        [1, 101],
        context,
      );
      await gateway.run(
        identity,
        "feature",
        "db_execute",
        "UPDATE public.dbmux_feature_preference SET status=$1 WHERE id=$2",
        ["N", 1],
        context,
      );
      await assert.rejects(
        gateway.run(
          readOnly,
          "feature",
          "db_execute",
          "INSERT INTO public.dbmux_feature_preference(id,student_id) VALUES($1,$2)",
          [2, 102],
        ),
      );
      await assert.rejects(
        gateway.run(
          identity,
          "feature",
          "db_execute",
          "DELETE FROM public.dbmux_feature_preference",
          [],
        ),
      );
      const prepared = gateway.prepare(
        identity,
        "feature",
        "db_prepare_change",
        "DELETE FROM public.dbmux_feature_preference WHERE id=$1",
        [1],
        context,
      );
      await gateway.confirm(identity, "feature", prepared.changeId);
      const after = await gateway.snapshots.capture(
        adapter,
        "feature",
        "public",
        "after",
        identity.id,
      );
      const diff = gateway.snapshots.compare(
        before.snapshotId,
        after.snapshotId,
        "feature",
      );
      assert.ok(
        diff.changes.some((c) => c.object.includes("dbmux_feature_preference")),
      );
      const exported = gateway.export(
        identity,
        "feature",
        context.project,
        context.branch,
      );
      assert.match(
        exported.sql,
        /CREATE TABLE public.dbmux_feature_preference/,
      );
      assert.match(exported.sql, /UPDATE public.dbmux_feature_preference/);
      assert.equal(exported.statements.length, 5);
      const tx = await gateway.transactions.begin(
        identity.id,
        "feature",
        adapter,
      );
      await gateway.run(
        identity,
        "feature",
        "db_transaction_execute",
        "INSERT INTO public.dbmux_feature_preference(id,student_id) VALUES($1,$2)",
        [3, 103],
        context,
        { transactionId: tx.transactionId },
      );
      await gateway.finishTransaction(
        identity,
        "feature",
        tx.transactionId,
        false,
      );
      assert.equal(
        gateway.export(identity, "feature", context.project, context.branch)
          .statements.length,
        5,
      );
      const drop = gateway.prepare(
        identity,
        "feature",
        "db_prepare_change",
        "DROP TABLE public.dbmux_feature_preference",
        [],
        context,
      );
      await gateway.confirm(identity, "feature", drop.changeId);
    } finally {
      await gateway.close();
      store.close();
      rmSync(directory, { recursive: true });
    }
  },
);
