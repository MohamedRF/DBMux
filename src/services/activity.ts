import { AsyncLocalStorage } from "node:async_hooks";
import type { Store } from "../storage/sqlite.js";
import type { Identity } from "../security/auth.js";
import { safeError } from "../security/errors.js";
export const requestActivity = new AsyncLocalStorage<{
  source: string;
  requestId: string;
  activityId?: number;
  errorCode?: string;
}>();
export async function trackTool<T>(
  store: Store,
  identity: Identity,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const context = requestActivity.getStore() ?? {
    source: "local",
    requestId: "local",
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
    const value = await fn();
    store.finishActivity(id, "success", Date.now() - start);
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
