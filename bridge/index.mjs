#!/usr/bin/env node
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const index = process.argv.indexOf("--url");
const input = index >= 0 ? process.argv[index + 1] : undefined;
const token = process.env.DB_MCP_TOKEN;
if (!input || !token) {
  process.stderr.write(
    "Usage: db-mcp-bridge --url https://server/mcp; set DB_MCP_TOKEN\n",
  );
  process.exit(1);
}
let url;
try {
  url = new URL(input);
} catch {
  process.stderr.write("Invalid MCP URL\n");
  process.exit(1);
}
if (
  url.username ||
  url.password ||
  (url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ))
) {
  process.stderr.write(
    "Use HTTPS, or HTTP on loopback only. URL credentials are forbidden.\n",
  );
  process.exit(1);
}
const remote = new StreamableHTTPClientTransport(url, {
  requestInit: {
    headers: { Authorization: "Bearer " + token },
    redirect: "error",
  },
  fetch: (input, init) =>
    fetch(input, {
      ...init,
      signal: AbortSignal.any([
        AbortSignal.timeout(120000),
        ...(init?.signal ? [init.signal] : []),
      ]),
    }),
});
const local = new StdioServerTransport();
let stopping = false;
async function stop(code) {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([local.close(), remote.close()]);
  // Exit by draining the loop instead of calling process.exit()
  // mid-teardown: forcing exit while stdio handles are still closing
  // trips a libuv assertion on Windows. A short unref'd backstop keeps
  // a stuck handle from pinning the process forever.
  process.exitCode = code;
  const backstop = setTimeout(() => process.exit(code), 1000);
  backstop.unref();
}
function fail() {
  process.stderr.write(
    "MCP bridge transport failed. Check URL, token and server availability.\n",
  );
  void stop(1);
}
local.onmessage = (message) => {
  void remote.send(message).catch(fail);
};
remote.onmessage = (message) => {
  void local.send(message).catch(fail);
};
local.onerror = fail;
remote.onerror = fail;
local.onclose = () => void stop(0);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void stop(0));
try {
  await remote.start();
  await local.start();
} catch {
  fail();
}
