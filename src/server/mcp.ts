import { McpServer } from "@modelcontextprotocol/server";
import type { AuthInfo, McpServerFactory } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Gateway } from "../services/gateway.js";
import type { Identity } from "../security/auth.js";
import { permissionKeys } from "../security/permissions.js";
import { GatewayError } from "../security/errors.js";
import { registerTools } from "../mcp/tools.js";

import { trackTool } from "../services/activity.js";
export function createMcp(gateway: Gateway, identity: Identity) {
  const server = new McpServer(
    { name: "dbmux", version: "0.2.0" },
    {
      instructions:
        "Inspect schema before changes. Bind values. Preview risks, take snapshots, inspect dependencies, and prefer migrations. Oracle DDL commits implicitly. Tokens never reveal database credentials.",
      // 2026-07-28 (SEP-2549): freshness hints for cacheable results. All
      // hints stay `private` because tool and resource output is scoped to
      // the caller's token; clients may cache briefly, shared caches may not.
      cacheHints: {
        "tools/list": { ttlMs: 60000, cacheScope: "private" },
        "resources/list": { ttlMs: 5000, cacheScope: "private" },
        "resources/templates/list": { ttlMs: 5000, cacheScope: "private" },
        "prompts/list": { ttlMs: 60000, cacheScope: "private" },
        "server/discover": { ttlMs: 60000, cacheScope: "private" },
      },
    },
  );
  server.registerTool(
    "db_gateway_info",
    {
      description:
        "Describe this development database gateway and its supported engines.",
      inputSchema: z.object({}),
    },
    async () => {
      const info = () =>
        Promise.resolve({
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                name: "DBMux",
                engines: ["oracle", "postgres"],
                credentials: "server-only",
              }),
            },
          ],
        });
      return trackTool(
        gateway.manager.store,
        identity,
        "db_gateway_info",
        async () => {
          gateway.auth.current(identity.id);
          return info();
        },
      );
    },
  );
  registerTools(server, gateway, identity);
  return server;
}

/**
 * Build the `AuthInfo` the MCP handler (and, transitively, tool handlers via
 * `ctx.http.authInfo`) sees for a DBMux token. Scopes mirror the token's
 * permission grants so scope challenges carry meaningful data; `clientId`
 * carries the token id so the factory can re-resolve the identity per
 * request. The raw token is kept in-memory only and never reaches a tool
 * result, log line or the wire.
 */
export function authInfoFor(raw: string, identity: Identity): AuthInfo {
  return {
    token: raw,
    clientId: identity.id,
    scopes: permissionKeys
      .filter((key) => identity.permissions[key])
      .map((key) => `dbmux:${key}`),
    expiresAt: Math.floor(identity.expiresAt / 1000),
    extra: { name: identity.name },
  };
}

/**
 * Per-request server factory for `createMcpHandler`. One `McpServer` is built
 * per HTTP request (the 2026-07-28 model); the same factory backs `server/discover`
 * probes, modern requests and the 2025-era stateless fallback. The HTTP layer
 * has already authenticated the bearer — this re-resolves it (fail closed) and
 * additionally re-checks revocation/expiry on every tool call inside
 * `registerTools`/`db_gateway_info` via `gateway.auth.current`.
 */
export function createMcpFactory(gateway: Gateway): McpServerFactory {
  return (ctx) => {
    const info = ctx.authInfo;
    if (!info)
      throw new GatewayError(
        "UNAUTHORIZED",
        "Bearer authentication required.",
        401,
      );
    const identity = gateway.auth.current(info.clientId);
    return createMcp(gateway, identity);
  };
}
