export class GatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function safeError(error: unknown) {
  if (error instanceof GatewayError)
    return { code: error.code, message: error.message };
  const e = error as { code?: unknown; errorNum?: unknown };
  const code =
    typeof e?.code === "string" && /^(ORA-\d{5}|[0-9A-Z]{5})$/.test(e.code)
      ? e.code
      : typeof e?.errorNum === "number"
        ? `ORA-${String(e.errorNum).padStart(5, "0")}`
        : "DATABASE_OPERATION_FAILED";
  return {
    code,
    message:
      "Operation failed. Check database permissions, availability and statement validity.",
  };
}
