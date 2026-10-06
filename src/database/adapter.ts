import { z } from "zod";
import { permissionsSchema } from "../security/permissions.js";
export const connectionSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    name: z.string().min(1).max(100),
    engine: z.enum(["oracle", "postgres"]),
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535),
    database: z.string().min(1).max(128),
    username: z.string().min(1).max(128),
    password: z.string().min(1).max(1024),
    connectString: z.string().max(2000).optional(),
    sid: z.boolean().default(false),
    ssl: z.boolean().default(false),
    sslCa: z.string().max(20000).optional(),
    poolMin: z.number().int().min(0).max(20).default(0),
    poolMax: z.number().int().min(1).max(50).default(5),
    poolIncrement: z.number().int().min(1).max(10).default(1),
    poolTimeout: z.number().int().min(1).max(3600).default(60),
    connectionTimeout: z.number().int().min(1).max(60).default(10),
    enabled: z.boolean().default(false),
    permissions: permissionsSchema,
    policy: z.object({
      allowedSchemas: z
        .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_$#]*$/))
        .min(1)
        .max(20),
      protectedSchemas: z.array(z.string()).default([]),
      requireWhereForUpdate: z.boolean().default(true),
      requireWhereForDelete: z.boolean().default(true),
      disabledTools: z.array(z.string()).default([]),
      blockedTables: z.array(z.string()).default([]),
      blockedColumns: z.array(z.string()).default([]),
    }),
  })
  .refine((c) => c.poolMin <= c.poolMax, "Pool minimum exceeds maximum");
export type ConnectionConfig = z.infer<typeof connectionSchema>;
export type Binds =
  | Record<string, string | number | boolean | null>
  | Array<string | number | boolean | null>;
export interface QueryResult {
  columns: Array<{ name: string; type?: string }>;
  rows: Record<string, unknown>[];
  rowCount: number;
  executionMs: number;
  truncated: boolean;
}
export interface StatementResult {
  rowsAffected: number;
  executionMs: number;
  implicitCommit: boolean;
}
export type CatalogKind =
  | "schemas"
  | "tables"
  | "columns"
  | "constraintColumns"
  | "indexColumns"
  | "materializedViews"
  | "views"
  | "indexes"
  | "constraints"
  | "sequences"
  | "triggers"
  | "routines"
  | "source"
  | "dependencies"
  | "objects"
  | "enums"
  | "extensions"
  | "synonyms";
export interface CatalogFilter {
  schema?: string;
  table?: string;
  name?: string;
  query?: string;
  limit?: number;
  offset?: number;
}
export interface TransactionHandle {
  query(sql: string, binds: Binds, limit: number): Promise<QueryResult>;
  execute(sql: string, binds: Binds): Promise<StatementResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
export interface DatabaseAdapter {
  readonly engine: "oracle" | "postgres";
  testConnection(): Promise<Record<string, unknown>>;
  getServerInfo(): Promise<Record<string, unknown>>;
  catalog(kind: CatalogKind, filter: CatalogFilter): Promise<QueryResult>;
  describeTable(
    schema: string,
    table: string,
  ): Promise<Record<string, unknown>>;
  executeQuery(sql: string, binds: Binds, limit: number): Promise<QueryResult>;
  executeStatement(sql: string, binds: Binds): Promise<StatementResult>;
  beginTransaction(): Promise<TransactionHandle>;
  explain(sql: string, binds: Binds): Promise<QueryResult>;
  quote(identifier: string): string;
  close(): Promise<void>;
}
export function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_$#]*$/.test(identifier))
    throw new Error("Invalid identifier");
  return '"' + identifier + '"';
}
export function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { binary: true, bytes: value.length };
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalize(v)]),
    );
  if (typeof value === "string" && value.length > 16384)
    return {
      text: value.slice(0, 16384),
      truncated: true,
      length: value.length,
    };
  return value;
}
