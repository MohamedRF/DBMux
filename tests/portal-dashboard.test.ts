import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { Store } from "../src/storage/sqlite.js";
import { Vault } from "../src/security/encryption.js";
import { Auth } from "../src/security/auth.js";
import { ConnectionManager } from "../src/database/manager.js";
import { Gateway } from "../src/services/gateway.js";
import { permissions, permissionKeys } from "../src/security/permissions.js";
import {
  effectiveTokenAccess,
  portalDashboard,
} from "../src/services/portal.service.js";
import { createApp } from "../src/server/http.js";
import type { Config } from "../src/config/index.js";

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "dbmux-dashboard-"));
  const key = randomBytes(32);
  const store = new Store(directory, new Vault(key));
  const auth = new Auth(store);
  const manager = new ConnectionManager(store, {
    QUERY_TIMEOUT_SECONDS: 30,
    DDL_TIMEOUT_SECONDS: 60,
  });
  const gateway = new Gateway(manager, auth);
  auth.setup("Admin", "synthetic-dashboard-password");
  const session = auth.login("Admin", "synthetic-dashboard-password");
  await manager.save({
    id: "dev",
    name: "Development",
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "dev",
    username: "dev",
    password: "synthetic-only-database-password",
    enabled: true,
    permissions: permissions("read-only"),
    policy: { allowedSchemas: ["public"] },
  });
  const config: Config = {
    PUBLIC_URL: "http://localhost:3000",
    SETUP_TOKEN: "synthetic-dashboard-bootstrap",
    DATA_DIR: directory,
    key,
    PORT: 3000,
    QUERY_TIMEOUT_SECONDS: 30,
    DDL_TIMEOUT_SECONDS: 60,
    TRANSACTION_TIMEOUT_SECONDS: 300,
  };
  const http = createApp(gateway, config).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true });
  });
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    token = session,
  ) =>
    fetch(base + "/api" + path, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { store, auth, manager, gateway, request, base };
}
const accessModulePath = new URL(
  "../src/ui/access-controls.js",
  import.meta.url,
).href;
const ui = await import(accessModulePath);
const timelineUi = await import(
  new URL("../src/ui/timeline.js", import.meta.url).href
);

test("effective access reflects current connection grants, availability and unsupported routines", async (t) => {
  const f = await fixture(t);
  assert.equal(timelineUi.hasRequestTimeline(randomUUID()), true);
  assert.equal(timelineUi.hasRequestTimeline("local"), false);
  const issued = f.auth.create(
    "Developer",
    ["dev", "removed"],
    { ...permissions("full-development"), executeRoutine: true },
    1,
  );
  const token = f.auth.list()[0]!;
  const access = effectiveTokenAccess(token, f.manager.list());
  assert.equal(access[0]!.permissions.read, true);
  assert.equal(access[0]!.permissions.drop, false);
  assert.equal(access[0]!.permissions.executeRoutine, false);
  assert.equal(access[1]!.unavailable, "Connection removed");
  assert.ok(Object.values(access[1]!.permissions).every((value) => !value));
  assert.deepEqual(
    ui.permissionDefinitions.map((entry: string[]) => entry[0]),
    permissionKeys,
  );
  for (const level of [
    "read-only",
    "development-write",
    "full-development",
  ] as const)
    assert.deepEqual(ui.presetPermissions(level), permissions(level));
  assert.deepEqual(
    ui.effectivePermissions(token.permissions, f.manager.list()[0]),
    access[0]!.permissions,
  );
  assert.equal(
    ui.permissionLevel({ ...permissions("read-only"), insert: true }),
    "custom",
  );
  assert.equal(
    (await f.request("/tokens", "GET", undefined, issued.token)).status,
    401,
  );
  assert.equal(
    (
      await f.request("/tokens", "POST", {
        name: "Duplicate",
        connections: ["dev", "dev"],
        permissions: permissions("read-only"),
      })
    ).status,
    400,
  );
  const listing = await (await f.request("/tokens")).json();
  assert.deepEqual(listing[0].access, access);
  assert.ok(!JSON.stringify(listing).includes(issued.token));
  await f.manager.save({ ...f.manager.configFor("dev"), enabled: false });
  assert.equal(
    effectiveTokenAccess(token, f.manager.list())[0]!.unavailable,
    "MCP disabled",
  );
  assert.equal(
    effectiveTokenAccess({ ...token, revoked: true }, f.manager.list())[0]!
      .unavailable,
    "Token revoked",
  );
  assert.equal(
    effectiveTokenAccess({ ...token, expiresAt: 0 }, f.manager.list())[0]!
      .unavailable,
    "Token expired",
  );
});

test("dashboard counts local-day traffic, fills chart gaps and records only explicit health tests", async (t) => {
  const f = await fixture(t);
  const now = Date.parse("2026-10-07T20:00:00.000Z");
  function event(
    kind: string,
    status: string,
    duration: number,
    timestamp: string,
  ) {
    const id = f.store.startActivity({
      kind,
      actorId: "metrics",
      actorName: "Metrics",
      operation: kind === "tool" ? "db_query" : "POST /mcp",
      source: "local",
      requestId: randomUUID(),
    });
    f.store.finishActivity(id, status, duration);
    f.store.db
      .prepare("UPDATE activity_log SET timestamp=? WHERE id=?")
      .run(timestamp, id);
  }
  event("mcp", "success", 200, "2026-10-07T18:30:00.000Z");
  event("api", "error", 1, "2026-10-07T19:00:00.000Z");
  event("mcp", "success", 1, "2026-10-07T18:29:59.999Z");
  event("tool", "success", 1500, "2026-10-07T19:00:00.000Z");
  event("tool", "error", 2000, "2026-10-07T19:10:00.000Z");
  event("tool", "success", 50, "2026-10-07T19:20:00.000Z");
  const expiring = f.auth.create(
    "Expiring",
    ["dev"],
    permissions("read-only"),
    1,
  );
  f.store.put("token", expiring.id, {
    ...f.auth.current(expiring.id),
    expiresAt: now + 6 * 86400000,
  });
  const revoked = f.auth.create(
    "Revoked",
    ["dev"],
    permissions("read-only"),
    1,
  );
  f.auth.revoke(revoked.id);
  let probes = 0;
  const adapter = f.manager.adapter("dev");
  adapter.testConnection = async () => {
    probes++;
    return { connected: true, latencyMs: 12 };
  };
  const dashboard = portalDashboard(
    f.manager,
    f.auth,
    330,
    Number.MAX_SAFE_INTEGER,
    now,
  );
  assert.equal(probes, 0);
  assert.equal(dashboard.todayStart, "2026-10-07T18:30:00.000Z");
  assert.deepEqual(
    { ...dashboard.metrics },
    {
      requests: 2,
      failedRequests: 1,
      toolCalls: 3,
      failedTools: 1,
      slowTools: 2,
    },
  );
  assert.equal(dashboard.daily.length, 7);
  assert.equal(dashboard.daily[6]!.requests, 2);
  assert.equal(dashboard.daily[5]!.requests, 1);
  assert.equal(dashboard.slow[0]!.duration_ms, 2000);
  assert.equal(dashboard.connections[0]!.health, null);
  assert.deepEqual(
    dashboard.expiringTokens.map((token) => token.id),
    [expiring.id],
  );
  assert.equal(
    (await f.request("/dashboard", "GET", undefined, "")).status,
    401,
  );
  assert.equal((await f.request("/dashboard?timezoneOffset=841")).status, 400);
  assert.equal((await f.request("/connections/dev/test", "POST")).status, 200);
  assert.equal(probes, 1);
  assert.equal(
    (await (await f.request("/dashboard")).json()).connections[0].health
      .connected,
    true,
  );
  adapter.testConnection = async () => {
    throw new Error("synthetic-private-driver-and-password");
  };
  assert.equal((await f.request("/connections/dev/test", "POST")).status, 500);
  const failedDashboard = await (await f.request("/dashboard")).json();
  assert.equal(failedDashboard.connections[0].health.connected, false);
  assert.equal(
    failedDashboard.connections[0].health.errorCode,
    "DATABASE_OPERATION_FAILED",
  );
  assert.ok(
    !JSON.stringify(failedDashboard).includes(
      "synthetic-private-driver-and-password",
    ),
  );
  let finish!: (value: Record<string, unknown>) => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  adapter.testConnection = () => {
    began();
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const pending = f.request("/connections/dev/test", "POST");
  await started;
  await f.manager.save({
    ...f.manager.configFor("dev"),
    name: "Updated development",
  });
  finish({ connected: true, latencyMs: 1 });
  await pending;
  assert.equal(
    (await (await f.request("/dashboard")).json()).connections[0].health,
    null,
  );
});

test("request timelines correlate multi-statement audits, retain failures and filter activity safely", async (t) => {
  const f = await fixture(t);
  await f.manager.save({
    ...f.manager.configFor("dev"),
    permissions: permissions("full-development"),
  });
  const issued = f.auth.create(
    "Timeline developer",
    ["dev"],
    permissions("full-development"),
    1,
  );
  const adapter = f.manager.adapter("dev");
  let fail = false;
  adapter.beginTransaction = async () => ({
    query: async () => ({
      rows: [],
      columns: [],
      rowCount: 0,
      executionMs: 1,
      truncated: false,
    }),
    execute: async () => {
      if (fail) throw new Error("synthetic-private-driver-error");
      return { rowsAffected: 0, executionMs: 1, implicitCommit: false };
    },
    commit: async () => {},
    rollback: async () => {},
  });
  const client = new Client({ name: "timeline-test", version: "1" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(f.base + "/mcp"), {
        requestInit: { headers: { Authorization: "Bearer " + issued.token } },
      }),
    );
    await client.callTool({
      name: "db_apply_migration",
      arguments: {
        connectionId: "dev",
        name: "timeline-success",
        statements: [
          "CREATE TABLE public.timeline_a(id integer)",
          "CREATE TABLE public.timeline_b(id integer)",
        ],
      },
    });
    const matches = await (
      await f.request(
        "/activity?kind=tool&connectionId=dev&operation=db_apply_migration&actorId=" +
          issued.id,
      )
    ).json();
    assert.equal(matches.total, 1);
    const requestId = matches.rows[0].request_id;
    const timeline = await (
      await f.request("/activity/requests/" + requestId)
    ).json();
    assert.equal(timeline.total, 2);
    assert.equal(timeline.auditTotal, 3);
    assert.ok(
      timeline.audits.every(
        (audit: { activity_id: number }) =>
          audit.activity_id === matches.rows[0].id,
      ),
    );
    assert.ok(
      timeline.audits.some(
        (audit: { status: string }) => audit.status === "uncommitted",
      ),
    );
    assert.ok(
      timeline.audits.some(
        (audit: { tool: string; status: string }) =>
          audit.tool === "db_transaction_commit" && audit.status === "success",
      ),
    );
    assert.ok(!JSON.stringify(timeline).includes("CREATE TABLE"));
    const page = await (
      await f.request(
        "/activity/requests/" + requestId + "?limit=1&offset=1&auditOffset=2",
      )
    ).json();
    assert.equal(page.rows.length, 1);
    assert.equal(page.audits.length, 1);
    assert.equal(page.total, 2);
    assert.equal(page.auditTotal, 3);
    assert.equal(
      (
        await f.request(
          "/activity/requests/" + requestId,
          "GET",
          undefined,
          issued.token,
        )
      ).status,
      401,
    );
    assert.equal(
      (await f.request("/audit/" + timeline.audits[0].id, "GET", undefined, ""))
        .status,
      401,
    );
    assert.equal(
      (await (await f.request("/audit/" + timeline.audits[0].id)).json())
        .payload.sql,
      "CREATE TABLE public.timeline_a(id integer)",
    );
    assert.equal(
      (await f.request("/activity/requests/not-a-uuid")).status,
      400,
    );
    assert.equal(
      (await f.request("/activity/requests/" + randomUUID())).status,
      404,
    );
    assert.equal((await f.request("/audit/999999")).status, 404);
    assert.equal(
      (
        await (
          await f.request("/activity?q=Timeline%20developer&kind=tool")
        ).json()
      ).total,
      1,
    );
    assert.equal((await (await f.request("/activity?q=%25")).json()).total, 0);
    assert.equal(
      (
        await (
          await f.request("/activity?q=" + encodeURIComponent("' OR 1=1 --"))
        ).json()
      ).total,
      0,
    );
    const exported = await (
      await f.request(
        "/activity/export?kind=tool&connectionId=dev&actorId=" + issued.id,
      )
    ).text();
    assert.equal(exported.trim().split("\n").length, 1);
    fail = true;
    const failed = await client.callTool({
      name: "db_apply_migration",
      arguments: {
        connectionId: "dev",
        name: "timeline-failed",
        statements: ["CREATE TABLE public.timeline_failed(id integer)"],
      },
    });
    assert.ok(Array.isArray(failed.content));
    assert.equal(
      JSON.parse((failed.content[0] as { text: string }).text).success,
      false,
    );
    const failureRows = await (
      await f.request("/activity?kind=tool&status=error&connectionId=dev")
    ).json();
    assert.equal(failureRows.total, 1);
    const failureTimeline = await (
      await f.request("/activity/requests/" + failureRows.rows[0].request_id)
    ).json();
    assert.equal(failureTimeline.audits[0].status, "failed");
    const raw = await (
      await f.request("/audit/" + failureTimeline.audits[0].id)
    ).text();
    assert.ok(!raw.includes("synthetic-private-driver-error"));
  } finally {
    await client.close();
  }
});

test("additive correlation upgrade preserves encrypted legacy audits and is repeatable", () => {
  const directory = mkdtempSync(join(tmpdir(), "dbmux-upgrade-"));
  const vault = new Vault(randomBytes(32));
  const db = new DatabaseSync(join(directory, "dbmux.sqlite"));
  db.exec(
    "CREATE TABLE audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,timestamp TEXT NOT NULL,owner TEXT NOT NULL,connection_id TEXT NOT NULL,tool TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL)",
  );
  db.prepare(
    "INSERT INTO audit_log(timestamp,owner,connection_id,tool,status,payload) VALUES(?,?,?,?,?,?)",
  ).run(
    "2026-10-01T00:00:00.000Z",
    "legacy",
    "dev",
    "db_query",
    "failed",
    vault.seal({ sql: "SELECT 1", parameters: [] }),
  );
  db.close();
  for (let i = 0; i < 2; i++) {
    const store = new Store(directory, vault);
    try {
      assert.equal(store.history("dev")[0]!.status, "failed");
      assert.equal(store.history("dev")[0]!.payload.sql, "SELECT 1");
      assert.equal(store.auditDetail(1)!.request_id, null);
    } finally {
      store.close();
    }
  }
  rmSync(directory, { recursive: true });
});
