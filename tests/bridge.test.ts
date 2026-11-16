import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/client/stdio";
import { Store } from "../src/storage/sqlite.js";
import { Vault } from "../src/security/encryption.js";
import { Auth } from "../src/security/auth.js";
import { ConnectionManager } from "../src/database/manager.js";
import { Gateway } from "../src/services/gateway.js";
import { permissions } from "../src/security/permissions.js";
import { createApp } from "../src/server/http.js";
import type { Config } from "../src/config/index.js";

const bridgePath = resolve(process.cwd(), "bridge", "index.mjs");

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms),
    ),
  ]);
}

async function withTestServer(
  run: (context: {
    url: string;
    auth: Auth;
    gateway: Gateway;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "dbmux-bridge-"));
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
  await new Promise<void>((resolve) => http.once("listening", resolve));
  const address = http.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await run({ url, auth, gateway });
  } finally {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await gateway.close().catch(() => {});
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function bridgeTransport(url: string, token: string | undefined) {
  const options: StdioServerParameters = {
    command: process.execPath,
    args: [bridgePath, "--url", url],
    env: token === undefined ? {} : { DB_MCP_TOKEN: token },
    stderr: "pipe",
  };
  const transport = new StdioClientTransport(options);
  let stderr = "";
  transport.stderr?.on("data", (chunk) => (stderr += chunk));
  return { transport, stderr: () => stderr };
}

test("bridge package is publish-ready: versioned, executable, minimal contents", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), "bridge", "package.json"), "utf8"),
  );
  assert.equal(manifest.name, "@dbmux/db-mcp-bridge");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.bin["db-mcp-bridge"], "index.mjs");
  assert.deepEqual(manifest.files, ["index.mjs", "README.md", "LICENSE"]);
  assert.ok(String(manifest.description).includes("no database drivers"));
  const source = readFileSync(bridgePath, "utf8");
  assert.ok(source.startsWith("#!/usr/bin/env node"));
});

test("STDIO client connects through the bridge, discovers tools and calls db_connections", async () => {
  await withTestServer(async ({ url, auth, gateway }) => {
    await gateway.manager.save({
      id: "app",
      name: "App",
      engine: "postgres",
      host: "localhost",
      port: 5432,
      database: "dev",
      username: "dev",
      password: "synthetic-password-never-return",
      enabled: true,
      permissions: permissions("read-only"),
      policy: { allowedSchemas: ["public"] },
    });
    const issued = auth.create("Alice", ["app"], permissions("read-only"), 1);
    const { transport, stderr } = bridgeTransport(url + "/mcp", issued.token);
    const client = new Client({ name: "bridge-e2e", version: "1.0.0" });
    try {
      await withTimeout(client.connect(transport), 10000, "bridge connect");
      const tools = await withTimeout(client.listTools(), 10000, "tools/list");
      assert.ok(tools.tools.some((tool) => tool.name === "db_connections"));
      const result = await withTimeout(
        client.callTool({ name: "db_connections", arguments: {} }),
        10000,
        "db_connections",
      );
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((item) =>
          item && typeof item === "object" && "text" in item
            ? String((item as { text: unknown }).text)
            : "",
        )
        .join("");
      const parsed: unknown = JSON.parse(text);
      assert.ok(Array.isArray(parsed));
      assert.ok(
        parsed.some(
          (entry) => entry && typeof entry === "object" && entry.id === "app",
        ),
      );
      assert.ok(!text.includes("synthetic-password-never-return"));
    } finally {
      await client.close().catch(() => {});
      assert.equal(stderr(), "");
    }
  });
});

test("bridge stdout carries MCP frames only — every line parses as JSON-RPC", async () => {
  await withTestServer(async ({ url, auth }) => {
    const issued = auth.create("Alice", [], permissions("read-only"), 1);
    const child = spawn(process.execPath, [bridgePath, "--url", url + "/mcp"], {
      env: { DB_MCP_TOKEN: issued.token },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    const initialize =
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "raw-probe", version: "1.0.0" },
        },
      }) + "\n";
    child.stdin.write(initialize);
    await new Promise<void>((resolve) => setTimeout(resolve, 2500));
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
    assert.ok(lines.length > 0, "bridge produced no output");
    for (const line of lines) {
      const frame: unknown = JSON.parse(line);
      assert.equal((frame as { jsonrpc?: string }).jsonrpc, "2.0");
    }
  });
});

test("bridge exits non-zero with a diagnostic for rejected credentials, without leaking the token", async () => {
  await withTestServer(async ({ url }) => {
    const { transport, stderr } = bridgeTransport(
      url + "/mcp",
      "mcp_live_this-token-is-rejected",
    );
    const client = new Client({ name: "bridge-denied", version: "1.0.0" });
    await assert.rejects(
      withTimeout(client.connect(transport), 10000, "denied connect"),
    );
    await client.close().catch(() => {});
    const diagnostics = stderr();
    assert.ok(diagnostics.length > 0, "expected a stderr diagnostic");
    assert.ok(!diagnostics.includes("mcp_live_this-token-is-rejected"));
  });
});

test("bridge reports an unavailable endpoint without hanging", async () => {
  // Bind then release a loopback port to obtain a definitely-closed endpoint.
  const probe = spawn(
    process.execPath,
    [
      "-e",
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));process.exit(0)})",
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const port = await new Promise<number>((resolve, reject) => {
    let output = "";
    probe.stdout.on("data", (chunk: Buffer) => (output += chunk));
    probe.once("exit", () => resolve(Number(output)));
    probe.once("error", reject);
  });
  const { transport, stderr } = bridgeTransport(
    `http://127.0.0.1:${port}/mcp`,
    "synthetic-token",
  );
  const client = new Client({ name: "bridge-down", version: "1.0.0" });
  await assert.rejects(
    withTimeout(client.connect(transport), 10000, "unreachable connect"),
  );
  await client.close().catch(() => {});
  assert.ok(stderr().length > 0, "expected a stderr diagnostic");
});

test("bridge enforces the HTTPS-or-loopback policy and requires DB_MCP_TOKEN", async () => {
  const run = (args: string[], env: NodeJS.ProcessEnv) =>
    new Promise<{ code: number | null; stderr: string }>((resolvePromise) => {
      const child = spawn(process.execPath, [bridgePath, ...args], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
      child.once("exit", (code) => resolvePromise({ code, stderr }));
    });
  const insecure = await run(["--url", "http://10.0.0.8:3001/mcp"], {
    DB_MCP_TOKEN: "synthetic-token",
  });
  assert.equal(insecure.code, 1);
  assert.match(insecure.stderr, /HTTPS, or HTTP on loopback only/);
  const credentialed = await run(
    ["--url", "https://user:pass@dbmcp.example.edu/mcp"],
    { DB_MCP_TOKEN: "synthetic-token" },
  );
  assert.equal(credentialed.code, 1);
  const noToken = await run(["--url", "https://dbmcp.example.edu/mcp"], {});
  assert.equal(noToken.code, 1);
  assert.match(noToken.stderr, /DB_MCP_TOKEN/);
});
