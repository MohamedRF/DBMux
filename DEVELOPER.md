# DBMux — Developer Setup & Agent Playbook

**Audience:** developers, and the coding agents they run, working on any project backed by a DBMux development database.

This file has two independent parts:

| Part                            | Who does it                            | What it is                                                                                                  |
| ------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Part 1 — Setup**              | The developer, once per machine/client | Install the `dbmux-dev` MCP server into your coding agent, globally or per project.                         |
| **Part 2 — Agent instructions** | The coding agent                       | A copy-paste block for your project's `AGENTS.md` that makes _any_ agent follow the same database workflow. |

Part 2 is written for the two stacks in use here — **Node.js** and **CodeIgniter 4** — and stays short enough to paste as-is. It also holds up when one agent session touches more than one repository.

## How to use this file

You are handed this file with **your personal token** already filled in (or a `YOUR_PERSONAL_TOKEN` placeholder if you received a template). Three steps, in order:

| Step  | What you do                                               | Where                                               |
| ----- | --------------------------------------------------------- | --------------------------------------------------- |
| **1** | Put your token in your environment as `DB_MCP_TOKEN`      | [§1.2](#12-put-the-token-in-your-environment)       |
| **2** | Install the `dbmux-dev` MCP server into your coding agent | [§1.3](#13-install-dbmux-into-your-coding-agent)    |
| **3** | Copy the Part 2 block into your project's `AGENTS.md`     | [Part 2](#part-2--copy-into-your-projects-agentsmd) |

After step 3, any coding agent in that project — Claude Code, Codex, Cursor, Copilot, Cline, Kilo Code, Antigravity — automatically knows to use the MCP for database work, because the `AGENTS.md` tells it to.

> **Do this once per repository.** Step 1 and 2 are per machine. Step 3 is per repository, and you commit the `AGENTS.md` so the whole team gets it.

---

# Part 1 — Setup

## 1.1 Your details

| Item                       | Value                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| MCP endpoint               | `http://10.150.0.175:3001/mcp`                                                                                 |
| Server name                | `dbmux-dev`                                                                                                    |
| Transport                  | Streamable HTTP, stateless (`POST` to `/mcp`)                                                                  |
| Authentication             | `Authorization: Bearer <your personal token>`                                                                  |
| Token environment variable | `DB_MCP_TOKEN`                                                                                                 |
| Your token                 | `YOUR_PERSONAL_TOKEN` — replace every occurrence of this placeholder with the token the administrator gave you |
| Connection IDs             | Ask your administrator, or list them with the `db_connections` tool                                            |

> Your token is **personal, scoped, revocable and expiring**. It is not a shared secret. Never commit it, paste it into a ticket, or read it out loud in a shared screen. Every tool call is re-authorized against your token _and_ the connection policy, so a leaked token is a scoped, auditable, revocable risk — but it is still a leak.
>
> Because this file is handed to you with your token in it, treat the file itself as a secret: do not forward it, do not commit it, and delete it once the setup is done.

You do **not** need database drivers, database passwords, or a local database client on your machine. Credentials stay on the DBMux server.

## 1.2 Put the token in your environment

**macOS / Linux (bash, zsh)**

```bash
export DB_MCP_TOKEN="YOUR_PERSONAL_TOKEN"
```

**Windows PowerShell**

```powershell
$env:DB_MCP_TOKEN = "YOUR_PERSONAL_TOKEN"
```

**Windows Command Prompt**

```cmd
set "DB_MCP_TOKEN=YOUR_PERSONAL_TOKEN"
```

To make it permanent for your user account:

- **macOS / Linux** — add the `export` line to `~/.zshrc` or `~/.bashrc`, or use your shell's secret manager.
- **Windows** — `setx DB_MCP_TOKEN "YOUR_PERSONAL_TOKEN"`, then reopen your terminal **and** your editor.

> **GUI clients** (Cursor, VS Code, Antigravity, Cline, Kilo Code) only see environment variables they inherit. Launch them from a shell that has `DB_MCP_TOKEN` set, or set it in the OS user environment and fully restart the application. An app started before the variable existed keeps the old, empty environment.

## 1.3 Install DBMux into your coding agent

Pick your client. Each block gives the **global** form (this machine, every project) and the **project** form (this repository only). The server name must stay `dbmux-dev` so tool names resolve consistently as `dbmux-dev-db_*`.

**First, pick how the token is supplied:**

| Your client   | Can it read `DB_MCP_TOKEN` from the environment? | Use                                                  |
| ------------- | ------------------------------------------------ | ---------------------------------------------------- |
| Codex         | Yes — `bearer_token_env_var`                     | The Codex block below                                |
| Claude Code   | Yes — `${VAR}` in headers                        | The Claude Code block below                          |
| Cursor        | Yes — `${env:VAR}` in headers                    | The Cursor block below                               |
| VS Code       | Yes — `${env:VAR}` in headers                    | The VS Code block below                              |
| Antigravity   | **No**                                           | Literal token in a private file, or the STDIO bridge |
| Kilo Code     | **No**                                           | Literal token in a private file, or the STDIO bridge |
| Cline         | **No**                                           | Literal token in a private file, or the STDIO bridge |
| Anything else | Usually yes, but the syntax varies               | Try the Generic block; fall back to the STDIO bridge |

> With an environment variable, the token never touches a file, and the same config file works for every developer — which is why the project-level blocks below are safe to commit.

---

### Codex

**Global** — `~/.codex/config.toml` (Windows: `%USERPROFILE%\.codex\config.toml`):

```toml
[mcp_servers.dbmux-dev]
url = "http://10.150.0.175:3001/mcp"
bearer_token_env_var = "DB_MCP_TOKEN"
```

**Project** — `.codex/config.toml` in the repository root, same block. Codex only loads a project `.codex/` layer once you **trust** the project.

**CLI (writes the global file):**

```bash
codex mcp add dbmux-dev --url "http://10.150.0.175:3001/mcp" --bearer-token-env-var DB_MCP_TOKEN
codex mcp list
```

`bearer_token_env_var` is the safest option: Codex reads the variable at connect time, so the token value never lands in a file.

---

### Claude Code

**Global** (this machine, all projects):

```bash
claude mcp add --transport http --scope user dbmux-dev "http://10.150.0.175:3001/mcp" --header "Authorization: Bearer ${DB_MCP_TOKEN}"
```

**Project** — `.mcp.json` in the repository root (safe to commit; the token stays a variable):

```json
{
  "mcpServers": {
    "dbmux-dev": {
      "type": "http",
      "url": "http://10.150.0.175:3001/mcp",
      "headers": { "Authorization": "Bearer ${DB_MCP_TOKEN}" }
    }
  }
}
```

Claude Code expands `${VAR}` inside `headers`. `"type": "http"` is **required** — an entry with `url` but no `type` is silently skipped. Use `--scope local` for a per-project, uncommitted entry. Teammates approve the project server on first prompt.

---

### Cursor

**Global** — `~/.cursor/mcp.json`. **Project** — `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "dbmux-dev": {
      "url": "http://10.150.0.175:3001/mcp",
      "headers": { "Authorization": "Bearer ${env:DB_MCP_TOKEN}" }
    }
  }
}
```

Cursor uses `${env:VAR}`, **not** `${VAR}`. Restart Cursor after changing the environment.

---

### VS Code

**Project** — `.vscode/mcp.json` in the repository root.
**Global** — the user-profile `mcp.json`:

| OS      | Path                                               |
| ------- | -------------------------------------------------- |
| macOS   | `~/Library/Application Support/Code/User/mcp.json` |
| Windows | `%APPDATA%\Code\User\mcp.json`                     |
| Linux   | `~/.config/Code/User/mcp.json`                     |

```json
{
  "servers": {
    "dbmux-dev": {
      "type": "http",
      "url": "http://10.150.0.175:3001/mcp",
      "headers": { "Authorization": "Bearer ${env:DB_MCP_TOKEN}" }
    }
  }
}
```

VS Code uses a top-level **`servers`** object, not `mcpServers`. Start the server from VS Code's MCP controls, or pick it in the Copilot chat MCP picker.

**Optional — never write the token to a file.** VS Code input variables prompt once and store the value in the OS credential store:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "dbmux-token",
      "description": "DBMux personal token",
      "password": true
    }
  ],
  "servers": {
    "dbmux-dev": {
      "type": "http",
      "url": "http://10.150.0.175:3001/mcp",
      "headers": { "Authorization": "Bearer ${input:dbmux-token}" }
    }
  }
}
```

---

### Antigravity (Google)

**Global** — `~/.gemini/config/mcp_config.json`. **Project** — `.agents/mcp_config.json`:

```json
{
  "mcpServers": {
    "dbmux-dev": {
      "serverUrl": "http://10.150.0.175:3001/mcp",
      "headers": { "Authorization": "Bearer YOUR_PERSONAL_TOKEN" }
    }
  }
}
```

In the IDE: agent side panel `⋯` → **MCP Servers** → **Manage MCP Servers** → **View raw config**.

Two Antigravity-specific rules:

1. The transport key is **`serverUrl`**, not `url`. Older builds that see `url` treat the entry as a different shape and never load it.
2. Antigravity does **not** expand environment variables in headers. `Bearer ${DB_MCP_TOKEN}` is transmitted literally and the server answers `401`. Either write the real token into this file (keep it out of git and restrict the file permissions) or use the **STDIO bridge** below.

---

### Kilo Code

**Global** — `~/.config/kilo/kilo.jsonc`. **Project** — `kilo.jsonc` in the repository root, or `.kilo/kilo.jsonc`:

```jsonc
{
  "mcp": {
    "dbmux-dev": {
      "type": "remote",
      "url": "http://10.150.0.175:3001/mcp",
      "headers": { "Authorization": "Bearer YOUR_PERSONAL_TOKEN" },
      "enabled": true,
    },
  },
}
```

Kilo Code 7.x uses the top-level **`mcp`** key (not `mcpServers`), `"type": "remote"`, and `"enabled": true`. Project-level config takes precedence over global. Like Antigravity, Kilo does not expand environment variables in headers — write the token literally and keep the file out of version control, or use the **STDIO bridge**.

> The trailing commas above are valid in `.jsonc` (Kilo's default). If you name the file `kilo.json` instead, remove them — strict JSON does not allow trailing commas.

---

### Cline

**Global** — one file shared by every workspace:

| Platform      | Path                                                         |
| ------------- | ------------------------------------------------------------ |
| macOS / Linux | `~/.cline/data/settings/cline_mcp_settings.json`             |
| Windows       | `%USERPROFILE%\.cline\data\settings\cline_mcp_settings.json` |

In the Cline panel: **MCP Servers** icon → **Configure** tab → **Configure MCP Servers** (Cline opens the real file for you).

```json
{
  "mcpServers": {
    "dbmux-dev": {
      "type": "streamableHttp",
      "url": "http://10.150.0.175:3001/mcp",
      "headers": { "Authorization": "Bearer YOUR_PERSONAL_TOKEN" }
    }
  }
}
```

Cline reads **its own** `cline_mcp_settings.json`; it does not read `.vscode/mcp.json`. Older Cline builds kept the file in the VS Code extension global storage (`.../globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`) and migrate it on first launch. Cline does not expand environment variables in headers, so use the literal token or the **STDIO bridge**.

**Easiest route:** Cline panel → **MCP Servers** → **Remote Servers** tab → Server Name `dbmux-dev`, Server URL `http://10.150.0.175:3001/mcp`, Transport Type **Streamable HTTP**.

---

### Generic MCP client (any other client)

Three things every client needs: the URL, the auth header, and the transport named _Streamable HTTP_.

```json
{
  "mcpServers": {
    "dbmux-dev": {
      "type": "http",
      "url": "http://10.150.0.175:3001/mcp",
      "headers": { "Authorization": "Bearer ${DB_MCP_TOKEN}" }
    }
  }
}
```

Client-to-client differences to reconcile:

| Variation                                            | Where it appears       |
| ---------------------------------------------------- | ---------------------- |
| `"type": "http"` vs `"streamableHttp"` vs `"remote"` | Transport key          |
| `"url"` vs `"serverUrl"`                             | Remote address key     |
| `${VAR}` vs `${env:VAR}` vs literal token            | Header variable syntax |
| `mcpServers` vs `servers` vs `mcp`                   | Top-level object       |

If your client expands none of these, use the **STDIO bridge** below.

---

### STDIO bridge (works with every client)

Use the bridge when your client only speaks STDIO, or when it cannot expand an environment variable in a header (Antigravity, Kilo Code, Cline). The bridge is a local Node script that reads `DB_MCP_TOKEN` from the environment it inherits and forwards MCP messages to DBMux. It contains **no database drivers and no credentials**.

```bash
cd bridge
npm ci
DB_MCP_TOKEN=YOUR_PERSONAL_TOKEN node index.mjs --url http://10.150.0.175:3001/mcp
```

Client configuration:

```json
{
  "mcpServers": {
    "dbmux-dev": {
      "command": "node",
      "args": [
        "/absolute/path/to/dbmux/bridge/index.mjs",
        "--url",
        "http://10.150.0.175:3001/mcp"
      ]
    }
  }
}
```

> **Network requirement.** The bridge accepts **HTTPS**, or **HTTP on loopback only** (`localhost`, `127.0.0.1`, `[::1]`). It will refuse `http://10.150.0.175:3001/mcp` outright. To use the bridge you need either:
>
> - the gateway published over **HTTPS**, or
> - a local port forward, e.g. `ssh -L 3001:10.150.0.175:3001 user@bastion`, then point the bridge at `http://127.0.0.1:3001/mcp`.
>
> The bridge also rejects URL-embedded credentials and redirects, to protect the `Authorization` header.

---

## 1.4 Global or project-local?

| Scope                    | Put it where                                                                                         | Use when                                                                                        | Trade-off                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Global (user)**        | User profile config of your client                                                                   | You work on several repositories and want DBMux everywhere                                      | Every project sees the server, including ones with no database |
| **Project (repository)** | `.mcp.json`, `.vscode/mcp.json`, `.codex/config.toml`, `.agents/mcp_config.json`, `.kilo/kilo.jsonc` | The whole team should get the same database access, or the repo maps to one specific connection | Teammates must approve the server on first use                 |

Recommended pattern: **project-local config committed to the repository** (the token stays an environment variable, so the file is safe to commit) **plus a global install for your own machine** so side projects still work. The agent-side rules in Part 2 then live in the repository's `AGENTS.md`, where the whole team gets them.

**Do not commit** a file that contains a literal token. If a client forces a literal token (Antigravity, Kilo Code, Cline), keep that file outside the repository or add it to `.gitignore`.

## 1.5 Verify the connection

Restart the client, then send:

```text
Use DBMux to call db_connections and list my available development connections. Do not make changes.
```

You should get a list of connections, each with `id`, `name`, `engine` and `permissions`.

| Symptom                                             | Cause                                                                                              | Fix                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `401` / client says "unauthorized"                  | `DB_MCP_TOKEN` missing, wrong, expired or revoked                                                  | Re-set the variable; confirm the client process can read it; ask the admin to check expiry |
| `403 HOST_DENIED`                                   | The URL host does not match the server's `PUBLIC_URL`                                              | Use the exact hostname from the administrator (e.g. `10.150.0.175`, not a DNS alias)       |
| `403 ORIGIN_DENIED`                                 | A client sent an `Origin` header that does not match `PUBLIC_URL`                                  | Use the exact origin, or configure the client not to send `Origin`                         |
| Connection list is empty                            | The connection is not MCP-enabled, or not in your token's scope                                    | Ask the administrator to enable MCP on the connection and grant it to your token           |
| Tools missing / server not listed                   | Wrong config key for your client (`mcpServers` vs `servers` vs `mcp`), or missing `"type": "http"` | Use the exact block for your client above                                                  |
| `db_query` returns "unauthorized" but listing works | Token lacks the `read` permission on that connection                                               | Ask the admin for a read grant                                                             |
| Token sent literally, server sees `${DB_MCP_TOKEN}` | Client does not expand environment variables                                                       | Use the literal token in a private file, or switch to the STDIO bridge                     |

---

# Part 2 — Copy into your project's `AGENTS.md`

This is the part you paste. It is **identical for every developer and every Node.js / CodeIgniter 4 repository** — no token, no endpoint and no machine-specific values are in it, so it is safe to commit to a shared repository.

1. Open the `AGENTS.md` of the repository you are working on (create it if the project does not have one). Claude Code and Codex read `AGENTS.md`; Cursor reads `.cursorrules` or `AGENTS.md`; Copilot reads `.github/copilot-instructions.md`; Cline and Kilo Code read their own rule files — the same content works there too.
2. Select the whole block inside the code fence below and paste it in.
3. Optionally fill in the **connection mapping** line in section 1 so the agent never has to ask which database to use. Leave the placeholder and the agent will ask instead — that is safe, just slower.

```markdown
## Database Workflow (DBMux `dbmux-dev` + SQL files)

### Hard rules

- Use the `dbmux-dev` MCP server for **every** database task: inspecting, reading, writing, DDL, and verifying results. Tools are `db_*`, shown as `dbmux-dev-db_*` in some clients; both names are the same tool.
- Never use a local client (`psql`, `mysql`, `sqlplus`, `sqlcmd`), an ORM/CLI, a GUI tool, application code, or a shell command to reach the database. If the gateway cannot do it, report it as pending — do not work around it.
- **Call the tool, don't describe it.** Do not hand SQL to the user to run.
- No `db_*` tool in the session means the MCP is not connected. Stop, report it, and ask the developer to check `DEVELOPER.md` and restart the client.
- This is the **development** database only. Production changes are applied manually by a human.

### 1. Resolve the connection (never guess)

1. Call `db_connections` once per session. It returns only `id`, `name`, `engine` and `permissions`.
2. Match this repository to a `connectionId`, in order: the mapping below → the project config in section 2 → the matching `name`/`id` → **ask the user**.
3. Re-resolve before each task if the session touches more than one repository, and state the `connectionId` in your reply.
4. Confirm with `db_connection_status` or `db_server_info`. If the `engine` contradicts the project config, stop and report it.

> **Connection mapping for this repository:** <!-- FILL IN: connectionId, or "ask the user" -->

### 2. Read the effective config from source

| Stack         | Where the database configuration lives                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| CodeIgniter 4 | `app/Config/Database.php` (`$groups`), overridden by `.env` (`database.default.*`)                           |
| Node.js       | `.env*`, `config/`, `src/config/`, `knexfile.*`, `prisma/schema.prisma`, `ormconfig.*`, `docker-compose.yml` |

- Ignore commented-out keys; the last active value wins. `.env` and deployment overlays override committed config.
- The configured `username` is the expected login schema, not the database name.
- Oracle: `host:port/service` with default port `1521`; `:SID` selects SID mode.
- Never print, log, or commit a password.

### 3. Inspect and confirm ownership

- Use the resolved `connectionId` for every call. Check identity with `db_connection_status`, then confirm the real object owner with `db_schema_context` or `db_search_objects` — DBMux may connect as a different user than the application.
- Pass the verified owner as `schema` to metadata tools. In SQL, qualify `<owner>.<object>` and filter `ALL_*` / `pg_catalog` / `information_schema` queries by owner. Query tools take no schema argument.
- The same table name in two schemas is not the same table.
- If `db_list_tables` or `db_describe_table` fails with `ORA-01745`, use `db_search_objects` plus an owner-qualified `db_query`; do not retry the metadata call or assume the object is missing.

### 4. Keep the SQL in the repository

| Stack         | Folder                                                   |
| ------------- | -------------------------------------------------------- |
| CodeIgniter 4 | `app/Database/Migrations/<Module>/`                      |
| Node.js       | `database/sql/<module>/`, or the existing `db/<module>/` |

- Keep an **idempotent** alter script and a current canonical schema file for the module. Plain SQL files, not framework migration classes.
- Guard against the verified owner's metadata, keep scripts portable across owners, and include prerequisites plus a commented rollback plan.
- If no folder exists, create one from verified definitions only, and say which one you created.
- Never bake a development owner name into a script.

### 5. Apply changes

- Preview with `db_preview_change` first (it classifies risk; it is not a dry run).
- DDL: the typed tools (`db_create_table`, `db_alter_table`, `db_create_index`, `db_create_view`/`db_replace_view`, …) or `db_execute_script` / `db_apply_migration` with explicit statements matching the saved SQL. Give each migration a unique `name`.
- DML: `db_execute`; always include a `WHERE` on `UPDATE`/`DELETE`. Use `db_transaction_*` for related writes.
- High-risk changes (e.g. `DELETE`) need `db_prepare_change` → **real human approval** → `db_execute_change` with the `changeId` and `confirm: true`. Prepared changes are single-use, owner-bound, and expire after 5 minutes.
- Stop on the first error. Oracle DDL commits implicitly and may leave partial changes; never call it reversible.
- Unsupported SQL (procedural blocks, `RETURNING`, multi-statement strings) → report it as pending, never bypass the gateway.

### 6. Verify every change

- Data → re-read the rows with `db_query`.
- Schema → re-inspect with `db_describe_table`, `db_list_indexes`, `db_list_constraints`, or a catalog query.
- Larger changes → `db_schema_snapshot` before and after, then `db_schema_diff`.
- An execution response is not proof. Report what was applied, what was verified, and what remains pending.

### 7. Gateway limits

| Limit                                                      | Instead                                    |
| ---------------------------------------------------------- | ------------------------------------------ |
| `db_query` is bounded `SELECT` only                        | `db_execute` or `db_execute_script`        |
| Multi-statement strings are denied                         | Pass a `statements` array                  |
| `RETURNING`, `CASCADE`, procedural/unknown SQL are denied  | Restructure the change or report it        |
| `UPDATE` / `DELETE` need a top-level `WHERE`               | Always write one                           |
| Oracle DDL commits implicitly                              | Run DDL outside transactions               |
| 100 rows per query (max 1,000); samples max 100            | Paginate with `limit` / `offset`           |
| PostgreSQL binds are `$1` + array; Oracle `:name` + object | Match the placeholder style to the engine  |
| Prepared changes expire after 5 minutes                    | Re-prepare after approval                  |
| Catalog results are paginated                              | Check `offset` before concluding "missing" |
| Blocked tables/columns are filtered out                    | Treat absence as policy, not missing data  |

### 8. Report

- `connectionId` used and how it was resolved; engine and verified owner of changed objects.
- Files created/changed, statements applied, and the verification done for each.
- Anything not done, and why. A clearly reported pending step is a success.

### 9. Core tools

`db_connections`, `db_connection_status`, `db_server_info` · `db_schema_context`, `db_list_*`, `db_describe_table`, `db_search_objects` · `db_query`, `db_sample_rows`, `db_explain` · `db_preview_change`, `db_prepare_change` → `db_execute_change` · `db_execute`, `db_execute_script`, `db_apply_migration`, `db_create_*`, `db_alter_table`, `db_replace_*`, `db_drop_*` · `db_transaction_begin` / `execute` / `commit` / `rollback` · `db_schema_snapshot`, `db_schema_diff`, `db_change_history`, `db_export_changes`, `db_migration_history`
```

---

## Appendix — Quick reference card

**Setup, 3 steps**

```bash
export DB_MCP_TOKEN="YOUR_PERSONAL_TOKEN"     # or $env:DB_MCP_TOKEN="..." on Windows
```

Then install the MCP server in your client (§1.3), and paste the Part 2 block into your project's `AGENTS.md`.

**Canonical JSON block** (works for Claude Code, Cursor, and most `mcpServers`-style clients):

```json
{
  "mcpServers": {
    "dbmux-dev": {
      "url": "http://10.150.0.175:3001/mcp",
      "headers": { "Authorization": "Bearer ${DB_MCP_TOKEN}" }
    }
  }
}
```

**Verify the MCP is live** (works in any client, and is the fastest way to confirm the `AGENTS.md` was picked up):

```text
Use DBMux to call db_connections and list my available development connections. Do not make changes.
```

**Verify the `AGENTS.md` was picked up:**

```text
Summarize, in one paragraph, how you are required to access the database in this project.
```

The agent should describe the `dbmux-dev` MCP server as the only database path. If it mentions `psql`, `sqlplus`, an ORM, or a shell script, the `AGENTS.md` block was not added correctly.

**Agent's daily loop**

```
resolve connectionId → inspect (db_schema_context / db_describe_table) → snapshot → preview → apply → verify → snapshot → diff
```
