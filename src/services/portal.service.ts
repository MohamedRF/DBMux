import type { ConnectionManager } from "../database/manager.js";
import type { Auth } from "../security/auth.js";
import {
  intersect,
  permissionKeys,
  type Permissions,
} from "../security/permissions.js";

type PublicConnection = ReturnType<ConnectionManager["list"]>[number];
type PublicToken = ReturnType<Auth["list"]>[number];
export interface ConnectionHealth {
  checkedAt: string;
  connected: boolean;
  latencyMs?: number;
  errorCode?: string;
}

export function effectiveTokenAccess(
  token: PublicToken,
  connections: PublicConnection[],
  now = Date.now(),
) {
  const byId = new Map(
    connections.map((connection) => [connection.id, connection]),
  );
  return token.connections.map((id) => {
    const connection = byId.get(id);
    const unavailable = token.revoked
      ? "Token revoked"
      : token.expiresAt <= now
        ? "Token expired"
        : !connection
          ? "Connection removed"
          : !connection.enabled
            ? "MCP disabled"
            : null;
    const grants = connection
      ? intersect(token.permissions, connection.permissions)
      : token.permissions;
    const permissions = Object.fromEntries(
      permissionKeys.map((key) => [
        key,
        !unavailable && key !== "executeRoutine" && grants[key],
      ]),
    ) as Permissions;
    return {
      connectionId: id,
      name: connection?.name ?? id,
      engine: connection?.engine ?? null,
      unavailable,
      permissions,
      allowedSchemas: connection?.policy.allowedSchemas ?? [],
      disabledTools: connection?.policy.disabledTools ?? [],
      requireWhereForUpdate: connection?.policy.requireWhereForUpdate ?? true,
      requireWhereForDelete: connection?.policy.requireWhereForDelete ?? true,
    };
  });
}

export function portalDashboard(
  manager: ConnectionManager,
  auth: Auth,
  timezoneOffset: number,
  snapshotId: number,
  now = Date.now(),
) {
  const dayMs = 86400000;
  const offsetMs = timezoneOffset * 60000;
  const localDay = Math.floor((now + offsetMs) / dayMs) * dayMs;
  const todayStart = new Date(localDay - offsetMs).toISOString();
  const weekStart = new Date(localDay - offsetMs - 6 * dayMs).toISOString();
  const slowThresholdMs = 1000;
  const activity = manager.store.dashboardActivity(
    todayStart,
    weekStart,
    timezoneOffset,
    slowThresholdMs,
    snapshotId,
  );
  const connections = manager.list();
  const tokens = auth.list();
  const healthById = new Map(
    manager.store
      .listEntries<ConnectionHealth>("connection-health")
      .map((entry) => [entry.id, entry.value]),
  );
  const active = tokens.filter(
    (token) => !token.revoked && token.expiresAt > now,
  );
  const dailyByDate = new Map(
    activity.daily.map((row) => [String(row.date), row]),
  );
  return {
    generatedAt: new Date(now).toISOString(),
    todayStart,
    timezoneOffset,
    slowThresholdMs,
    counts: {
      connections: connections.length,
      enabled: connections.filter((connection) => connection.enabled).length,
      activeTokens: active.length,
    },
    metrics: activity.metrics,
    daily: Array.from({ length: 7 }, (_, index) => {
      const date = new Date(localDay - (6 - index) * dayMs)
        .toISOString()
        .slice(0, 10);
      const row = dailyByDate.get(date);
      return {
        date,
        requests: Number(row?.requests ?? 0),
        tools: Number(row?.tools ?? 0),
        failedTools: Number(row?.failedTools ?? 0),
      };
    }),
    slow: activity.slow,
    expiringTokens: active
      .filter((token) => token.expiresAt <= now + 7 * dayMs)
      .sort((a, b) => a.expiresAt - b.expiresAt)
      .map((token) => ({
        id: token.id,
        name: token.name,
        expiresAt: token.expiresAt,
        connections: token.connections,
      })),
    connections: connections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      engine: connection.engine,
      enabled: connection.enabled,
      health: healthById.get(connection.id) ?? null,
    })),
  };
}
