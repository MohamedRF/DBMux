import { test } from "node:test";
import assert from "node:assert/strict";
import { Transactions } from "../src/services/transaction.service.js";
import type { DatabaseAdapter } from "../src/database/adapter.js";
test("transaction queue finishes admitted work before commit, rejects other owners and rolls back failed work", async () => {
  const events: string[] = [];
  const handle = {
    commit: async () => {
      events.push("commit");
    },
    rollback: async () => {
      events.push("rollback");
    },
  };
  const adapter = {
    beginTransaction: async () => handle,
  } as unknown as DatabaseAdapter;
  const txs = new Transactions(30, () =>
    assert.fail("Unexpected cleanup failure"),
  );
  try {
    const one = await txs.begin("alice", "app", adapter);
    assert.throws(() => txs.get(one.transactionId, "bob"));
    let release!: () => void;
    const wait = new Promise<void>((r) => (release = r));
    const work = txs.run(one.transactionId, "alice", async () => {
      await wait;
      events.push("work");
    });
    const commit = txs.finish(one.transactionId, "alice", true);
    release();
    await Promise.all([work, commit]);
    assert.deepEqual(events, ["work", "commit"]);
    const two = await txs.begin("alice", "app", adapter);
    await assert.rejects(
      txs.run(two.transactionId, "alice", async () => {
        throw new Error("database failure");
      }),
    );
    await assert.rejects(txs.finish(two.transactionId, "alice", true));
    assert.equal(events.at(-1), "rollback");
  } finally {
    await txs.close();
  }
});
