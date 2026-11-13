import { test } from "node:test";
import assert from "node:assert/strict";
import { Sessions } from "../src/services/session.service.js";
import type {
  DatabaseAdapter,
  SessionHandle,
} from "../src/database/adapter.js";

function fakeAdapter(events: string[]): DatabaseAdapter {
  const handle: SessionHandle = {
    query: async (sql) => {
      events.push("query:" + sql);
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionMs: 1,
        truncated: false,
      };
    },
    execute: async (sql) => {
      events.push("execute:" + sql);
      return { rowsAffected: 1, executionMs: 1, implicitCommit: false };
    },
    close: async () => {
      events.push("close");
    },
  };
  return {
    beginSession: async () => handle,
  } as unknown as DatabaseAdapter;
}

test("owner-bound sessions pin one handle and release it on close", async () => {
  const events: string[] = [];
  const sessions = new Sessions(1800, () => {
    throw new Error("Unexpected cleanup failure");
  });
  try {
    const adapter = fakeAdapter(events);
    const opened = await sessions.begin("alice", "app", adapter);
    assert.throws(() => sessions.get(opened.sessionId, "bob"));
    await sessions.run(opened.sessionId, "alice", async () => {
      events.push("work");
    });
    await sessions.finish(opened.sessionId, "alice");
    assert.deepEqual(events, ["work", "close"]);
    assert.throws(() => sessions.get(opened.sessionId, "alice"));
  } finally {
    await sessions.close();
  }
});

test("session operations run in order on the pinned connection", async () => {
  const events: string[] = [];
  const sessions = new Sessions(1800, () => {
    throw new Error("Unexpected cleanup failure");
  });
  try {
    const adapter = fakeAdapter(events);
    const opened = await sessions.begin("alice", "app", adapter);
    await Promise.all([
      sessions.run(opened.sessionId, "alice", async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        events.push("slow");
      }),
      sessions.run(opened.sessionId, "alice", async () => {
        events.push("fast");
      }),
    ]);
    assert.deepEqual(events, ["slow", "fast"]);
  } finally {
    await sessions.close();
  }
});

test("per-owner session limit is enforced", async () => {
  const events: string[] = [];
  const sessions = new Sessions(1800, () => {
    throw new Error("Unexpected cleanup failure");
  });
  try {
    const adapter = fakeAdapter(events);
    for (let i = 0; i < 8; i++) await sessions.begin("alice", "app", adapter);
    await assert.rejects(
      sessions.begin("alice", "app", adapter),
      /Too many active sessions/,
    );
  } finally {
    await sessions.close();
  }
});

test("idle sessions expire", async () => {
  const events: string[] = [];
  const sessions = new Sessions(1, () => undefined);
  try {
    const adapter = fakeAdapter(events);
    const opened = await sessions.begin("alice", "app", adapter);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.throws(() => sessions.get(opened.sessionId, "alice"));
  } finally {
    await sessions.close();
  }
});
