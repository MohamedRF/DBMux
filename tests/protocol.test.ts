import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { Store } from "../src/storage/sqlite.js";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Vault } from "../src/security/encryption.js";
import { Auth } from "../src/security/auth.js";
import { ConnectionManager } from "../src/database/manager.js";
import { Gateway } from "../src/services/gateway.js";
import { permissions } from "../src/security/permissions.js";
import { createApp } from "../src/server/http.js";
import type { Config } from "../src/config/index.js";
test("real SDK v2 Streamable HTTP handshake, tools, resources, scopes and revocation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dbmux-protocol-"));
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
  } satisfies Config;
  const http = createApp(gateway, config).listen(0, "127.0.0.1");
  await new Promise<void>((r) => http.once("listening", r));
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const bridgeClient = new Client({ name: "bridge-test", version: "1.0.0" });
  try {
    assert.equal(
      (
        await fetch(url + "/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(url + "/health", {
          headers: { Origin: "https://evil.invalid" },
        })
      ).status,
      403,
    );
    const issued = auth.create("Test", [], permissions("read-only"), 1);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url + "/mcp"), {
        requestInit: { headers: { Authorization: "Bearer " + issued.token } },
      }),
    );
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "db_schema_diff"));
    assert.ok(tools.tools.length > 50);
    const result = await client.callTool({
      name: "db_connections",
      arguments: {},
    });
    assert.match(JSON.stringify(result), /\[\]/);
    const denied = await client.callTool({
      name: "db_query",
      arguments: { connectionId: "secret", sql: "SELECT 1" },
    });
    assert.equal(denied.isError, true);
    const resources = await client.listResources();
    assert.ok(resources.resources.some((r) => r.uri === "db://connections"));
    await bridgeClient.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          join(process.cwd(), "bridge", "index.mjs"),
          "--url",
          url + "/mcp",
        ],
        env: { DB_MCP_TOKEN: issued.token },
        stderr: "pipe",
      }),
    );
    assert.ok(
      (await bridgeClient.listTools()).tools.some(
        (t) => t.name === "db_schema_diff",
      ),
    );
    auth.revoke(issued.id);
    await assert.rejects(client.listTools());
  } finally {
    await bridgeClient.close();
    await client.close();
    await new Promise<void>((r) => http.close(() => r()));
    await gateway.close();
    store.close();
    rmSync(directory, { recursive: true });
  }
});
