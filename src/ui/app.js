import {
  clients,
  clientConfiguration,
  shellCommands,
  teamHandoff,
} from "./installation.js";
import { copyText } from "./clipboard.js";
let session = "";
let setup = false;
let editing = false;
let oneTimeToken = "";
let installationUrl = "";
let history = [];
let selectedClient = "Codex";
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
  $("message").classList.toggle("error", e instanceof Error);
}
function button(label, fn) {
  const b = document.createElement("button");
  b.textContent = label;
  b.type = "button";
  b.onclick = async () => {
    b.disabled = true;
    try {
      await fn();
    } catch (error) {
      report(error);
    } finally {
      b.disabled = false;
    }
  };
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
  $("connectionCount").textContent = connections.length;
  $("enabledCount").textContent = connections.filter((c) => c.enabled).length;
  $("connectionOptions").replaceChildren(
    ...connections.map((c) => {
      const option = document.createElement("option");
      option.value = c.id;
      option.label = c.name;
      return option;
    }),
  );
  $("connectionList").replaceChildren(
    ...connections.map((c) => {
      const a = item(
        `${c.name} · ${c.engine} · ${c.enabled ? "MCP enabled" : "MCP disabled"} · ${c.id}`,
      );
      a.append(
        button("Copy connection ID", () => copyText(c.id, null, report)),
        button("Test", async () => {
          const result = await api("/connections/" + c.id + "/test", "POST");
          report(
            result.connected
              ? `${c.name} connected successfully${Number.isFinite(result.latencyMs) ? ` in ${Math.round(result.latencyMs)} ms` : ""}.`
              : "Connection test did not confirm connectivity.",
          );
        }),
        button(c.enabled ? "Disable MCP" : "Enable MCP", async () => {
          await api("/connections/" + c.id, "PUT", { enabled: !c.enabled });
          await refresh();
        }),
        button("Edit policy", () => {
          editing = true;
          const f = $("connectionForm");
          f.reset();
          $("connectionHeading").textContent = "Edit connection: " + c.name;
          f.elements.id.value = c.id;
          f.elements.id.readOnly = true;
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
          updateEngineFields();
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
          f.scrollIntoView({ behavior: "smooth", block: "start" });
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
  if (!connections.length)
    $("connectionList").append(
      item("No connections yet. Add your first development database below."),
    );
  const tokens = await api("/tokens");
  $("tokenCount").textContent = tokens.filter(
    (t) => !t.revoked && t.expiresAt > Date.now(),
  ).length;
  $("tokenList").replaceChildren(
    ...tokens.map((t) => {
      const a = item(
        `${t.name} · ${t.connections.join(", ")} · ${t.revoked ? "revoked" : "expires " + new Date(t.expiresAt).toLocaleString()}`,
      );
      a.append(
        button("Copy connection IDs", () =>
          copyText(t.connections.join(", "), null, report),
        ),
      );
      if (!t.revoked)
        a.append(
          button("Revoke", async () => {
            if (
              !confirm(
                "Revoke this developer token? Its owner will lose access immediately.",
              )
            )
              return;
            await api("/tokens/" + t.id, "DELETE");
            await refresh();
          }),
          button("Rotate", async () => {
            if (
              !confirm(
                "Replace this token? The existing token stops working immediately. Copy and deliver the replacement to its owner.",
              )
            )
              return;
            const value = await api("/tokens/" + t.id + "/rotate", "POST");
            revealToken(value.token);
            await refresh();
          }),
        );
      return a;
    }),
  );
  if (!tokens.length)
    $("tokenList").append(
      item(
        "No developer tokens yet. Create a personal token with explicit connection access.",
      ),
    );
}
$("login").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const a = fields(e.target);
    if (setup) {
      await api(
        "/setup",
        "POST",
        { name: a.name, password: a.password },
        a.setupToken,
      );
      setup = false;
      $("bootstrap").hidden = true;
      $("loginButton").textContent = "Sign in";
    }
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
    $("endpoint").textContent = installationUrl;
    showClient("Codex");
  } catch (error) {
    report(error);
  }
};
$("logout").onclick = async () => {
  try {
    await api("/logout", "POST");
  } catch (error) {
    report(error);
  } finally {
    session = "";
    oneTimeToken = "";
    $("newToken").textContent = "";
    $("tokenReveal").hidden = true;
    $("copyToken").disabled = true;
    history = [];
    $("auditList").replaceChildren();
    $("connectionList").replaceChildren();
    $("tokenList").replaceChildren();
    $("connectionForm").reset();
    $("resetConnection").click();
    $("tokenForm").reset();
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
        $("tokenReveal").hidden = true;
        $("copyToken").disabled = true;
      }
      document.querySelectorAll("[data-page]").forEach((tab) => {
        if (tab === b) tab.setAttribute("aria-current", "page");
        else tab.removeAttribute("aria-current");
      });
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
    editing = true;
    f.elements.id.readOnly = true;
    $("connectionHeading").textContent = "Edit connection: " + a.name;
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
  $("connectionForm").elements.id.readOnly = false;
  $("connectionHeading").textContent = "Add a connection";
  updateEngineFields();
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
    revealToken(value.token);
    await refresh();
  } catch (error) {
    report(error);
  }
};
$("copyToken").onclick = () => copyText(oneTimeToken, $("copyToken"), report);
function revealToken(token) {
  oneTimeToken = token;
  $("newToken").textContent = token;
  $("tokenReveal").hidden = false;
  $("copyToken").disabled = false;
}
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
        d.append(
          s,
          p,
          button("Copy details", () => copyText(p.textContent, null, report)),
        );
        if (typeof r.payload?.sql === "string")
          d.append(
            button("Copy SQL", () => copyText(r.payload.sql, null, report)),
          );
        a.append(d);
        return a;
      }),
  );
  if (!$("auditList").children.length)
    $("auditList").append(
      item(
        history.length
          ? "No history matches your search."
          : "No history found for this connection at this offset.",
      ),
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
  selectedClient = client;
  $("clientConfig").textContent = clientConfiguration(client, installationUrl);
  $("clientInstructions").textContent = clients[client].instructions;
  $("clientNote").textContent =
    client === "STDIO Bridge"
      ? "The bridge supports HTTPS or loopback HTTP only. It contains no database drivers."
      : "The configuration references your environment variable; it never includes your personal token.";
  $("clientDocs").hidden = !clients[client].docs;
  if (clients[client].docs) $("clientDocs").href = clients[client].docs;
  for (const tab of $("clientTabs").children)
    tab.setAttribute("aria-pressed", String(tab.textContent === client));
}
for (const name of Object.keys(clients))
  $("clientTabs").append(button(name, () => showClient(name)));
for (const [name, command] of Object.entries(shellCommands)) {
  const tab = button(name, () => {
    $("tokenCommand").textContent = command;
    $("shellLabel").textContent = name;
    for (const other of $("shellTabs").children)
      other.setAttribute("aria-pressed", String(other === tab));
  });
  $("shellTabs").append(tab);
}
$("shellTabs").firstElementChild.click();
$("copyConfig").onclick = () =>
  copyText($("clientConfig").textContent, $("copyConfig"), report);
$("copyHandoff").onclick = () =>
  copyText(
    teamHandoff(
      installationUrl,
      selectedClient,
      new URL("/guide.html#developers", location.href).href,
    ),
    $("copyHandoff"),
    report,
  );
document
  .querySelectorAll("[data-copy]")
  .forEach(
    (b) =>
      (b.onclick = () => copyText($(b.dataset.copy).textContent, b, report)),
  );
function updateEngineFields() {
  const f = $("connectionForm");
  const oracle = f.elements.engine.value === "oracle";
  for (const name of ["connectString", "sid"])
    f.elements[name].closest("label").hidden = !oracle;
  f.elements.ssl.closest("label").hidden = oracle;
  f.elements.customPermissions.closest("label").hidden =
    f.elements.access.value !== "custom";
}
$("connectionForm").elements.access.onchange = updateEngineFields;
$("connectionForm").elements.engine.onchange = () => {
  $("connectionForm").elements.port.value =
    $("connectionForm").elements.engine.value === "oracle" ? 1521 : 5432;
  updateEngineFields();
};
updateEngineFields();
api("/setup")
  .then((value) => {
    setup = value.setupRequired;
    $("bootstrap").hidden = !setup;
    $("loginButton").textContent = setup ? "Create administrator" : "Sign in";
  })
  .catch(report);
for (const form of document.querySelectorAll("form")) {
  const submit = form.onsubmit;
  if (!submit) continue;
  let pending = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    const buttons = [...form.querySelectorAll("button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      await submit(event);
    } finally {
      pending = false;
      buttons.forEach((b) => (b.disabled = false));
    }
  };
}
