import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Gateway } from "../services/gateway.js";
import type { Identity } from "../security/auth.js";
import { registerTools } from "../mcp/tools.js";

export function createMcp(gateway?: Gateway, identity?: Identity) {
  const server = new McpServer(
    { name: "dbmux", version: "0.1.0" },
    {
      instructions:
        "Inspect schema before changes. Bind values. Preview risks, take snapshots, inspect dependencies, and prefer migrations. Oracle DDL commits implicitly. Tokens never reveal database credentials.",
    },
  );
  server.registerTool(
    "db_gateway_info",
    {
      description:
        "Describe this development database gateway and its supported engines.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            name: "DBMux",
            engines: ["oracle", "postgres"],
            credentials: "server-only",
          }),
        },
      ],
    }),
  );
  if (gateway && identity) registerTools(server, gateway, identity);
  return server;
}
