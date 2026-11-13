import { randomUUID } from "node:crypto";
import type { DatabaseAdapter, SessionHandle } from "../database/adapter.js";
import { GatewayError } from "../security/errors.js";
const MAX_SESSIONS_TOTAL = 32;
const MAX_SESSIONS_PER_OWNER = 8;
export interface Session {
  owner: string;
  connectionId: string;
  handle: SessionHandle;
  expiresAt: number;
  queue: Promise<unknown>;
  closing: boolean;
}
// Stateful pinned connections for multi-call workflows (temporary objects,
// session state). Sessions are owner-bound, carry the same per-statement
// policy and audit enforcement as ordinary calls, expire after an idle
// window, and never hold uncommitted changes.
export class Sessions {
  private readonly entries = new Map<string, Session>();
  private readonly timer: NodeJS.Timeout;
  private readonly opening = new Map<string, number>();
  constructor(
    private readonly seconds: number,
    private readonly onFailure: (id: string) => void,
  ) {
    this.timer = setInterval(() => {
      for (const [id, t] of this.entries)
        if (t.expiresAt <= Date.now())
          void this.finish(id, t.owner).catch(() => this.onFailure(id));
    }, 1000);
    this.timer.unref();
  }
  async begin(owner: string, connectionId: string, adapter: DatabaseAdapter) {
    const pending = this.opening.get(owner) ?? 0;
    if (
      [...this.entries.values()].filter((t) => t.owner === owner).length +
        pending >=
        MAX_SESSIONS_PER_OWNER ||
      this.entries.size +
        [...this.opening.values()].reduce((a, b) => a + b, 0) >=
        MAX_SESSIONS_TOTAL
    )
      throw new GatewayError("SESSION_LIMIT", "Too many active sessions.");
    this.opening.set(owner, pending + 1);
    try {
      const id = randomUUID();
      const t: Session = {
        owner,
        connectionId,
        handle: await adapter.beginSession(),
        expiresAt: Date.now() + this.seconds * 1000,
        queue: Promise.resolve(),
        closing: false,
      };
      this.entries.set(id, t);
      return { sessionId: id, expiresAt: t.expiresAt };
    } finally {
      const remaining = (this.opening.get(owner) ?? 1) - 1;
      if (remaining) this.opening.set(owner, remaining);
      else this.opening.delete(owner);
    }
  }
  has(id: string, owner: string) {
    return this.entries.get(id)?.owner === owner;
  }
  get(id: string, owner: string) {
    const t = this.entries.get(id);
    if (!t || t.owner !== owner || t.closing || t.expiresAt <= Date.now())
      throw new GatewayError(
        "SESSION_UNAVAILABLE",
        "Session unavailable or expired.",
        404,
      );
    // Idle expiry: each admitted call refreshes the deadline.
    t.expiresAt = Date.now() + this.seconds * 1000;
    return t;
  }
  async run<T>(
    id: string,
    owner: string,
    fn: (t: Session) => Promise<T>,
  ): Promise<T> {
    const t = this.get(id, owner);
    const result = t.queue.then(() => {
      if (t.expiresAt <= Date.now())
        throw new GatewayError("SESSION_EXPIRED", "Session expired.");
      return fn(t);
    });
    t.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async finish(id: string, owner: string) {
    const t = this.entries.get(id);
    if (!t || t.owner !== owner || t.closing)
      throw new GatewayError(
        "SESSION_UNAVAILABLE",
        "Session unavailable.",
        404,
      );
    t.closing = true;
    try {
      await t.queue;
      await t.handle.close();
    } finally {
      this.entries.delete(id);
    }
  }
  async closeConnection(connectionId: string) {
    await Promise.all(
      [...this.entries]
        .filter(([, t]) => t.connectionId === connectionId)
        .map(([key, t]) => this.finish(key, t.owner)),
    );
  }
  async close() {
    clearInterval(this.timer);
    await Promise.all(
      [...this.entries].map(([id, t]) => this.finish(id, t.owner)),
    );
  }
}
