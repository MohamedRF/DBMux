#!/usr/bin/env node
const [command, id] = process.argv.slice(2);
const url = process.env.DBMUX_URL ?? "http://localhost:3000";
const token = process.env.DBMUX_ADMIN_TOKEN;
if (command === "version") {
  console.log("DBMux 0.1.0");
} else {
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
      "Usage: dbmcp status|connections|test <id>|tokens|audit <id>|version. Set DBMUX_ADMIN_TOKEN and optionally DBMUX_URL.",
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
