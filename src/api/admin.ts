import express from "express";
import { z } from "zod";
import type { Gateway } from "../services/gateway.js";
import type { Config } from "../config/index.js";
import { permissionsSchema } from "../security/permissions.js";
import { hash } from "../security/encryption.js";
import { GatewayError } from "../security/errors.js";
export const bearer = (req: express.Request) =>
  req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1] ?? "";
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
    res.json({ session: gateway.auth.login(a.name, a.password) });
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
  router.post("/connections", async (req, res) => {
    if (gateway.manager.store.get("connection", String(req.body.id)))
      throw new GatewayError(
        "CONNECTION_EXISTS",
        "Connection already exists; use update.",
        409,
      );
    res.status(201).json(await gateway.manager.save(req.body));
  });
  router.put("/connections/:id", async (req, res) => {
    const id = String(req.params.id);
    const existing = gateway.manager.configFor(id);
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
  router.post("/connections/:id/test", async (req, res) =>
    res.json(
      await gateway.manager.adapter(String(req.params.id)).testConnection(),
    ),
  );
  router.delete("/connections/:id", async (req, res) => {
    const id = String(req.params.id);
    await gateway.transactions.closeConnection(id);
    await gateway.manager.remove(id);
    res.json({ deleted: true });
  });
  router.get("/tokens", (_req, res) => res.json(gateway.auth.list()));
  const tokenSchema = z.object({
    name: z.string().min(1).max(100),
    connections: z.array(z.string()).min(1).max(100),
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
  router.delete("/tokens/:id", async (req, res) => {
    gateway.auth.revoke(String(req.params.id));
    res.json({ revoked: true });
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
    res.json(
      gateway.manager.store.history(
        query.connectionId,
        query.limit,
        query.offset,
      ),
    );
  });
  router.get("/installation", (_req, res) =>
    res.json({
      url: config.PUBLIC_URL.replace(/\/$/, "") + "/mcp",
      tokenEnvironment: "DB_MCP_TOKEN",
    }),
  );
  return router;
}
