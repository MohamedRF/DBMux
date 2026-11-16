import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
import {
  DOCTOR_EXIT,
  classifyError,
  resolveEndpoint,
  runDoctor,
} from "../src/doctor.js";
import { SdkErrorCode, SdkHttpError } from "@modelcontextprotocol/client";
import type { Config } from "../src/config/index.js";

function collect() {
  const lines: string[] = [];
  return {
    lines,
    write: (line: string) => {
      lines.push(line);
    },
    text: () => lines.join("\n"),
  };
}

async function withTestServer(
  run: (context: {
    url: string;
    auth: Auth;
    gateway: Gateway;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "dbmux-doctor-"));
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
    await new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve())),
    );
    await gateway.close().catch(() => {});
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("doctor reports success with the visible connection list and never prints the token", async () => {
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
    const output = collect();
    const code = await runDoctor({
      url: url + "/mcp",
      env: { DB_MCP_TOKEN: issued.token },
      write: output.write,
      timeoutMs: 10000,
    });
    assert.equal(code, DOCTOR_EXIT.OK);
    const text = output.text();
    assert.match(text, /db_connections/);
    assert.match(text, /app \(postgres\)/);
    assert.ok(!text.includes(issued.token));
    assert.ok(!text.includes("synthetic-password-never-return"));
  });
});

test("doctor reports successful access with zero visible connections", async () => {
  await withTestServer(async ({ url, auth }) => {
    const issued = auth.create("Alice", [], permissions("read-only"), 1);
    const output = collect();
    const code = await runDoctor({
      url: url + "/mcp",
      env: { DB_MCP_TOKEN: issued.token },
      write: output.write,
      timeoutMs: 10000,
    });
    assert.equal(code, DOCTOR_EXIT.NO_CONNECTIONS);
    assert.match(output.text(), /zero connections/i);
  });
});

test("doctor reports rejected credentials for a missing, expired or revoked token", async () => {
  await withTestServer(async ({ url, auth }) => {
    const output = collect();
    const code = await runDoctor({
      url: url + "/mcp",
      env: { DB_MCP_TOKEN: "mcp_live_not-a-real-token" },
      write: output.write,
      timeoutMs: 10000,
    });
    assert.equal(code, DOCTOR_EXIT.AUTH);
    assert.match(output.text(), /rejected|token/i);
    assert.ok(!output.text().includes("mcp_live_not-a-real-token"));
    const issued = auth.create("Bob", [], permissions("read-only"), 1);
    auth.revoke(issued.id);
    const revoked = collect();
    const revokedCode = await runDoctor({
      url: url + "/mcp",
      env: { DB_MCP_TOKEN: issued.token },
      write: revoked.write,
      timeoutMs: 10000,
    });
    assert.equal(revokedCode, DOCTOR_EXIT.AUTH);
  });
});

test("doctor reports network failure for an unreachable endpoint", async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address() as AddressInfo;
  const closed = `http://127.0.0.1:${address.port}/mcp`;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  const output = collect();
  const code = await runDoctor({
    url: closed,
    env: { DB_MCP_TOKEN: "synthetic-token" },
    write: output.write,
    timeoutMs: 8000,
  });
  assert.equal(code, DOCTOR_EXIT.NETWORK);
  assert.match(output.text(), /could not reach|network/i);
});

test("doctor refuses redirects and never forwards the Authorization header", async () => {
  const seen: Array<{ url: string; authorization: string | undefined }> = [];
  const target = createServer((request, response) => {
    seen.push({
      url: request.url ?? "",
      authorization: request.headers.authorization,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const targetPort = (target.address() as AddressInfo).port;
  const redirector = createServer((request, response) => {
    response.writeHead(302, {
      location: `http://127.0.0.1:${targetPort}/mcp`,
    });
    response.end();
  });
  await new Promise<void>((resolve) =>
    redirector.listen(0, "127.0.0.1", resolve),
  );
  const redirectorPort = (redirector.address() as AddressInfo).port;
  try {
    const output = collect();
    const code = await runDoctor({
      url: `http://127.0.0.1:${redirectorPort}/mcp`,
      env: { DB_MCP_TOKEN: "synthetic-redirect-token" },
      write: output.write,
      timeoutMs: 8000,
    });
    assert.equal(code, DOCTOR_EXIT.NETWORK);
    assert.match(output.text(), /redirect/i);
    assert.equal(seen.length, 0);
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => target.close(() => resolve())),
      new Promise<void>((resolve) => redirector.close(() => resolve())),
    ]);
  }
});

test("doctor reports protocol failure when the endpoint answers but is not MCP", async () => {
  const stub: Server = createServer((request, response) => {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "NOPE" } }));
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const address = stub.address() as AddressInfo;
  try {
    const output = collect();
    const code = await runDoctor({
      url: `http://127.0.0.1:${address.port}/mcp`,
      env: { DB_MCP_TOKEN: "synthetic-token" },
      write: output.write,
      timeoutMs: 8000,
    });
    assert.equal(code, DOCTOR_EXIT.PROTOCOL);
  } finally {
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  }
});

test("doctor usage errors: missing token, non-loopback http, embedded credentials, query strings", async () => {
  for (const [url, env, expected] of [
    ["https://dbmcp.example.edu/mcp", {}, DOCTOR_EXIT.USAGE],
    [
      "http://10.0.0.8:3001/mcp",
      { DB_MCP_TOKEN: "synthetic" },
      DOCTOR_EXIT.USAGE,
    ],
    [
      "https://user:pass@dbmcp.example.edu/mcp",
      { DB_MCP_TOKEN: "synthetic" },
      DOCTOR_EXIT.USAGE,
    ],
    [
      "https://dbmcp.example.edu/mcp?token=x",
      { DB_MCP_TOKEN: "synthetic" },
      DOCTOR_EXIT.USAGE,
    ],
    ["not a url", { DB_MCP_TOKEN: "synthetic" }, DOCTOR_EXIT.USAGE],
  ] as const) {
    const output = collect();
    const code = await runDoctor({
      url,
      env,
      write: output.write,
      timeoutMs: 5000,
    });
    assert.equal(code, expected, url);
    assert.ok(!output.text().includes("synthetic"));
  }
});

test("resolveEndpoint normalises base URLs and keeps explicit /mcp paths", () => {
  assert.equal(
    resolveEndpoint("https://dbmcp.example.edu").endpoint?.pathname,
    "/mcp",
  );
  assert.equal(
    resolveEndpoint("https://dbmcp.example.edu/").endpoint?.pathname,
    "/mcp",
  );
  assert.equal(
    resolveEndpoint("https://dbmcp.example.edu/mcp/").endpoint?.pathname,
    "/mcp",
  );
  assert.equal(
    resolveEndpoint("http://localhost:3000").endpoint?.pathname,
    "/mcp",
  );
  assert.equal(
    resolveEndpoint("http://[::1]:3000/mcp").endpoint?.pathname,
    "/mcp",
  );
  assert.ok(resolveEndpoint("ftp://dbmcp.example.edu/mcp").error);
});

test("classifyError maps HTTP 401/403 to auth, plumbing failures to network and others to protocol", () => {
  const unauthorized = classifyError(
    new SdkHttpError(SdkErrorCode.ClientHttpAuthentication, "unauthorized", {
      status: 401,
    }),
  );
  assert.equal(unauthorized.exitCode, DOCTOR_EXIT.AUTH);
  const forbidden = classifyError(
    new SdkHttpError(SdkErrorCode.ClientHttpForbidden, "forbidden", {
      status: 403,
    }),
  );
  assert.equal(forbidden.exitCode, DOCTOR_EXIT.AUTH);
  const serverError = classifyError(
    new SdkHttpError(SdkErrorCode.ClientHttpUnexpectedContent, "oops", {
      status: 500,
    }),
  );
  assert.equal(serverError.exitCode, DOCTOR_EXIT.PROTOCOL);
  const network = classifyError(
    new TypeError("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND dbmux.internal"), {
        code: "ENOTFOUND",
      }),
    }),
  );
  assert.equal(network.exitCode, DOCTOR_EXIT.NETWORK);
  const tls = classifyError(
    new TypeError("fetch failed", {
      cause: new Error("self-signed certificate in certificate chain"),
    }),
  );
  assert.equal(tls.exitCode, DOCTOR_EXIT.NETWORK);
  const redirect = classifyError(new TypeError("redirect mode is not follow"));
  assert.equal(redirect.exitCode, DOCTOR_EXIT.NETWORK);
});
