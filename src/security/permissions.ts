import { z } from "zod";
export const permissionKeys = [
  "read",
  "insert",
  "update",
  "delete",
  "create",
  "alter",
  "drop",
  "truncate",
  "executeRoutine",
] as const;
export const permissionsSchema = z.object({
  read: z.boolean(),
  insert: z.boolean(),
  update: z.boolean(),
  delete: z.boolean(),
  create: z.boolean(),
  alter: z.boolean(),
  drop: z.boolean(),
  truncate: z.boolean(),
  executeRoutine: z.boolean(),
});
export type Permissions = z.infer<typeof permissionsSchema>;
export function permissions(
  level: "read-only" | "development-write" | "full-development",
): Permissions {
  return {
    read: true,
    insert: level !== "read-only",
    update: level !== "read-only",
    delete: level !== "read-only",
    create: level !== "read-only",
    alter: level !== "read-only",
    drop: level === "full-development",
    truncate: level === "full-development",
    executeRoutine: false,
  };
}
export function intersect(a: Permissions, b: Permissions): Permissions {
  return Object.fromEntries(
    permissionKeys.map((key) => [key, a[key] && b[key]]),
  ) as Permissions;
}
