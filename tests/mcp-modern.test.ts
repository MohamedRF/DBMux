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
import { createApp } from "../src/server/http.js";
import type { Config } from "../src/config/index.js";

// The 2026-07-28 revision ("MCP 2.0") is stateless: every request carries a
// per-request `_meta` envelope with the protocol version and client
// capabilities, and the standard headers MCP-Protocol-Version / Mcp-Method /
// Mcp-Name. These tests drive that path with raw HTTP so the wire contract
// is pinned independently of the SDK client.
const MODERN_VERSION = "2026-07-28";
const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_META_KEY =
  "io.modelcontextprotocol/clientCapabilities";
const CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";

function modernBody(id: number, method: string, params: object = {}) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: MODERN_VERSION,
        [CLIENT_CAPABILITIES_META_KEY]: {},
        [CLIENT_INFO_META_KEY]: { name: "dbmux-test", version: "1.0.0" },
      },
    },
  };
}

test("modern 2026-07-28 revision over raw HTTP", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dbmux-modern-"));
  const key = randomBytes(32);
  const store = new Store(directory, new Vault(key));
  const auth = new Auth(store);
  const manager = new ConnectionManager(store, {
    QUERY_TIMEOUT_SECONDS: 30,
    DDL_TIMEOUT_SECONDS: 60,
  });
  const gateway = new Gateway(manager, auth);
  const config = {
    PUBLIC_URL: "http://localhost:3000",
    SETUP_TOKEN: "synthetic-bootstrap-token-123456789",
    DATA_DIR: directory,
    key,
    PORT: 3000,
    QUERY_TIMEOUT_SECONDS: 30,
    DDL_TIMEOUT_SECONDS: 60,
    TRANSACTION_TIMEOUT_SECONDS: 300,
    DB_SESSION_IDLE_TTL_SECONDS: 1800,
  } satisfies Config;
  const http = createApp(gateway, config).listen(0, "127.0.0.1");
  await new Promise<void>((r) => http.once("listening", r));
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const issued = auth.create("Modern", [], permissions("read-only"), 1);
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(url + "/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const modernHeaders = (method: string, extra: Record<string, string> = {}) =>
    ({
      Authorization: "Bearer " + issued.token,
      "MCP-Protocol-Version": MODERN_VERSION,
      "Mcp-Method": method,
      ...extra,
    }) as Record<string, string>;

  try {
    // 1. Unauthenticated modern request: 401 with a Bearer challenge.
    const denied = await post(modernBody(1, "server/discover"), {
      ...modernHeaders("server/discover"),
      Authorization: "",
    });
    assert.equal(denied.status, 401);
    assert.match(
      denied.headers.get("www-authenticate") ?? "",
      /Bearer realm="dbmux"/,
    );

    // 2. server/discover is served by the modern path with cache hints.
    const discover = await post(
      modernBody(2, "server/discover"),
      modernHeaders("server/discover"),
    );
    assert.equal(discover.status, 200);
    const discovered = await discover.json();
    assert.equal(discovered.result.resultType, "complete");
    assert.ok(
      Array.isArray(discovered.result.supportedVersions) &&
        discovered.result.supportedVersions.includes(MODERN_VERSION),
    );
    assert.equal(discovered.result.cacheScope, "private");
    assert.ok(discovered.result.ttlMs >= 0);
    assert.ok(discovered.result.capabilities);
    assert.match(JSON.stringify(discovered), /dbmux/);

    // 3. tools/list carries the configured deterministic order and cache hint.
    const list = await post(
      modernBody(3, "tools/list"),
      modernHeaders("tools/list"),
    );
    assert.equal(list.status, 200);
    const listed = await list.json();
    assert.equal(listed.result.resultType, "complete");
    assert.equal(listed.result.ttlMs, 60000);
    assert.equal(listed.result.cacheScope, "private");
    const toolNames = listed.result.tools.map((t: { name: string }) => t.name);
    assert.ok(toolNames.includes("db_connections"));
    assert.ok(toolNames.includes("db_query"));

    // 4. Missing MCP-Protocol-Version header: HeaderMismatch (-32020, HTTP 400).
    const noHeader = await post(modernBody(4, "server/discover"), {
      Authorization: "Bearer " + issued.token,
      "Mcp-Method": "server/discover",
    });
    assert.equal(noHeader.status, 400);
    const mismatch = await noHeader.json();
    assert.equal(mismatch.error.code, -32020);

    // 5. Modern header but no envelope claim in the body: Invalid params.
    const noEnvelope = await post(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "server/discover",
        params: {},
      },
      {
        Authorization: "Bearer " + issued.token,
        "MCP-Protocol-Version": MODERN_VERSION,
        "Mcp-Method": "server/discover",
      },
    );
    assert.equal(noEnvelope.status, 400);
    const invalid = await noEnvelope.json();
    assert.equal(invalid.error.code, -32602);

    // 6. Legacy 2025-era handshake keeps working through the stateless
    // fallback (no initialize removal for older clients).
    const legacy = await post(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy-probe", version: "1.0.0" },
        },
      },
      { Authorization: "Bearer " + issued.token },
    );
    assert.equal(legacy.status, 200);
    // The 2025-era path streams SSE frames rather than a single JSON body.
    const raw = await legacy.text();
    const dataLine = raw.split("\n").find((line) => line.startsWith("data:"));
    assert.ok(dataLine, "expected an SSE data frame from the legacy path");
    const initialized = JSON.parse(dataLine.slice(5).trim());
    assert.equal(initialized.result.serverInfo.name, "dbmux");
  } finally {
    await new Promise<void>((r) => http.close(() => r()));
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true });
  }
});
