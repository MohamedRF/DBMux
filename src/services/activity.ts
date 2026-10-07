import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Store } from "../storage/sqlite.js";
import type { Identity } from "../security/auth.js";
import { safeError } from "../security/errors.js";
export const requestActivity = new AsyncLocalStorage<{
  source: string;
  requestId: string;
  activityId?: number;
  errorCode?: string;
  toolActivityId?: number;
}>();
export async function trackTool<T>(
  store: Store,
  identity: Identity,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const context = requestActivity.getStore() ?? {
    source: "local",
    requestId: randomUUID(),
  };
  const id = store.startActivity({
    kind: "tool",
    actorId: identity.id,
    actorName: identity.name,
    operation,
    ...context,
  });
  const start = Date.now();
  try {
    const value = await requestActivity.run(
      { ...context, toolActivityId: id },
      fn,
    );
    const failed =
      typeof value === "object" &&
      value !== null &&
      "success" in value &&
      value.success === false;
    store.finishActivity(
      id,
      failed ? "error" : "success",
      Date.now() - start,
      undefined,
      failed ? "DATABASE_OPERATION_FAILED" : undefined,
    );
    return value;
  } catch (error) {
    store.finishActivity(
      id,
      "error",
      Date.now() - start,
      undefined,
      safeError(error).code,
    );
    throw error;
  }
}
