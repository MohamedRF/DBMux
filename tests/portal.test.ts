import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { Store } from "../src/storage/sqlite.js";
import { Vault } from "../src/security/encryption.js";
import { Auth } from "../src/security/auth.js";
import { ConnectionManager } from "../src/database/manager.js";
import { Gateway } from "../src/services/gateway.js";
import { permissions } from "../src/security/permissions.js";
import { createApp } from "../src/server/http.js";
import type { Config } from "../src/config/index.js";

test("portal token lifecycle, immediate scope changes and secret-safe downloadable activity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dbmux-portal-"));
  const key = randomBytes(32);
  const store = new Store(directory, new Vault(key));
  const auth = new Auth(store);
  const manager = new ConnectionManager(store, {
    QUERY_TIMEOUT_SECONDS: 30,
    DDL_TIMEOUT_SECONDS: 60,
  });
  const gateway = new Gateway(manager, auth);
  const config: Config = {
    PUBLIC_URL: "http://localhost:3000",
    SETUP_TOKEN: "synthetic-bootstrap-value",
    DATA_DIR: directory,
    key,
    PORT: 3000,
    QUERY_TIMEOUT_SECONDS: 30,
    DDL_TIMEOUT_SECONDS: 60,
    TRANSACTION_TIMEOUT_SECONDS: 300,
  };
  auth.setup("Administrator", "synthetic-administrator-password");
  const session = auth.login(
    "Administrator",
    "synthetic-administrator-password",
  );
  await manager.save({
    id: "dev",
    name: "Development",
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "dev",
    username: "dev",
    password: "synthetic-database-password",
    enabled: true,
    permissions: permissions("full-development"),
    policy: { allowedSchemas: ["public"] },
  });
  const http = createApp(gateway, config).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
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
  const client = new Client({ name: "portal-test-client", version: "1" });
  try {
    assert.equal(
      (await request("/activity", "GET", undefined, "")).status,
      401,
    );
    assert.equal(
      (await request("/activity/export", "GET", undefined, "")).status,
      401,
    );
    const issuedResponse = await request("/tokens", "POST", {
      name: "Alice",
      connections: ["dev"],
      permissions: permissions("full-development"),
      days: 10,
    });
    assert.equal(issuedResponse.status, 201);
    const issued = await issuedResponse.json();
    const original = auth.resolve(issued.token);
    assert.equal(
      (await request("/tokens/" + issued.id + "/remove", "POST")).status,
      409,
    );
    const editedResponse = await request("/tokens/" + issued.id, "PUT", {
      name: "Alice updated",
      connections: ["dev"],
      permissions: permissions("read-only"),
    });
    assert.equal(editedResponse.status, 200);
    const edited = await editedResponse.json();
    assert.equal(edited.expiresAt, issued.expiresAt);
    assert.ok(!("hash" in edited) && !("token" in edited));
    assert.equal(auth.resolve(issued.token).name, "Alice updated");
    assert.equal(
      gateway.authorize(original, "dev", "db_query").permissions.insert,
      false,
    );
    assert.equal(
      (
        await request("/tokens/" + issued.id, "PUT", {
          name: "Alice",
          connections: ["missing"],
          permissions: permissions("read-only"),
        })
      ).status,
      404,
    );
    assert.equal(auth.resolve(issued.token).name, "Alice updated");
    assert.equal(
      (
        await request("/tokens/" + issued.id, "PUT", {
          name: "Alice",
          connections: [],
          permissions: permissions("read-only"),
        })
      ).status,
      400,
    );
    const renewedResponse = await request("/tokens/" + issued.id, "PUT", {
      name: "Alice updated",
      connections: ["dev"],
      permissions: permissions("read-only"),
      days: 30,
    });
    assert.equal(renewedResponse.status, 200);
    assert.ok((await renewedResponse.json()).expiresAt > issued.expiresAt);
    assert.equal(
      (
        await request("/tokens/nonexistent", "PUT", {
          name: "Missing",
          connections: ["dev"],
          permissions: permissions("read-only"),
        })
      ).status,
      404,
    );
    assert.equal((await request("/status")).status, 200);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
        requestInit: {
          headers: {
            Authorization: "Bearer " + issued.token,
            "X-Forwarded-For": "spoofed-client",
          },
        },
      }),
    );
    await client.callTool({ name: "db_gateway_info", arguments: {} });
    await client.callTool({ name: "db_connections", arguments: {} });
    const denied = await client.callTool({
      name: "db_query",
      arguments: {
        connectionId: "outside",
        sql: "SELECT 'synthetic-sensitive-query'",
        parameters: ["synthetic-bind-value"],
      },
    });
    assert.equal(denied.isError, true);
    const activity = await (
      await request("/activity?kind=tool&actor=Alice%20updated")
    ).json();
    assert.equal(activity.total, 3);
    const failure = activity.rows.find(
      (r: { operation: string }) => r.operation === "db_query",
    );
    assert.equal(failure.status, "error");
    assert.equal(failure.error_code, "CONNECTION_DENIED");
    assert.equal(failure.actor_id, issued.id);
    assert.equal(failure.source, "127.0.0.1");
    assert.ok(
      activity.rows.every(
        (r: { request_id: string }) => r.request_id !== "local",
      ),
    );
    const transport = store.activity({ kind: "mcp", limit: 100, offset: 0 });
    assert.ok(transport.rows.some((r) => r.request_id === failure.request_id));
    assert.equal((await request("/activity?limit=1001")).status, 400);
    assert.equal(
      (
        await request(
          "/activity?from=2026-10-08T00:00:00Z&to=2026-10-07T00:00:00Z",
        )
      ).status,
      400,
    );
    assert.equal((await request("/tokens/" + issued.id, "DELETE")).status, 200);
    assert.throws(() => auth.resolve(issued.token));
    assert.equal(
      (
        await request("/tokens/" + issued.id, "PUT", {
          name: "Revoked",
          connections: ["dev"],
          permissions: permissions("read-only"),
        })
      ).status,
      409,
    );
    assert.equal(
      (await request("/tokens/" + issued.id + "/remove", "POST")).status,
      200,
    );
    assert.equal(store.get("token", issued.id), undefined);
    assert.equal(
      store.activity({
        kind: "tool",
        actor: "Alice updated",
        limit: 10,
        offset: 0,
      }).total,
      3,
    );
    // Export crosses multiple pages and includes each matching record exactly once.
    for (let i = 0; i < 1105; i++) {
      const id = store.startActivity({
        kind: "tool",
        actorId: "export-fixture",
        actorName: "Export fixture",
        operation: "db_connections",
        source: "local",
        requestId: String(i),
      });
      store.finishActivity(id, "success", 1);
      // Keep HTTP/client idle timers running during slow synchronous disk writes.
      if ((i + 1) % 50 === 0) await setImmediate();
    }
    const exportResponse = await request(
      "/activity/export?actor=Export%20fixture&limit=1&offset=999",
    );
    assert.equal(exportResponse.status, 200);
    assert.match(
      exportResponse.headers.get("content-disposition")!,
      /attachment/,
    );
    const records = (await exportResponse.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(records.length, 1105);
    assert.equal(new Set(records.map((r) => r.id)).size, 1105);
    const first = records[records.length - 1];
    const boundary = first.timestamp.slice(0, 19) + "Z";
    const dated = await (
      await request(
        "/activity?actor=Export%20fixture&from=" + encodeURIComponent(boundary),
      )
    ).json();
    assert.equal(dated.total, 1105);
    for (let i = 0; i < 1005; i++) {
      const id = store.audit("export-fixture", "dev", "db_query", {
        sql: "SELECT 1",
        parameters: [],
      });
      store.finishAudit(id, i % 2 ? "success" : "error", {
        sql: "SELECT 1",
        parameters: [],
      });
      if ((i + 1) % 50 === 0) await setImmediate();
    }
    assert.equal(
      (await request("/audit/export?connectionId=dev", "GET", undefined, ""))
        .status,
      401,
    );
    const history = (
      await (await request("/audit/export?connectionId=dev")).text()
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(history.length, 1005);
    assert.equal(new Set(history.map((row) => row.id)).size, 1005);
    assert.ok(history.some((row) => row.status === "error"));
    assert.equal(history[0].payload.sql, "SELECT 1");
    const historyReader = store.history.bind(store);
    store.history = (connectionId, limit, offset, snapshot) => {
      if (offset && offset >= 500)
        throw new Error("synthetic-private-driver-error");
      return historyReader(connectionId, limit, offset, snapshot);
    };
    try {
      await assert.rejects(async () => {
        const response = await request("/audit/export?connectionId=dev");
        await response.text();
      });
    } finally {
      store.history = historyReader;
    }
    assert.equal((await request("/status")).status, 200);
    const listing = await (await request("/activity")).json();
    assert.ok(
      listing.rows.every(
        (row: { operation: string; status: string }) =>
          row.operation !== "GET /api/activity" || row.status !== "pending",
      ),
    );
    const allLogs = await (await request("/activity/export")).text();
    for (const sensitive of [
      issued.token,
      session,
      config.SETUP_TOKEN,
      "synthetic-database-password",
      "synthetic-administrator-password",
      "synthetic-sensitive-query",
      "synthetic-bind-value",
      "spoofed-client",
    ])
      assert.ok(!allLogs.includes(sensitive));
    assert.ok(allLogs.includes("Alice updated"));
    assert.ok(allLogs.includes('"actor_name":"Unauthenticated"'));
  } finally {
    await client.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true });
  }
});
