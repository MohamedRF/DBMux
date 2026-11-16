import {
  Client,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

/**
 * `dbmcp doctor` — read-only verification of a DBMux MCP endpoint.
 *
 * Uses only the caller's DB_MCP_TOKEN (never an argument, never logged):
 * checks endpoint reachability/TLS, MCP protocol negotiation, tool
 * discovery and a real `db_connections` call through the normal
 * authorization boundary. Output distinguishes network/TLS failure,
 * rejected credentials, protocol/tool-discovery failure and successful
 * access with zero visible connections. Total runtime is bounded.
 */
export const DOCTOR_EXIT = {
  OK: 0,
  UNEXPECTED: 1,
  USAGE: 2,
  NETWORK: 3,
  AUTH: 4,
  PROTOCOL: 5,
  NO_CONNECTIONS: 6,
} as const;

export interface DoctorOptions {
  /** Explicit endpoint (`--url`). Overrides `DBMUX_URL`. */
  url?: string | undefined;
  /** Defaults to process.env. */
  env?: NodeJS.ProcessEnv | undefined;
  /** Overall runtime bound in milliseconds. Defaults to 30000. */
  timeoutMs?: number | undefined;
  /** Output sink (defaults to process.stdout). Receives one line per call. */
  write?: ((line: string) => void) | undefined;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resolveEndpoint(raw: string): {
  endpoint?: URL;
  error?: string;
} {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      error:
        "Endpoint is not a valid absolute URL. Use e.g. https://dbmcp.example.edu/mcp",
    };
  }
  if (parsed.username || parsed.password)
    return { error: "Endpoint must not embed credentials; use DB_MCP_TOKEN." };
  if (parsed.search || parsed.hash)
    return { error: "Endpoint must not include a query string or fragment." };
  const loopback = LOOPBACK.has(parsed.hostname);
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && loopback)
  )
    return {
      error:
        "Endpoint must use HTTPS, or HTTP on loopback only (localhost, 127.0.0.1, [::1]).",
    };
  const path = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = path === "" ? "/mcp" : path;
  return { endpoint: parsed };
}

/** Collect messages from an error and its cause chain, lower-cased. */
function causeMessages(error: unknown, depth = 0): string[] {
  if (!error || depth > 4) return [];
  const own = error instanceof Error ? [error.message] : [String(error)];
  const cause = (error as { cause?: unknown }).cause;
  return own.concat(cause ? causeMessages(cause, depth + 1) : []);
}

interface Classification {
  exitCode: number;
  reason: string;
  hint: string;
}

/** Map an arbitrary failure onto a stable exit classification. */
export function classifyError(error: unknown): Classification {
  if (error instanceof SdkHttpError) {
    if (error.status === 401 || error.status === 403)
      return {
        exitCode: DOCTOR_EXIT.AUTH,
        reason: `the server rejected the token (HTTP ${error.status})`,
        hint: "Check that DB_MCP_TOKEN is set in this process, not expired, revoked or rotated; ask your administrator to re-issue it.",
      };
    return {
      exitCode: DOCTOR_EXIT.PROTOCOL,
      reason: `the server answered HTTP ${error.status} during MCP negotiation`,
      hint:
        error.status === 405
          ? "Only POST is served at /mcp — check the endpoint path."
          : error.status === 403 || error.status === 400
            ? "Check that PUBLIC_URL on the server matches this endpoint's scheme, host and port."
            : "Check the server logs; the endpoint answered but MCP negotiation did not complete.",
    };
  }
  if (error instanceof ProtocolError)
    return {
      exitCode: DOCTOR_EXIT.PROTOCOL,
      reason: "the server returned an MCP protocol error",
      hint: "Check that the endpoint is a DBMux /mcp endpoint and that no proxy rewrites MCP requests.",
    };
  if (error instanceof SdkError) {
    if (error.code === SdkErrorCode.RequestTimeout)
      return {
        exitCode: DOCTOR_EXIT.NETWORK,
        reason: "the request to the endpoint timed out",
        hint: "Check the host, port and firewall; the server may be overloaded or unreachable.",
      };
    if (
      error.code === SdkErrorCode.EraNegotiationFailed ||
      error.code === SdkErrorCode.MethodNotSupportedByProtocolVersion ||
      error.code === SdkErrorCode.InvalidResult
    )
      return {
        exitCode: DOCTOR_EXIT.PROTOCOL,
        reason: "MCP protocol negotiation failed",
        hint: "Check that no intermediary strips MCP headers (MCP-Protocol-Version, Mcp-Method) or rewrites the response.",
      };
    if (error.code === SdkErrorCode.SendFailed)
      return {
        exitCode: DOCTOR_EXIT.NETWORK,
        reason: "could not send the MCP request",
        hint: "Check the network path to the endpoint.",
      };
    return {
      exitCode: DOCTOR_EXIT.PROTOCOL,
      reason: `MCP client failed (${error.code})`,
      hint: "Check that the endpoint serves the MCP protocol on /mcp.",
    };
  }
  const messages = causeMessages(error).join(" | ").toLowerCase();
  if (messages.includes("redirect"))
    return {
      exitCode: DOCTOR_EXIT.NETWORK,
      reason: "the endpoint issued a redirect, which was refused",
      hint: "Redirects are not followed because they could forward your Authorization header. Use the final HTTPS endpoint directly.",
    };
  if (
    /certificate|cert_|tls|ssl|self[- ]signed|unable to verify|altnames/.test(
      messages,
    )
  )
    return {
      exitCode: DOCTOR_EXIT.NETWORK,
      reason: "TLS verification failed",
      hint: "Fix the server certificate chain or the corporate TLS inspection setup; do not disable verification.",
    };
  if (
    /econnrefused|econnreset|enotfound|eai_again|etimedout|epipe|fetch failed|socket hang up|aborted|timeout|network/.test(
      messages,
    )
  )
    return {
      exitCode: DOCTOR_EXIT.NETWORK,
      reason: "could not reach the endpoint",
      hint: "Check the host, port, DNS and firewall, and that the endpoint uses HTTPS with a valid certificate.",
    };
  if (error instanceof DOMException && error.name === "TimeoutError")
    return {
      exitCode: DOCTOR_EXIT.NETWORK,
      reason: "the request to the endpoint timed out",
      hint: "Check the host, port and firewall; the server may be overloaded or unreachable.",
    };
  return {
    exitCode: DOCTOR_EXIT.PROTOCOL,
    reason: "the MCP exchange failed",
    hint: "Check that the endpoint is a DBMux /mcp endpoint behind a proxy that preserves MCP requests and responses.",
  };
}

interface ConnectionsPayload {
  connections: Array<{ id: string; engine?: string }>;
}

function parseConnections(text: string): ConnectionsPayload | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    const connections = parsed.filter(
      (item): item is { id: string; engine?: string } =>
        !!item &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string",
    );
    return { connections };
  } catch {
    return null;
  }
}

export async function runDoctor(options: DoctorOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const write =
    options.write ?? ((line: string) => process.stdout.write(line + "\n"));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());

  write("DBMux doctor — read-only MCP verification");

  // 1. Configuration: endpoint and token. The token is never accepted as an argument.
  const rawEndpoint = options.url ?? env.DBMUX_URL ?? "http://localhost:3000";
  const { endpoint, error } = resolveEndpoint(String(rawEndpoint));
  if (error) {
    write(`✗ Endpoint — ${error}`);
    write(`RESULT: usage error (exit ${DOCTOR_EXIT.USAGE}).`);
    return DOCTOR_EXIT.USAGE;
  }
  const token = (env.DB_MCP_TOKEN ?? "").trim();
  if (!token || /\s/.test(token)) {
    write(
      "✗ DB_MCP_TOKEN — missing or contains whitespace. Set it in the environment of this process (never pass it as an argument).",
    );
    write(`RESULT: usage error (exit ${DOCTOR_EXIT.USAGE}).`);
    return DOCTOR_EXIT.USAGE;
  }
  const resource = endpoint as URL;
  write(`Endpoint: ${resource.href}`);
  write(
    "✓ Configuration — endpoint URL and DB_MCP_TOKEN present (token value never printed)",
  );

  // 2. Connect through the real MCP SDK with redirects refused.
  const fetchWithBound: (
    input: string | URL,
    init?: RequestInit,
  ) => Promise<Response> = (input, init) =>
    fetch(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([
        ...(init?.signal ? [init.signal] : []),
        AbortSignal.timeout(remaining()),
      ]),
    });
  const transport = new StreamableHTTPClientTransport(resource, {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
    },
    fetch: fetchWithBound,
  });
  const client = new Client({ name: "dbmux-doctor", version: "1.0.0" });
  try {
    await client.connect(transport);
    const version = client.getServerVersion();
    write(
      `✓ Handshake — MCP negotiated${version?.name ? ` with ${version.name}${version.version ? ` ${version.version}` : ""}` : ""}`,
    );
  } catch (connectError) {
    const failure = classifyError(connectError);
    write(`✗ Handshake — ${failure.reason}.`);
    write(`  Fix: ${failure.hint}`);
    write(
      `RESULT: ${failure.exitCode === DOCTOR_EXIT.AUTH ? "authentication rejected" : failure.exitCode === DOCTOR_EXIT.NETWORK ? "network/TLS failure" : "protocol failure"} (exit ${failure.exitCode}).`,
    );
    await client.close().catch(() => {});
    return failure.exitCode;
  }

  // 3. Tool discovery through the SDK.
  let toolCount = 0;
  try {
    const tools = await client.listTools();
    toolCount = tools.tools.length;
    if (!tools.tools.some((tool) => tool.name === "db_connections")) {
      write(
        "✗ Tool discovery — db_connections is not published by this endpoint.",
      );
      write(
        "  Fix: check that the endpoint is a DBMux /mcp endpoint running a current build.",
      );
      write(
        `RESULT: protocol or tool-discovery failure (exit ${DOCTOR_EXIT.PROTOCOL}).`,
      );
      await client.close().catch(() => {});
      return DOCTOR_EXIT.PROTOCOL;
    }
    write(
      `✓ Tool discovery — ${toolCount} tools published, db_connections available`,
    );
  } catch (discoveryError) {
    const failure = classifyError(discoveryError);
    write(`✗ Tool discovery — ${failure.reason}.`);
    write(`  Fix: ${failure.hint}`);
    write(
      `RESULT: protocol or tool-discovery failure (exit ${DOCTOR_EXIT.PROTOCOL}).`,
    );
    await client.close().catch(() => {});
    return DOCTOR_EXIT.PROTOCOL;
  }

  // 4. Read-only db_connections call through the authorization boundary.
  try {
    const result = await client.callTool({
      name: "db_connections",
      arguments: {},
    });
    if (result.isError) {
      const text = JSON.stringify(result.content ?? []);
      const unauthorized = /UNAUTHORIZED|FORBIDDEN/i.test(text);
      write(
        `✗ db_connections — the server refused the call (${unauthorized ? "authorization denied" : "tool error"}).`,
      );
      write(
        "  Fix: confirm your token is active and was not revoked mid-session; ask your administrator to check your grants.",
      );
      write(
        `RESULT: ${unauthorized ? "rejected credentials" : "protocol failure"} (exit ${unauthorized ? DOCTOR_EXIT.AUTH : DOCTOR_EXIT.PROTOCOL}).`,
      );
      await client.close().catch(() => {});
      return unauthorized ? DOCTOR_EXIT.AUTH : DOCTOR_EXIT.PROTOCOL;
    }
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((item) =>
        item && typeof item === "object" && "text" in item
          ? String((item as { text: unknown }).text)
          : "",
      )
      .join("");
    const parsed = parseConnections(text);
    if (!parsed) {
      write("✗ db_connections — the response could not be parsed.");
      write(
        `RESULT: protocol or tool-discovery failure (exit ${DOCTOR_EXIT.PROTOCOL}).`,
      );
      await client.close().catch(() => {});
      return DOCTOR_EXIT.PROTOCOL;
    }
    write(
      `✓ db_connections — call succeeded; ${parsed.connections.length} connection(s) visible to your token`,
    );
    for (const connection of parsed.connections.slice(0, 10))
      write(
        `  - ${connection.id}${connection.engine ? ` (${connection.engine})` : ""}`,
      );
    if (parsed.connections.length > 10)
      write(`  … and ${parsed.connections.length - 10} more`);
    if (parsed.connections.length === 0) {
      write(
        "  Fix: ask your administrator to enable MCP on the connection and to include it in your token's connection scope.",
      );
      write(
        `RESULT: access OK but zero connections visible (exit ${DOCTOR_EXIT.NO_CONNECTIONS}).`,
      );
      await client.close().catch(() => {});
      return DOCTOR_EXIT.NO_CONNECTIONS;
    }
    write(
      "RESULT: OK — endpoint reachable, token accepted, db_connections returned data (exit 0).",
    );
    await client.close().catch(() => {});
    return DOCTOR_EXIT.OK;
  } catch (callError) {
    const failure = classifyError(callError);
    write(`✗ db_connections — ${failure.reason}.`);
    write(`  Fix: ${failure.hint}`);
    write(
      `RESULT: protocol or tool-discovery failure (exit ${failure.exitCode}).`,
    );
    await client.close().catch(() => {});
    return failure.exitCode;
  }
}
