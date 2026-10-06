import { randomUUID } from "node:crypto";
import type { Store } from "../storage/sqlite.js";
import { hash, secret, passwordHash, passwordMatches } from "./encryption.js";
import { GatewayError } from "./errors.js";
import type { Permissions } from "./permissions.js";
export interface Identity {
  id: string;
  name: string;
  connections: string[];
  permissions: Permissions;
  expiresAt: number;
  revoked: boolean;
  hash: string;
}
export class Auth {
  constructor(readonly store: Store) {}
  setup(name: string, password: string) {
    if (this.store.get("admin", "singleton"))
      throw new GatewayError(
        "SETUP_COMPLETE",
        "Administrator already exists.",
        409,
      );
    this.store.put("admin", "singleton", {
      name,
      password: passwordHash(password),
    });
  }
  login(name: string, password: string) {
    const admin = this.store.get<{ name: string; password: string }>(
      "admin",
      "singleton",
    );
    if (
      !admin ||
      admin.name !== name ||
      !passwordMatches(password, admin.password)
    )
      throw new GatewayError("UNAUTHORIZED", "Invalid credentials.", 401);
    const raw = secret("admin_");
    this.store.put("session", hash(raw), {
      expiresAt: Date.now() + 8 * 3600000,
    });
    return raw;
  }
  admin(raw: string) {
    const session = this.store.get<{ expiresAt: number }>("session", hash(raw));
    if (!session || session.expiresAt <= Date.now())
      throw new GatewayError(
        "UNAUTHORIZED",
        "Administrator authentication required.",
        401,
      );
  }
  create(
    name: string,
    connections: string[],
    permissions: Permissions,
    days: number,
  ) {
    const raw = secret("mcp_live_");
    const token: Identity = {
      id: randomUUID(),
      name,
      connections,
      permissions,
      expiresAt: Date.now() + days * 86400000,
      revoked: false,
      hash: hash(raw),
    };
    this.store.put("token", token.id, token);
    return { ...this.publicToken(token), token: raw };
  }
  publicToken({ hash: _, ...token }: Identity) {
    return token;
  }
  list() {
    return this.store.list<Identity>("token").map((t) => this.publicToken(t));
  }
  resolve(raw: string) {
    const digest = hash(raw);
    const token = this.store
      .list<Identity>("token")
      .find((t) => t.hash === digest);
    if (!token || token.revoked || token.expiresAt <= Date.now())
      throw new GatewayError(
        "UNAUTHORIZED",
        "Token expired, revoked or invalid.",
        401,
      );
    return token;
  }
  current(id: string) {
    const token = this.store.get<Identity>("token", id);
    if (!token || token.revoked || token.expiresAt <= Date.now())
      throw new GatewayError(
        "UNAUTHORIZED",
        "Token expired, revoked or invalid.",
        401,
      );
    return token;
  }
  revoke(id: string) {
    const token = this.store.get<Identity>("token", id);
    if (!token) throw new GatewayError("NOT_FOUND", "Token unavailable.", 404);
    this.store.put("token", id, { ...token, revoked: true });
  }
}
