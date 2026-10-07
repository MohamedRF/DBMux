import express from "express";
import { z } from "zod";
import type { Gateway } from "../services/gateway.js";
import type { Config } from "../config/index.js";
import { permissionsSchema } from "../security/permissions.js";
import { hash } from "../security/encryption.js";
import { GatewayError, safeError } from "../security/errors.js";
import type { SavedConnection } from "../database/manager.js";
import { requestActivity } from "../services/activity.js";
import {
  effectiveTokenAccess,
  portalDashboard,
  type ConnectionHealth,
} from "../services/portal.service.js";
export const bearer = (req: express.Request) =>
  req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1] ?? "";
function attachRequestConnection(gateway: Gateway, id: string) {
  const activityId = requestActivity.getStore()?.activityId;
  if (activityId)
    gateway.manager.store.attachActivityConnection(activityId, id);
}
function streamNdjson(
  res: express.Response,
  next: express.NextFunction,
  filename: string,
  readPage: () => unknown[],
) {
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  const write = () => {
    if (res.destroyed) return;
    try {
      const rows = readPage();
      if (!rows.length) {
        res.end();
        return;
      }
      if (!res.write(rows.map((row) => JSON.stringify(row) + "\n").join("")))
        res.once("drain", write);
      else setImmediate(write);
    } catch (error) {
      if (res.headersSent) res.destroy();
      next(error);
    }
  };
  write();
}
export function adminRouter(gateway: Gateway, config: Config) {
  const router = express.Router();
  router.get("/setup", (_req, res) =>
    res.json({
      setupRequired: !gateway.manager.store.get("admin", "singleton"),
      masterKeyConfigured: true,
    }),
  );
  const credentials = z.object({
    name: z.string().min(1).max(100),
    password: z.string().min(14).max(256),
  });
  router.post("/setup", (req, res) => {
    if (hash(bearer(req)) !== hash(config.SETUP_TOKEN))
      throw new GatewayError("UNAUTHORIZED", "Bootstrap token required.", 401);
    const a = credentials.parse(req.body);
    gateway.auth.setup(a.name, a.password);
    res.status(201).json({ created: true });
  });
  router.post("/login", (req, res) => {
    const a = credentials.parse(req.body);
    const session = gateway.auth.login(a.name, a.password);
    const activity = requestActivity.getStore();
    if (activity?.activityId)
      gateway.manager.store.identifyActivity(
        activity.activityId,
        "admin",
        a.name,
      );
    res.json({ session });
  });
  router.use((req, _res, next) => {
    gateway.auth.admin(bearer(req));
    next();
  });
  router.post("/logout", (req, res) => {
    gateway.manager.store.remove("session", hash(bearer(req)));
    res.json({ loggedOut: true });
  });
  router.get("/status", (_req, res) =>
    res.json({
      name: "DBMux",
      version: "0.1.0",
      connections: gateway.manager.list().length,
      tokens: gateway.auth.list().length,
    }),
  );
  router.get("/connections", (_req, res) => res.json(gateway.manager.list()));
  router.get("/dashboard", (req, res) => {
    const { timezoneOffset } = z
      .object({
        timezoneOffset: z.coerce.number().int().min(-840).max(840).default(0),
      })
      .parse(req.query);
    res.json(
      portalDashboard(
        gateway.manager,
        gateway.auth,
        timezoneOffset,
        (requestActivity.getStore()?.activityId ?? Number.MAX_SAFE_INTEGER) - 1,
      ),
    );
  });
  router.post("/connections", async (req, res) => {
    if (gateway.manager.store.get("connection", String(req.body.id)))
      throw new GatewayError(
        "CONNECTION_EXISTS",
        "Connection already exists; use update.",
        409,
      );
    const saved = await gateway.manager.save(req.body);
    attachRequestConnection(gateway, saved.id);
    res.status(201).json(saved);
  });
  router.put("/connections/:id", async (req, res) => {
    const id = String(req.params.id);
    const existing = gateway.manager.configFor(id);
    attachRequestConnection(gateway, id);
    await gateway.transactions.closeConnection(id);
    res.json(
      await gateway.manager.save({
        ...existing,
        ...req.body,
        id,
        password: req.body.password || existing.password,
      }),
    );
  });
  router.post("/connections/:id/test", async (req, res) => {
    const id = String(req.params.id);
    gateway.manager.configFor(id);
    attachRequestConnection(gateway, id);
    const revision = gateway.manager.store.get<SavedConnection>(
      "connection",
      id,
    )?.sealed;
    const checkedAt = new Date().toISOString();
    try {
      const result = await gateway.manager.adapter(id).testConnection();
      const health: ConnectionHealth = {
        checkedAt,
        connected: result.connected === true,
      };
      if (
        typeof result.latencyMs === "number" &&
        Number.isFinite(result.latencyMs)
      )
        health.latencyMs = result.latencyMs;
      // Ignore a test result if this configuration was changed while it ran.
      const previous = gateway.manager.store.get<ConnectionHealth>(
        "connection-health",
        id,
      );
      if (
        gateway.manager.store.get<SavedConnection>("connection", id)?.sealed ===
          revision &&
        (!previous || previous.checkedAt <= checkedAt)
      )
        gateway.manager.store.put("connection-health", id, health);
      res.json(result);
    } catch (error) {
      const previous = gateway.manager.store.get<ConnectionHealth>(
        "connection-health",
        id,
      );
      if (
        gateway.manager.store.get<SavedConnection>("connection", id)?.sealed ===
          revision &&
        (!previous || previous.checkedAt <= checkedAt)
      )
        gateway.manager.store.put("connection-health", id, {
          checkedAt,
          connected: false,
          errorCode: safeError(error).code,
        } satisfies ConnectionHealth);
      throw error;
    }
  });
  router.delete("/connections/:id", async (req, res) => {
    const id = String(req.params.id);
    if (gateway.manager.store.get("connection", id))
      attachRequestConnection(gateway, id);
    await gateway.transactions.closeConnection(id);
    await gateway.manager.remove(id);
    res.json({ deleted: true });
  });
  router.get("/tokens", (_req, res) => {
    const connections = gateway.manager.list();
    res.json(
      gateway.auth.list().map((token) => ({
        ...token,
        access: effectiveTokenAccess(token, connections),
      })),
    );
  });
  const tokenSchema = z.object({
    name: z.string().trim().min(1).max(100),
    connections: z
      .array(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/))
      .min(1)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Connection access must be unique",
      ),
    permissions: permissionsSchema,
    days: z.number().int().min(1).max(365).default(90),
  });
  router.post("/tokens", (req, res) => {
    const a = tokenSchema.parse(req.body);
    for (const id of a.connections) gateway.manager.configFor(id);
    res
      .status(201)
      .json(gateway.auth.create(a.name, a.connections, a.permissions, a.days));
  });
  router.put("/tokens/:id", (req, res) => {
    const input = tokenSchema
      .extend({ days: z.number().int().min(1).max(365).optional() })
      .parse(req.body);
    for (const id of input.connections) gateway.manager.configFor(id);
    res.json(gateway.auth.update(String(req.params.id), input));
  });
  router.delete("/tokens/:id", async (req, res) => {
    gateway.auth.revoke(String(req.params.id));
    res.json({ revoked: true });
  });
  router.post("/tokens/:id/remove", (req, res) => {
    gateway.auth.remove(String(req.params.id));
    res.json({ deleted: true });
  });
  router.post("/tokens/:id/rotate", (req, res) => {
    const token = gateway.auth.current(String(req.params.id));
    const replacement = gateway.auth.create(
      token.name,
      token.connections,
      token.permissions,
      Math.max(1, Math.ceil((token.expiresAt - Date.now()) / 86400000)),
    );
    gateway.auth.revoke(token.id);
    res.json(replacement);
  });
  router.get("/audit", (req, res) => {
    const query = z
      .object({
        connectionId: z.string(),
        limit: z.coerce.number().int().min(1).max(1000).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    gateway.manager.configFor(query.connectionId);
    attachRequestConnection(gateway, query.connectionId);
    res.json(
      gateway.manager.store.history(
        query.connectionId,
        query.limit,
        query.offset,
      ),
    );
  });
  router.get("/audit/export", (req, res, next) => {
    const { connectionId } = z
      .object({ connectionId: z.string().min(1).max(64) })
      .parse(req.query);
    gateway.manager.configFor(connectionId);
    attachRequestConnection(gateway, connectionId);
    const snapshot = Number(
      gateway.manager.store.db
        .prepare("SELECT MAX(id) AS id FROM audit_log WHERE connection_id=?")
        .get(connectionId)?.id ?? 0,
    );
    let offset = 0;
    streamNdjson(res, next, "dbmux-history.ndjson", () => {
      const rows = gateway.manager.store.history(
        connectionId,
        500,
        offset,
        snapshot,
      );
      offset += rows.length;
      return rows;
    });
  });
  router.get("/audit/:id", (req, res) => {
    const id = z.coerce.number().int().positive().safe().parse(req.params.id);
    const audit = gateway.manager.store.auditDetail(id);
    if (!audit)
      throw new GatewayError("NOT_FOUND", "Audit record unavailable.", 404);
    attachRequestConnection(gateway, String(audit.connection_id));
    res.json(audit);
  });
  router.get("/activity/requests/:requestId", (req, res) => {
    const requestId = z.uuid().parse(req.params.requestId);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).max(10000000).default(0),
        auditOffset: z.coerce.number().int().min(0).max(10000000).default(0),
      })
      .parse(req.query);
    const timeline = gateway.manager.store.requestTimeline(
      requestId,
      query.limit,
      query.offset,
      query.auditOffset,
    );
    if (!timeline.total)
      throw new GatewayError("NOT_FOUND", "Request timeline unavailable.", 404);
    res.json(timeline);
  });
  const activityQuery = z
    .object({
      kind: z.enum(["api", "mcp", "tool"]).optional(),
      status: z.enum(["pending", "success", "error", "aborted"]).optional(),
      actor: z.string().max(100).optional(),
      actorId: z.string().min(1).max(100).optional(),
      connectionId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,64}$/)
        .optional(),
      operation: z.string().min(1).max(100).optional(),
      q: z.string().trim().max(200).optional(),
      from: z.iso
        .datetime()
        .transform((value) => new Date(value).toISOString())
        .optional(),
      to: z.iso
        .datetime()
        .transform((value) => new Date(value).toISOString())
        .optional(),
      limit: z.coerce.number().int().min(1).max(1000).default(50),
      offset: z.coerce.number().int().min(0).max(10000000).default(0),
    })
    .refine((q) => !q.from || !q.to || q.from <= q.to, "Invalid date range");
  router.get("/activity", (req, res) =>
    res.json(
      gateway.manager.store.activity({
        ...activityQuery.parse(req.query),
        snapshotId:
          (requestActivity.getStore()?.activityId ?? Number.MAX_SAFE_INTEGER) -
          1,
      }),
    ),
  );
  router.get("/activity/export", (req, res, next) => {
    const query = activityQuery.parse(req.query);
    // Limit exported IDs to calls that began before this request.
    const snapshot =
      (requestActivity.getStore()?.activityId ?? Number.MAX_SAFE_INTEGER) - 1;
    let beforeId = snapshot + 1;
    streamNdjson(res, next, "dbmux-activity.ndjson", () => {
      const page = gateway.manager.store.activity({
        ...query,
        limit: 500,
        offset: 0,
        beforeId,
        snapshotId: snapshot,
        count: false,
      });
      if (page.rows.length)
        beforeId = Number(page.rows[page.rows.length - 1]!.id);
      return page.rows;
    });
  });
  router.get("/installation", (_req, res) =>
    res.json({
      url: config.PUBLIC_URL.replace(/\/$/, "") + "/mcp",
      tokenEnvironment: "DB_MCP_TOKEN",
    }),
  );
  return router;
}
