import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = z
    .object({
      PORT: z.coerce.number().int().min(1).max(65535).default(3000),
      DATA_DIR: z.string().default("./data"),
      PUBLIC_URL: z.url().default("http://localhost:3000"),
      SETUP_TOKEN: z.string().min(24),
      QUERY_TIMEOUT_SECONDS: z.coerce
        .number()
        .int()
        .min(1)
        .max(300)
        .default(30),
      DDL_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(600).default(60),
      TRANSACTION_TIMEOUT_SECONDS: z.coerce
        .number()
        .int()
        .min(1)
        .max(3600)
        .default(300),
    })
    .parse(env);
  const key = (
    env.MCP_MASTER_KEY ??
    readFileSync(
      resolve(env.MCP_MASTER_KEY_FILE ?? "./secrets/mcp_master_key.txt"),
      "utf8",
    )
  ).trim();
  if (!/^[a-f\d]{64}$/i.test(key))
    throw new Error(
      "Master key must contain exactly 64 hexadecimal characters",
    );
  return { ...config, key: Buffer.from(key, "hex") };
}
export type Config = ReturnType<typeof loadConfig>;
