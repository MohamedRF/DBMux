#!/usr/bin/env node
const [command, ...rest] = process.argv.slice(2);
const url = process.env.DBMUX_URL ?? "http://localhost:3000";
const token = process.env.DBMUX_ADMIN_TOKEN;
if (command === "version") {
  console.log("DBMux 0.1.0");
} else if (command === "doctor") {
  let doctorUrl: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === "--url") {
      doctorUrl = rest[++index];
      if (!doctorUrl) {
        console.error(
          "dbmcp doctor: --url requires a value, e.g. --url https://dbmcp.example.edu/mcp",
        );
        process.exitCode = 2;
        doctorUrl = undefined;
        break;
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: dbmcp doctor [--url <https://host/mcp>]\n\nVerifies the DBMux MCP endpoint with your DB_MCP_TOKEN (never an argument, never printed): reachability/TLS, protocol negotiation, tool discovery and a read-only db_connections call.\n\nWithout --url, DBMUX_URL is used (default http://localhost:3000); /mcp is appended when the path is empty.\n\nExit codes: 0 OK, 1 unexpected error, 2 usage error, 3 network/TLS failure (redirects refused), 4 rejected credentials, 5 protocol or tool-discovery failure, 6 access OK but zero connections visible.",
      );
      process.exit(0);
    } else {
      console.error(
        `dbmcp doctor: unknown option '${arg}'. Usage: dbmcp doctor [--url <https://host/mcp>]`,
      );
      process.exitCode = 2;
      break;
    }
  }
  if (process.exitCode !== 2) {
    const { runDoctor } = await import("./doctor.js");
    process.exitCode = await runDoctor({ url: doctorUrl });
  }
} else {
  const id = rest[0];
  const routes: Record<string, string> = {
    status: "/status",
    connections: "/connections",
    tokens: "/tokens",
    audit: "/audit?connectionId=" + encodeURIComponent(id ?? ""),
  };
  const route =
    command === "test" && id
      ? "/connections/" + encodeURIComponent(id) + "/test"
      : routes[command ?? ""];
  if (!route || !token) {
    console.error(
      "Usage: dbmcp status|connections|test <id>|tokens|audit <id>|doctor [--url <https://host/mcp>]|version. Set DBMUX_ADMIN_TOKEN and optionally DBMUX_URL. dbmcp doctor needs DB_MCP_TOKEN instead of DBMUX_ADMIN_TOKEN.",
    );
    process.exitCode = 1;
  } else {
    try {
      const res = await fetch(url + "/api" + route, {
        method: command === "test" ? "POST" : "GET",
        headers: { Authorization: "Bearer " + token },
        signal: AbortSignal.timeout(30000),
      });
      const body = await res.json();
      console.log(JSON.stringify(body, null, 2));
      if (!res.ok) process.exitCode = 1;
    } catch {
      console.error("Server request failed.");
      process.exitCode = 1;
    }
  }
}
