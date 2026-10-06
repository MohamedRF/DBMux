let session = "";
let setup = false;
let editing = false;
let oneTimeToken = "";
let installationUrl = "";
let history = [];
const $ = (id) => document.getElementById(id);
const fields = (form) => Object.fromEntries(new FormData(form));
const csv = (s) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const grant = (level) => ({
  read: true,
  insert: level !== "read-only",
  update: level !== "read-only",
  delete: level !== "read-only",
  create: level !== "read-only",
  alter: level !== "read-only",
  drop: level === "full-development",
  truncate: level === "full-development",
  executeRoutine: false,
});
async function api(path, method = "GET", body, token = session) {
  const r = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error?.message ?? "Request failed");
  return value;
}
function report(e) {
  $("message").textContent = e.message ?? String(e);
}
function button(label, fn) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = () => Promise.resolve().then(fn).catch(report);
  return b;
}
function item(text) {
  const a = document.createElement("article");
  const p = document.createElement("div");
  p.textContent = text;
  a.append(p);
  return a;
}
async function refresh() {
  const connections = await api("/connections");
  $("connectionList").replaceChildren(
    ...connections.map((c) => {
      const a = item(
        `${c.name} · ${c.engine} · ${c.enabled ? "MCP enabled" : "MCP disabled"} · ${c.id}`,
      );
      a.append(
        button("Test", async () =>
          report(
            JSON.stringify(await api("/connections/" + c.id + "/test", "POST")),
          ),
        ),
        button(c.enabled ? "Disable MCP" : "Enable MCP", async () => {
          await api("/connections/" + c.id, "PUT", { enabled: !c.enabled });
          await refresh();
        }),
        button("Edit policy", () => {
          editing = true;
          const f = $("connectionForm");
          f.elements.id.value = c.id;
          f.elements.name.value = c.name;
          for (const key of [
            "host",
            "port",
            "database",
            "username",
            "poolMin",
            "poolMax",
          ])
            f.elements[key].value = c[key];
          f.elements.ssl.checked = c.ssl;
          f.elements.sid.checked = c.sid;
          f.elements.engine.value = c.engine;
          f.elements.schemas.value = c.policy.allowedSchemas.join(",");
          f.elements.enabled.checked = c.enabled;
          f.elements.access.value =
            ["read-only", "development-write", "full-development"].find(
              (level) =>
                Object.keys(c.permissions).every(
                  (key) => grant(level)[key] === c.permissions[key],
                ),
            ) ?? "custom";
          f.elements.customPermissions.value = JSON.stringify(c.permissions);
          f.elements.protectedSchemas.value =
            c.policy.protectedSchemas.join(",");
          f.elements.requireWhereForUpdate.checked =
            c.policy.requireWhereForUpdate;
          f.elements.requireWhereForDelete.checked =
            c.policy.requireWhereForDelete;
          f.elements.disabledTools.value = c.policy.disabledTools.join(",");
          f.elements.blockedTables.value = c.policy.blockedTables.join(",");
          f.elements.blockedColumns.value = c.policy.blockedColumns.join(",");
          report(
            "Editing " +
              c.id +
              ". Credentials remain on the server; leave password empty to retain it.",
          );
        }),
        button("Delete connection", async () => {
          if (confirm("Delete this server connection configuration?")) {
            await api("/connections/" + c.id, "DELETE");
            await refresh();
          }
        }),
      );
      return a;
    }),
  );
  const tokens = await api("/tokens");
  $("tokenList").replaceChildren(
    ...tokens.map((t) => {
      const a = item(
        `${t.name} · ${t.connections.join(", ")} · ${t.revoked ? "revoked" : "expires " + new Date(t.expiresAt).toLocaleString()}`,
      );
      if (!t.revoked)
        a.append(
          button("Revoke", async () => {
            await api("/tokens/" + t.id, "DELETE");
            await refresh();
          }),
          button("Rotate", async () => {
            const value = await api("/tokens/" + t.id + "/rotate", "POST");
            oneTimeToken = value.token;
            $("newToken").textContent = oneTimeToken;
            await refresh();
          }),
        );
      return a;
    }),
  );
}
$("login").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const a = fields(e.target);
    if (setup)
      await api(
        "/setup",
        "POST",
        { name: a.name, password: a.password },
        a.setupToken,
      );
    session = (
      await api("/login", "POST", { name: a.name, password: a.password }, "")
    ).session;
    e.target.reset();
    $("authentication").hidden = true;
    $("workspace").hidden = false;
    $("logout").hidden = false;
    report("Signed in.");
    await refresh();
    installationUrl = (await api("/installation")).url;
    showClient("Generic MCP");
  } catch (error) {
    report(error);
  }
};
$("logout").onclick = async () => {
  try {
    await api("/logout", "POST");
  } finally {
    session = "";
    oneTimeToken = "";
    $("newToken").textContent = "";
    $("workspace").hidden = true;
    $("authentication").hidden = false;
    $("logout").hidden = true;
  }
};
document.querySelectorAll("[data-page]").forEach(
  (b) =>
    (b.onclick = () => {
      ["connections", "tokens", "audit", "installation"].forEach(
        (id) => ($(id).hidden = id !== b.dataset.page),
      );
      if (b.dataset.page !== "tokens") {
        $("newToken").textContent = "";
        oneTimeToken = "";
      }
    }),
);
$("connectionForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const f = e.target;
    const a = fields(f);
    const input = {
      id: a.id,
      name: a.name,
      engine: a.engine,
      host: a.host,
      port: Number(a.port),
      database: a.database,
      username: a.username,
      password: a.password,
      connectString: a.connectString || undefined,
      sid: f.elements.sid.checked,
      ssl: f.elements.ssl.checked,
      poolMin: Number(a.poolMin),
      poolMax: Number(a.poolMax),
      enabled: f.elements.enabled.checked,
      permissions:
        a.access === "custom"
          ? JSON.parse(a.customPermissions)
          : grant(a.access),
      policy: {
        allowedSchemas: csv(a.schemas),
        protectedSchemas: csv(a.protectedSchemas),
        requireWhereForUpdate: f.elements.requireWhereForUpdate.checked,
        requireWhereForDelete: f.elements.requireWhereForDelete.checked,
        disabledTools: csv(a.disabledTools),
        blockedTables: csv(a.blockedTables),
        blockedColumns: csv(a.blockedColumns),
      },
    };
    await api(
      editing ? "/connections/" + a.id : "/connections",
      editing ? "PUT" : "POST",
      input,
    );
    f.elements.password.value = "";
    report("Connection saved. Test before enabling MCP.");
    await refresh();
  } catch (error) {
    report(error);
  }
};
$("resetConnection").onclick = () => {
  editing = false;
  $("connectionForm").reset();
};
$("tokenForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const a = fields(e.target);
    const value = await api("/tokens", "POST", {
      name: a.name,
      connections: csv(a.connections),
      permissions: grant(a.access),
      days: Number(a.days),
    });
    oneTimeToken = value.token;
    $("newToken").textContent =
      "Copy now. This token will not be shown again.\n" + oneTimeToken;
    await refresh();
  } catch (error) {
    report(error);
  }
};
$("copyToken").onclick = () =>
  navigator.clipboard.writeText(oneTimeToken).catch(report);
function renderHistory() {
  const search = $("auditSearch").value.toLowerCase();
  $("auditList").replaceChildren(
    ...history
      .filter((r) => JSON.stringify(r).toLowerCase().includes(search))
      .map((r) => {
        const a = item(`${r.timestamp} · ${r.tool} · ${r.status} · ${r.owner}`);
        const d = document.createElement("details");
        const s = document.createElement("summary");
        s.textContent = "SQL, parameters and context";
        const p = document.createElement("pre");
        p.textContent = JSON.stringify(r.payload, null, 2);
        d.append(s, p);
        a.append(d);
        return a;
      }),
  );
}
$("auditForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const a = fields(e.target);
    history = await api(
      "/audit?connectionId=" +
        encodeURIComponent(a.connectionId) +
        "&offset=" +
        Number(a.offset),
    );
    renderHistory();
  } catch (error) {
    report(error);
  }
};
$("auditSearch").oninput = renderHistory;
function showClient(client) {
  const remote = {
    url: installationUrl,
    headers: { Authorization: "Bearer ${DB_MCP_TOKEN}" },
  };
  let value = JSON.stringify({ mcpServers: { "dbmux-dev": remote } }, null, 2);
  if (client === "Codex")
    value =
      '[mcp_servers.dbmux-dev]\nurl = "' +
      installationUrl +
      '"\nbearer_token_env_var = "DB_MCP_TOKEN"';
  if (client === "Cursor")
    value = JSON.stringify(
      {
        mcpServers: {
          "dbmux-dev": {
            url: installationUrl,
            headers: { Authorization: "Bearer ${env:DB_MCP_TOKEN}" },
          },
        },
      },
      null,
      2,
    );
  if (client === "Claude Code")
    value = JSON.stringify(
      { mcpServers: { "dbmux-dev": { type: "http", ...remote } } },
      null,
      2,
    );
  if (client === "VS Code")
    value = JSON.stringify(
      {
        servers: {
          "dbmux-dev": {
            type: "http",
            url: installationUrl,
            headers: { Authorization: "Bearer ${env:DB_MCP_TOKEN}" },
          },
        },
      },
      null,
      2,
    );
  if (client === "STDIO Bridge")
    value = JSON.stringify(
      {
        mcpServers: {
          "dbmux-dev": {
            command: "node",
            args: [
              "/absolute/path/to/dbmux/bridge/index.mjs",
              "--url",
              installationUrl,
            ],
            env: { DB_MCP_TOKEN: "set-in-client-environment" },
          },
        },
      },
      null,
      2,
    );
  $("clientConfig").textContent = value;
}
for (const name of [
  "Claude Code",
  "Codex",
  "Cursor",
  "VS Code",
  "Generic MCP",
  "STDIO Bridge",
])
  $("clientTabs").append(button(name, () => showClient(name)));
$("copyConfig").onclick = () =>
  navigator.clipboard.writeText($("clientConfig").textContent).catch(report);
api("/setup")
  .then((value) => {
    setup = value.setupRequired;
    $("bootstrap").hidden = !setup;
  })
  .catch(report);
