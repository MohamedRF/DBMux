import { randomUUID } from "node:crypto";
import type {
  DatabaseAdapter,
  TransactionHandle,
} from "../database/adapter.js";
import { GatewayError } from "../security/errors.js";
interface Transaction {
  owner: string;
  connectionId: string;
  handle: TransactionHandle;
  expiresAt: number;
  queue: Promise<unknown>;
  closing: boolean;
  failed: boolean;
}
export class Transactions {
  private readonly entries = new Map<string, Transaction>();
  private readonly timer: NodeJS.Timeout;
  private readonly opening = new Map<string, number>();
  constructor(
    private readonly seconds: number,
    private readonly onFailure: (id: string) => void,
  ) {
    this.timer = setInterval(() => {
      for (const [id, t] of this.entries)
        if (t.expiresAt <= Date.now())
          void this.finish(id, t.owner, false).catch(() => this.onFailure(id));
    }, 1000);
    this.timer.unref();
  }
  async begin(owner: string, connectionId: string, adapter: DatabaseAdapter) {
    const pending = this.opening.get(owner) ?? 0;
    if (
      [...this.entries.values()].filter((t) => t.owner === owner).length +
        pending >=
        3 ||
      this.entries.size +
        [...this.opening.values()].reduce((a, b) => a + b, 0) >=
        50
    )
      throw new GatewayError(
        "TRANSACTION_LIMIT",
        "Too many active transactions.",
      );
    this.opening.set(owner, pending + 1);
    try {
      const id = randomUUID();
      const t: Transaction = {
        owner,
        connectionId,
        handle: await adapter.beginTransaction(),
        expiresAt: Date.now() + this.seconds * 1000,
        queue: Promise.resolve(),
        closing: false,
        failed: false,
      };
      this.entries.set(id, t);
      return { transactionId: id, expiresAt: t.expiresAt };
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
        "TRANSACTION_UNAVAILABLE",
        "Transaction unavailable or expired.",
        404,
      );
    return t;
  }
  async run<T>(
    id: string,
    owner: string,
    fn: (t: Transaction) => Promise<T>,
  ): Promise<T> {
    const t = this.get(id, owner);
    const result = t.queue.then(() => {
      if (t.failed)
        throw new GatewayError(
          "TRANSACTION_FAILED",
          "Transaction has failed; roll it back.",
        );
      if (t.expiresAt <= Date.now())
        throw new GatewayError("TRANSACTION_EXPIRED", "Transaction expired.");
      return fn(t);
    });
    t.queue = result.catch(() => {
      t.failed = true;
    });
    return result;
  }
  async finish(id: string, owner: string, commit: boolean) {
    const t = this.entries.get(id);
    if (!t || t.owner !== owner || t.closing)
      throw new GatewayError(
        "TRANSACTION_UNAVAILABLE",
        "Transaction unavailable.",
        404,
      );
    t.closing = true;
    try {
      await t.queue;
      if (commit && !t.failed && t.expiresAt > Date.now())
        await t.handle.commit();
      else {
        await t.handle.rollback();
        if (commit)
          throw new GatewayError(
            "TRANSACTION_FAILED",
            "Failed or expired transaction was rolled back.",
          );
      }
    } finally {
      this.entries.delete(id);
    }
  }
  async closeConnection(id: string) {
    await Promise.all(
      [...this.entries]
        .filter(([, t]) => t.connectionId === id)
        .map(([key, t]) => this.finish(key, t.owner, false)),
    );
  }
  async close() {
    clearInterval(this.timer);
    await Promise.all(
      [...this.entries].map(([id, t]) => this.finish(id, t.owner, false)),
    );
  }
}
