import { hasRequestTimeline } from "./timeline.js";

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function renderDashboard(
  data,
  { root, button, openPage, openTimeline, testConnection, editToken },
) {
  root.replaceChildren();
  const metricGrid = element("div", undefined, "dashboard-metrics");
  for (const [label, value, note] of [
    [
      "Requests today",
      data.metrics.requests,
      "Portal API + MCP transport requests",
    ],
    [
      "Failed requests",
      data.metrics.failedRequests,
      "HTTP failures; counted once per request",
    ],
    [
      "MCP tools today",
      data.metrics.toolCalls,
      `${data.metrics.failedTools} tool failures`,
    ],
    [
      "Slow tools",
      data.metrics.slowTools,
      `Completed tools taking at least ${data.slowThresholdMs / 1000} second`,
    ],
  ]) {
    const card = element("article");
    card.append(
      element("p", label),
      element("strong", String(value), "metric-value"),
      element("small", note),
    );
    metricGrid.append(card);
  }
  root.append(metricGrid);
  const panels = element("div", undefined, "dashboard-panels");
  const traffic = element("article");
  traffic.append(element("h2", "Activity over 7 days"));
  const peak = Math.max(1, ...data.daily.map((day) => day.requests));
  const days = element("ul", undefined, "traffic-chart");
  for (const day of data.daily) {
    const row = element("li");
    const meter = element("meter");
    meter.min = 0;
    meter.max = peak;
    meter.value = day.requests;
    meter.setAttribute("aria-label", day.date + " requests");
    row.append(
      element("time", day.date),
      meter,
      element(
        "span",
        `${day.requests} requests · ${day.tools} tools · ${day.failedTools} tool failures`,
      ),
    );
    days.append(row);
  }
  traffic.append(
    days,
    button("Explore activity", () => openPage("activity")),
  );
  panels.append(traffic);
  const expiry = element("article");
  expiry.append(element("h2", "Tokens expiring within 7 days"));
  if (!data.expiringTokens.length)
    expiry.append(
      element("p", "No active tokens expire within the next 7 days."),
    );
  for (const token of data.expiringTokens) {
    const row = element("div", undefined, "dashboard-row");
    row.append(
      element("strong", token.name),
      element("small", new Date(token.expiresAt).toLocaleString()),
      button("Review access", () => editToken(token.id)),
    );
    expiry.append(row);
  }
  panels.append(expiry);
  const health = element("article");
  health.append(
    element("h2", "Connection health"),
    element(
      "p",
      "Last explicit test result. A recorded success does not guarantee current connectivity.",
    ),
  );
  if (!data.connections.length)
    health.append(element("p", "No connections yet."));
  for (const connection of data.connections) {
    const row = element("div", undefined, "dashboard-row");
    const result = connection.health;
    row.append(
      element("strong", connection.name),
      element(
        "small",
        `${connection.engine} · ${connection.enabled ? "MCP enabled" : "MCP disabled"} · ${result ? (result.connected ? "Last test passed" : "Last test failed") : "Not tested"}`,
      ),
    );
    if (result)
      row.append(
        element(
          "small",
          new Date(result.checkedAt).toLocaleString() +
            (result.errorCode ? " · " + result.errorCode : "") +
            (result.latencyMs !== undefined
              ? ` · ${Math.round(result.latencyMs)} ms`
              : ""),
        ),
      );
    row.append(button("Test connection", () => testConnection(connection.id)));
    health.append(row);
  }
  health.append(button("Manage connections", () => openPage("connections")));
  panels.append(health);
  const slow = element("article");
  slow.append(element("h2", "Slowest tools today"));
  if (!data.slow.length)
    slow.append(
      element("p", "No completed tools exceeded the slow threshold today."),
    );
  for (const call of data.slow) {
    const row = element("div", undefined, "dashboard-row");
    row.append(
      element("strong", call.operation),
      element(
        "small",
        `${call.actor_name} · ${call.connection_id ?? "Gateway"} · ${call.duration_ms} ms · ${call.status}`,
      ),
    );
    row.append(
      hasRequestTimeline(call.request_id)
        ? button("View request", () => openTimeline(call.request_id))
        : element("small", "Older local call; no linked timeline"),
    );
    slow.append(row);
  }
  panels.append(slow);
  root.append(panels);
}
