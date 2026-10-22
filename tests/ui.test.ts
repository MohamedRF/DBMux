import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const installationPath = new URL("../src/ui/installation.js", import.meta.url)
  .href;
const { clientConfiguration, clients, shellCommands, teamHandoff } =
  await import(installationPath);
const endpoint = "https://gateway.example.test/mcp";

test("installation generates the correct environment reference for each HTTP client", () => {
  for (const client of ["Claude Code", "Cursor", "VS Code", "Generic MCP"]) {
    const config = JSON.parse(clientConfiguration(client, endpoint));
    const remote = (config.mcpServers ?? config.servers)["dbmux-dev"];
    assert.equal(remote.url, endpoint);
    assert.equal(
      remote.headers.Authorization,
      client === "Cursor" || client === "VS Code"
        ? "Bearer ${env:DB_MCP_TOKEN}"
        : "Bearer ${DB_MCP_TOKEN}",
    );
    if (client === "Claude Code" || client === "VS Code")
      assert.equal(remote.type, "http");
  }
  const codex = clientConfiguration("Codex", endpoint);
  assert.match(codex, /bearer_token_env_var = "DB_MCP_TOKEN"/);
  assert.ok(codex.includes(`url = ${JSON.stringify(endpoint)}`));
  const escaped = clientConfiguration(
    "Codex",
    'https://example.test/"quoted"/mcp',
  );
  assert.ok(escaped.includes('url = "https://example.test/\\"quoted\\"/mcp"'));
});

test("STDIO configuration inherits credentials without embedding a placeholder token", () => {
  const bridge = JSON.parse(clientConfiguration("STDIO Bridge", endpoint))
    .mcpServers["dbmux-dev"];
  assert.equal(bridge.command, "node");
  assert.deepEqual(bridge.args, [
    "/absolute/path/to/dbmux/bridge/index.mjs",
    "--url",
    endpoint,
  ]);
  assert.equal(bridge.env, undefined);
  assert.match(clients["STDIO Bridge"].instructions, /inherit DB_MCP_TOKEN/);
});

test("team handoff includes selected client and public guide with token placeholders only", () => {
  for (const client of Object.keys(clients)) {
    const handoff = teamHandoff(
      endpoint,
      client,
      "https://gateway.example.test/guide.html#developers",
    );
    assert.ok(handoff.includes(endpoint));
    assert.ok(handoff.includes("/guide.html#developers"));
    assert.ok(handoff.includes(clientConfiguration(client, endpoint)));
    assert.ok(handoff.includes("personal token"));
    for (const command of Object.values(shellCommands))
      assert.ok(handoff.includes(command));
    assert.match(handoff, /Never commit tokens/);
  }
});

function clipboardHarness(writeText: (text: string) => Promise<void>) {
  const messages: string[] = [];
  const timers: Array<() => void> = [];
  const source = readFileSync(
    new URL("../src/ui/clipboard.js", import.meta.url),
    "utf8",
  );
  const copy = runInNewContext(
    source.replace("export async function", "async function") + "\ncopyText;",
    {
      navigator: { clipboard: { writeText } },
      setTimeout: (fn: () => void) => timers.push(fn),
    },
  );
  return {
    copy,
    messages,
    timers,
    notify: (text: string) => messages.push(text),
  };
}

test("copy uses exact content and resets button feedback", async () => {
  const copied: string[] = [];
  const harness = clipboardHarness(async (text) => {
    copied.push(text);
  });
  const button = { textContent: "Copy configuration", disabled: false };
  await harness.copy("line one\nline two", button, harness.notify);
  assert.deepEqual(copied, ["line one\nline two"]);
  assert.equal(button.textContent, "Copied ✓");
  assert.equal(button.disabled, true);
  harness.timers[0]!();
  assert.equal(button.textContent, "Copy configuration");
  assert.equal(button.disabled, false);
});

test("copy rejects empty values and explains denied clipboard access without leaking content", async () => {
  let calls = 0;
  const harness = clipboardHarness(async () => {
    calls++;
    throw new Error("private content");
  });
  await harness.copy(" ", null, harness.notify);
  assert.equal(calls, 0);
  assert.equal(harness.messages[0], "Nothing to copy yet.");
  await harness.copy("synthetic-value", null, harness.notify);
  assert.equal(calls, 1);
  assert.match(harness.messages[1]!, /copy it manually/);
  assert.ok(!harness.messages.join(" ").includes("private content"));
  assert.equal(harness.timers.length, 0);
});

interface ThemeHarness {
  root: { dataset: Record<string, string> };
  store: Map<string, string>;
  buttons: Array<{ dataset: { themeChoice: string }; pressed: string | null }>;
}

function themeHarness(
  stored: string | null,
  systemDark: boolean,
): ThemeHarness {
  const store = new Map<string, string>();
  if (stored !== null) store.set("dbmux.theme", stored);
  const root = { dataset: {} as Record<string, string> };
  const buttons: ThemeHarness["buttons"] = [];
  const source = readFileSync(
    new URL("../src/ui/theme.js", import.meta.url),
    "utf8",
  );
  runInNewContext(source, {
    document: {
      documentElement: root,
      readyState: "complete",
      addEventListener: () => {},
      querySelectorAll: () => buttons,
    },
    window: {
      matchMedia: () => ({ matches: systemDark, addEventListener: () => {} }),
      addEventListener: () => {},
    },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  });
  return { root, store, buttons };
}

test("theme resolves the system preference when nothing is stored", () => {
  const dark = themeHarness(null, true);
  assert.equal(dark.root.dataset.theme, "dark");
  assert.equal(dark.root.dataset.themePreference, "system");
  const light = themeHarness(null, false);
  assert.equal(light.root.dataset.theme, "light");
  assert.equal(light.root.dataset.themePreference, "system");
});

test("theme honours a stored preference and ignores unusable values", () => {
  const stored = themeHarness("light", true);
  assert.equal(stored.root.dataset.theme, "light");
  assert.equal(stored.root.dataset.themePreference, "light");
  const invalid = themeHarness("neon", true);
  assert.equal(invalid.root.dataset.theme, "dark");
  assert.equal(invalid.root.dataset.themePreference, "system");
});
