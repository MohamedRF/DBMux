import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../src/security/encryption.js";
import { Store } from "../src/storage/sqlite.js";
import { foundationApp } from "../src/server/http.js";

test("vault authenticates ciphertext and SQLite persists metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "dbmux-"));
  const vault = new Vault(randomBytes(32));
  const store = new Store(dir, vault);
  try {
    const value = vault.seal({ password: "synthetic-test-value" });
    assert.ok(!value.includes("synthetic-test-value"));
    assert.deepEqual(vault.open(value), { password: "synthetic-test-value" });
    assert.throws(() => new Vault(randomBytes(32)).open(value));
    store.put("test", "one", { ok: true });
    assert.deepEqual(store.get("test", "one"), { ok: true });
    assert.deepEqual(store.consume("test", "one"), { ok: true });
    assert.equal(store.get("test", "one"), undefined);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});
test("public health works and MCP requires authentication", async () => {
  const server = foundationApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(url + "/health")).status, 200);
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
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
