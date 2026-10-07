import { randomUUID } from "node:crypto";
import { requestActivity } from "../services/activity.js";
import express from "express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createMcp } from "./mcp.js";
import { join } from "node:path";
import type { Gateway } from "../services/gateway.js";
import type { Config } from "../config/index.js";
import { adminRouter, bearer } from "../api/admin.js";
import { GatewayError, safeError } from "../security/errors.js";
import { ZodError } from "zod";

export function foundationApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.get("/health", (_req, res) => res.json({ status: "ok", mcp: true }));
  app.get("/ready", (_req, res) => res.json({ status: "ready" }));
  app.post("/mcp", (_req, res) =>
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Bearer authentication required",
      },
    }),
  );
  return app;
}
export async function serveMcp(
  req: express.Request,
  res: express.Response,
  server = createMcp(),
) {
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
export function createApp(gateway: Gateway, config: Config) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (!(
      req.path === "/mcp" ||
      req.path === "/api" ||
      req.path.startsWith("/api/")
    ))
      return next();
    let actorId = "anonymous",
      actorName = "Unauthenticated";
    try {
      if (req.path === "/mcp") {
        const token = gateway.auth.resolve(bearer(req));
        actorId = token.id;
        actorName = token.name;
      } else {
        gateway.auth.admin(bearer(req));
        actorId = "admin";
        actorName =
          gateway.manager.store.get<{ name: string }>("admin", "singleton")
            ?.name ?? "Administrator";
      }
    } catch (error) {
      if (!(error instanceof GatewayError)) return next(error);
    }
    // Do not trust forwarded headers or persist arbitrary paths, queries or bodies.
    const path = req.path
      .replace(/^(\/api\/(?:tokens|connections))\/[^/]+/, "$1/:id")
      .replace(
        /^\/api\/activity\/requests\/[^/]+$/,
        "/api/activity/requests/:requestId",
      )
      .replace(/^\/api\/audit\/\d+$/, "/api/audit/:id");
    const operation =
      /^(?:\/mcp|\/api\/(?:setup|login|logout|status|dashboard|connections(?:\/:id(?:\/test)?)?|tokens(?:\/:id(?:\/(?:rotate|remove))?)?|audit(?:\/(?:export|:id))?|activity(?:\/(?:export|requests\/:requestId))?|installation))$/.test(
        path,
      )
        ? req.method + " " + path
        : req.method + " unknown route";
    const context: {
      source: string;
      requestId: string;
      activityId?: number;
      errorCode?: string;
    } = {
      source: req.socket.remoteAddress ?? "unknown",
      requestId: randomUUID(),
    };
    const id = gateway.manager.store.startActivity({
      kind: req.path === "/mcp" ? "mcp" : "api",
      actorId,
      actorName,
      operation,
      ...context,
    });
    context.activityId = id;
    const start = Date.now();
    let completed = false;
    res.once("finish", () => {
      completed = true;
      gateway.manager.store.finishActivity(
        id,
        res.statusCode >= 400 ? "error" : "success",
        Date.now() - start,
        res.statusCode,
        context.errorCode,
      );
    });
    res.once("close", () => {
      if (!completed)
        gateway.manager.store.finishActivity(
          id,
          "aborted",
          Date.now() - start,
          res.statusCode,
        );
    });
    requestActivity.run(context, next);
  });
  const expected = new URL(config.PUBLIC_URL);
  const attempts = new Map<string, { count: number; until: number }>();
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (
      req.hostname !== expected.hostname &&
      req.hostname !== "127.0.0.1" &&
      req.hostname !== "localhost"
    )
      return res.status(403).json({
        error: { code: "HOST_DENIED", message: "Host is not configured." },
      });
    if (req.headers.origin && req.headers.origin !== expected.origin)
      return res.status(403).json({
        error: {
          code: "ORIGIN_DENIED",
          message: "Origin is not configured.",
        },
      });
    const isLogin = ["/api/login", "/api/setup"].includes(req.path);
    const key =
      (req.socket.remoteAddress ?? "unknown") + (isLogin ? ":auth" : "");
    const now = Date.now();
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const entry = attempts.get(key) ?? { count: 0, until: now + 60000 };
    if (++entry.count > (isLogin ? 10 : 300))
      return res.status(429).json({
        error: {
          code: "RATE_LIMIT",
          message: "Too many requests; retry after one minute.",
        },
      });
    attempts.set(key, entry);
    next();
  });
  app.use(express.json({ limit: "512kb" }));
  app.get("/health", (_req, res) => res.json({ status: "ok", mcp: true }));
  app.get("/ready", (_req, res) => {
    gateway.manager.store.db.prepare("SELECT 1").get();
    res.json({ status: "ready" });
  });
  app.use("/api", adminRouter(gateway, config));
  app.post("/mcp", async (req, res) => {
    const identity = gateway.auth.resolve(bearer(req));
    await serveMcp(req, res, createMcp(gateway, identity));
  });
  app.all("/mcp", (req, res) => {
    gateway.auth.resolve(bearer(req));
    res.setHeader("Allow", "POST");
    res.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Stateless Streamable HTTP accepts POST.",
      },
    });
  });
  app.use(express.static(join(process.cwd(), "src", "ui"), { etag: false }));
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const safe =
        error instanceof ZodError
          ? { code: "INVALID_INPUT", message: "Input validation failed." }
          : safeError(error);
      const status =
        error instanceof GatewayError
          ? error.status
          : error instanceof ZodError
            ? 400
            : 500;
      const activity = requestActivity.getStore();
      if (activity) activity.errorCode = safe.code;
      if (res.headersSent) return;
      res.status(status).json({ success: false, error: safe });
    },
  );
  return app;
}
