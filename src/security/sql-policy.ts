import type { Permissions } from "./permissions.js";
import { GatewayError } from "./errors.js";

export type Category =
  | "READ"
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "DDL_CREATE"
  | "DDL_ALTER"
  | "DDL_DROP"
  | "TRUNCATE"
  | "PLSQL"
  | "ADMIN"
  | "UNKNOWN";
export interface Classification {
  category: Category;
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  objectType?: string;
  target?: string;
  requiresConfirmation: boolean;
}
// Lexical scanning preserves quoted identifiers and hides strings/comments. Unsupported grammar fails closed.
export function tokens(sql: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i + 2);
      i = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) throw new GatewayError("INVALID_SQL", "Unclosed SQL comment");
      continue;
    }
    if (c === "'") {
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        if (sql[i] === "\\")
          throw new GatewayError(
            "UNSUPPORTED_SQL",
            "Backslash string escapes are not accepted",
          );
        i++;
      }
      if (!closed)
        throw new GatewayError("INVALID_SQL", "Unclosed SQL literal");
      out.push("?");
      continue;
    }
    if (c === '"') {
      let identifier = "";
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            identifier += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        identifier += sql[i++];
      }
      if (!closed || !/^[A-Za-z_][A-Za-z0-9_$#]*$/.test(identifier))
        throw new GatewayError(
          "UNSUPPORTED_SQL",
          "Unsupported quoted identifier",
        );
      out.push(identifier.toUpperCase());
      continue;
    }
    const dollar = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, i + dollar.length);
      if (end < 0)
        throw new GatewayError("INVALID_SQL", "Unclosed dollar quote");
      out.push("?");
      i = end + dollar.length;
      continue;
    }
    const word = sql.slice(i).match(/^[A-Za-z_][A-Za-z0-9_$#]*/)?.[0];
    if (word) {
      out.push(word.toUpperCase());
      i += word.length;
      continue;
    }
    out.push(c);
    i++;
  }
  return out;
}
export function classify(
  sql: string,
  engine?: "oracle" | "postgres",
): Classification {
  const t = tokens(sql);
  while (t.at(-1) === ";") t.pop();
  const routineHeader =
    t[0] === "CREATE" &&
    (t[1] === "OR" && t[2] === "REPLACE"
      ? ["PROCEDURE", "FUNCTION", "TRIGGER", "PACKAGE"].includes(t[3] ?? "")
      : ["PROCEDURE", "FUNCTION", "TRIGGER", "PACKAGE"].includes(t[1] ?? ""));
  const oracleDefinition =
    engine === "oracle" &&
    routineHeader &&
    t.slice(1).every((x) => x !== "CREATE") &&
    (t.at(-1) === "END" || t.at(-2) === "END");
  if (!t.length || (t.includes(";") && !oracleDefinition))
    return {
      category: "UNKNOWN",
      risk: "CRITICAL",
      requiresConfirmation: true,
    };
  const first = t[0];
  let category: Category = "UNKNOWN";
  let type: string | undefined;
  let target: string | undefined;
  if (first === "SELECT") category = "READ";
  if (first === "WITH") {
    let depth = 0;
    const top: string[] = [];
    for (const x of t) {
      if (x === "(") depth++;
      if (depth === 0) top.push(x);
      if (x === ")") depth--;
      if (depth < 0) break;
    }
    // Data-changing CTEs, nested DML and malformed CTEs are deliberately rejected.
    if (
      !t.some((x) =>
        ["INSERT", "UPDATE", "DELETE", "MERGE", "CALL"].includes(x),
      ) &&
      top.includes("SELECT")
    )
      category = "READ";
  }
  if (["INSERT", "UPDATE", "DELETE"].includes(first ?? ""))
    category = first as Category;
  if (
    ["BEGIN", "DECLARE", "DO", "CALL", "EXEC", "EXECUTE"].includes(first ?? "")
  )
    category = "PLSQL";
  if (
    [
      "GRANT",
      "REVOKE",
      "VACUUM",
      "ANALYZE",
      "COPY",
      "SET",
      "RESET",
      "COMMIT",
      "ROLLBACK",
      "SAVEPOINT",
      "LOCK",
      "SHUTDOWN",
    ].includes(first ?? "")
  )
    category = "ADMIN";
  if (["CREATE", "ALTER", "DROP", "TRUNCATE"].includes(first ?? "")) {
    let index = 1;
    if (t[index] === "OR" && t[index + 1] === "REPLACE") index += 2;
    if (t[index] === "UNIQUE") index++;
    type = t[index];
    index++;
    if (type === "PACKAGE" && t[index] === "BODY") index++;
    if (t[index] === "IF") index += t[index + 1] === "NOT" ? 3 : 2;
    target = t[index];
    if (t[index + 1] === ".") target += `.${t[index + 2]}`;
    category = first === "TRUNCATE" ? "TRUNCATE" : (`DDL_${first}` as Category);
    if (
      ![
        "TABLE",
        "INDEX",
        "SEQUENCE",
        "VIEW",
        "TRIGGER",
        "PROCEDURE",
        "FUNCTION",
        "PACKAGE",
        "MATERIALIZED",
      ].includes(type ?? "")
    )
      category = "ADMIN";
    if (type === "MATERIALIZED") {
      type = "MATERIALIZED VIEW";
      index++;
      target = t[index];
      if (t[index + 1] === ".") target += `.${t[index + 2]}`;
    }
  }
  if (category === "INSERT") {
    if (t[1] !== "INTO") category = "UNKNOWN";
    const index = 2;
    target = t[index];
    if (t[index + 1] === ".") target += `.${t[index + 2]}`;
  }
  if (category === "UPDATE") {
    target = t[1];
    if (t[2] === ".") target += `.${t[3]}`;
  }
  if (category === "DELETE") {
    if (t[1] !== "FROM") category = "UNKNOWN";
    target = t[2];
    if (t[3] === ".") target += `.${t[4]}`;
  }
  if (
    category === "READ" &&
    (t.includes("INTO") ||
      t.includes("NEXTVAL") ||
      t.includes("CURRVAL") ||
      t.includes("FOR") ||
      t.includes("CALL"))
  )
    category = "UNKNOWN";
  if (
    t.includes("DATABASE") ||
    t.includes("TABLESPACE") ||
    t.includes("DBLINK") ||
    t.includes("DATABASE_LINK")
  )
    category = "ADMIN";
  // PostgreSQL utility escape hatches and Oracle remote/synonym resolution cannot be safely scoped.
  if (
    t.includes("@") ||
    t.includes("CONCURRENTLY") ||
    (t.includes("USING") && category === "DELETE")
  )
    category = "UNKNOWN";
  let risk: Classification["risk"] = category === "READ" ? "LOW" : "MEDIUM";
  if (
    category === "DELETE" ||
    category === "DDL_DROP" ||
    (category === "DDL_ALTER" &&
      t.some((x) => ["DROP", "RENAME", "MODIFY", "TYPE"].includes(x)))
  )
    risk = "HIGH";
  if (
    category === "TRUNCATE" ||
    (category === "DDL_DROP" && type === "TABLE") ||
    ["PLSQL", "UNKNOWN", "ADMIN"].includes(category)
  )
    risk = "CRITICAL";
  if (["UPDATE", "DELETE"].includes(category) && !hasTopLevelWhere(t))
    risk = "CRITICAL";
  if (["TRIGGER", "PROCEDURE", "FUNCTION", "PACKAGE"].includes(type ?? ""))
    risk = "HIGH";
  return {
    category,
    risk,
    objectType: type,
    target,
    requiresConfirmation: risk === "HIGH" || risk === "CRITICAL",
  };
}
function hasTopLevelWhere(t: string[]): boolean {
  let depth = 0;
  for (const x of t) {
    if (x === "(") depth++;
    else if (x === ")") depth--;
    else if (x === "WHERE" && depth === 0) return true;
  }
  return false;
}
export interface PolicyConfig {
  engine?: "oracle" | "postgres";
  allowedSchemas: string[];
  protectedSchemas: string[];
  requireWhereForUpdate: boolean;
  requireWhereForDelete: boolean;
  disabledTools: string[];
  blockedTables: string[];
  blockedColumns: string[];
}
export function assertPolicy(
  sql: string,
  permissions: Permissions,
  config: PolicyConfig,
): Classification {
  const c = classify(sql, config.engine);
  const t = tokens(sql);
  if (t.includes("RETURNING"))
    throw new GatewayError(
      "UNSUPPORTED_SQL",
      "RETURNING is disabled to bound mutation responses. Query affected rows separately.",
    );
  const operation = c.category.startsWith("DDL_")
    ? c.category.slice(4).toLowerCase()
    : c.category.toLowerCase();
  const object = ["FUNCTION", "PROCEDURE", "PACKAGE"].includes(
    c.objectType ?? "",
  )
    ? "routine"
    : c.objectType?.toLowerCase();
  if (object && config.disabledTools.includes(`db_${operation}_${object}`))
    throw new GatewayError(
      "TOOL_DISABLED",
      "The corresponding object operation is disabled.",
    );

  const map: Partial<Record<Category, keyof Permissions>> = {
    READ: "read",
    INSERT: "insert",
    UPDATE: "update",
    DELETE: "delete",
    DDL_CREATE: "create",
    DDL_ALTER: "alter",
    DDL_DROP: "drop",
    TRUNCATE: "truncate",
  };
  const permission = map[c.category];
  if (!permission || !permissions[permission])
    throw new GatewayError(
      "MCP_DB_PERMISSION_DENIED",
      `${c.category} is disabled for this connection or token.`,
      403,
    );
  if (
    ((c.category === "UPDATE" && config.requireWhereForUpdate) ||
      (c.category === "DELETE" && config.requireWhereForDelete)) &&
    !hasTopLevelWhere(t)
  )
    throw new GatewayError(
      "WHERE_REQUIRED",
      "A top-level WHERE condition is required.",
    );
  const protectedSet = new Set([
    "SYS",
    "SYSTEM",
    "XDB",
    "MDSYS",
    "CTXSYS",
    "ORDSYS",
    "PG_CATALOG",
    "INFORMATION_SCHEMA",
    ...config.protectedSchemas.map((x) => x.toUpperCase()),
  ]);
  for (let i = 0; i < t.length; i++)
    if (t[i + 1] === "." && protectedSet.has(t[i]!))
      throw new GatewayError(
        "PROTECTED_SCHEMA",
        "Protected schemas cannot be accessed through SQL.",
      );
  for (const blocked of [...config.blockedTables, ...config.blockedColumns])
    if (t.includes(blocked.toUpperCase()))
      throw new GatewayError(
        "SENSITIVE_OBJECT",
        "Access to a configured sensitive object is disabled.",
      );
  if (config.blockedColumns.length && t.includes("*"))
    throw new GatewayError(
      "EXPLICIT_COLUMNS_REQUIRED",
      "Select explicit columns when sensitive columns are configured.",
    );
  for (let i = 0; i < t.length; i++)
    if (
      [
        "FROM",
        "JOIN",
        "INTO",
        "UPDATE",
        "REFERENCES",
        "TABLE",
        "SEQUENCE",
        "VIEW",
        "INDEX",
      ].includes(t[i]!) &&
      t[i + 2] === "."
    ) {
      const schema = t[i + 1]!;
      if (!config.allowedSchemas.some((s) => s.toUpperCase() === schema))
        throw new GatewayError(
          "SCHEMA_DENIED",
          "SQL references a relation outside configured schemas.",
        );
    }
  if (c.category === "READ") {
    const builtins = new Set([
      "COUNT",
      "SUM",
      "MIN",
      "MAX",
      "AVG",
      "COALESCE",
      "NVL",
      "NVL2",
      "NULLIF",
      "UPPER",
      "LOWER",
      "TRIM",
      "SUBSTR",
      "SUBSTRING",
      "LENGTH",
      "ROUND",
      "TRUNC",
      "TO_CHAR",
      "TO_DATE",
      "CAST",
      "EXTRACT",
      "IN",
      "EXISTS",
      "AS",
      "OVER",
      "PARTITION",
      "SELECT",
      "FROM",
      "JOIN",
      "FILTER",
      "GENERATE_SERIES",
      "ABS",
      "CEIL",
      "FLOOR",
      "CONCAT",
      "GREATEST",
      "LEAST",
    ]);
    for (let i = 0; i < t.length; i++)
      if (
        t[i + 1] === "(" &&
        /^[A-Z_]/.test(t[i]!) &&
        (!builtins.has(t[i]!) || t[i - 1] === ".")
      )
        throw new GatewayError(
          "FUNCTION_DENIED",
          "Arbitrary function calls are disabled in read queries.",
        );
  }
  if (c.category !== "READ") {
    if (
      !c.target ||
      !/^([A-Z_][A-Z0-9_$#]*\.)?[A-Z_][A-Z0-9_$#]*$/.test(c.target)
    )
      throw new GatewayError(
        "UNSUPPORTED_SQL",
        "Cannot safely identify the modification target.",
      );
    const targetSchema = c.target.includes(".")
      ? c.target.split(".")[0]!
      : config.allowedSchemas[0]?.toUpperCase();
    if (
      !targetSchema ||
      protectedSet.has(targetSchema) ||
      !config.allowedSchemas.some((x) => x.toUpperCase() === targetSchema)
    )
      throw new GatewayError(
        "SCHEMA_DENIED",
        "Modification target is outside allowed application schemas.",
      );
    if (t.includes("CASCADE"))
      throw new GatewayError(
        "UNSUPPORTED_SQL",
        "CASCADE is disabled; inspect dependencies and change objects explicitly.",
      );
  }
  return c;
}
