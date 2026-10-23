# DBMux — Developer Setup & Agent Playbook

**Audience:** developers, and the coding agents they run, working on any project backed by a DBMux development database.

This file has two independent parts:

| Part                            | Who does it                            | What it is                                                                                                  |
| ------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Part 1 — Setup**              | The developer, once per machine/client | Install the `dbmux-dev` MCP server into your coding agent, globally or per project.                         |
| **Part 2 — Agent instructions** | The coding agent                       | A copy-paste block for your project's `AGENTS.md` that makes _any_ agent follow the same database workflow. |

Part 2 is written to be **stack-agnostic and multi-project**: it works for a CodeIgniter app, a Laravel app, a NestJS service or a Spring Boot service, and it holds up when one agent session touches more than one repository.

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

This is the part you paste. It is **identical for every developer and every project** — no token, no endpoint and no machine-specific values are in it, so it is safe to commit to a shared repository.

1. Open the `AGENTS.md` of the repository you are working on (create it if the project does not have one). Claude Code and Codex read `AGENTS.md`; Cursor reads `.cursorrules` or `AGENTS.md`; Copilot reads `.github/copilot-instructions.md`; Cline and Kilo Code read their own rule files — the same content works there too.
2. Select the whole block inside the code fence below and paste it in.
3. Optionally fill in the **Project → connection mapping** table in section 0 so the agent never has to ask which database to use. Leave it as the placeholder and the agent will ask instead — that is safe, just slower.

```markdown
## Database Workflow (DBMux `dbmux-dev` + SQL files)

### Scope and hard rules

Use the `dbmux-dev` MCP server for **every** database-related task, not only schema changes. This includes inspecting schemas and data, running read-only queries, inserting/updating/deleting data, applying alters and other DDL, and checking the result of any database operation.

**Do not** use application code, a local database client (`psql`, `sqlplus`, `sqlcmd`, `mysql`), an ORM CLI, a GUI database tool, or a raw shell command to connect to or change the database. The MCP server is the only sanctioned database path, because it is the path that enforces policy, records the audit trail, and redacts credentials. If a change cannot be made through the gateway, report that and leave the step pending — do not work around it.

The DBMux server is named `dbmux-dev`. Its tools are named `db_*`; clients that namespace tools show them as `dbmux-dev-db_*` (for example `mcp__dbmux-dev__db_query`). Both names refer to the same tool. The full list is in section 7.

**Call the tools — do not describe them.** When a task needs the database, call the `db_*` tool. Do not write the SQL and stop there, do not print the statement you _would_ run, and do not hand it to the user to execute. Run the tool, read the result, and continue from the actual state of the database.

**If no `db_*` tool is available in the session, the MCP server is not connected.** Do not fall back to a local database client, an ORM, an application script, or a shell command. Report that the `dbmux-dev` MCP server is unavailable, and ask the developer to verify the setup in the `DEVELOPER.md` setup section and restart the client.

This workflow targets the **verified development database**. Live deployment is performed manually by a human. Never point a production or staging database at the development workflow without explicit written authorization from the user.

### 0. Resolve the connection before anything else (multi-project rule)

Never call a database tool with a guessed `connectionId`.

1. Call `db_connections` once per session. It returns only `id`, `name`, `engine` and `permissions` — it does **not** return host, port, database or service.
2. Map the repository you are working in to a `connectionId`, in this order of preference:
   - a mapping recorded in the repository (for example `docs/db-connections.md`, `.dbmux.json`, or a table in this `AGENTS.md`);
   - the `name` or `id` in `db_connections` that matches the project's database, service or environment;
   - ask the user. **Never guess.**
3. If one repository could map to more than one connection, or the session spans several repositories, re-resolve before **each** task and state the chosen `connectionId` in your reply. Never carry a `connectionId` over from a previous task without re-checking it.
4. Confirm the live target with `db_connection_status` or `db_server_info` before the first substantive call. If the resolved connection's `engine` does not match what the repository config says, stop and report the mismatch.

> **Project → connection mapping for this repository**
> <!-- FILL IN: repo path → connectionId, or "ask the user" -->

### 1. Resolve the target configuration from the repository

Read the project's own database configuration to learn the engine, host, effective port, database or service, and login user. Do this from source, not from memory of the codebase.

Common locations:

| Stack              | Where the database configuration lives                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| CodeIgniter 4      | `app/Config/Database.php` (`$groups`), overridden by `.env` (`database.default.*`)                   |
| Laravel            | `config/database.php` + `.env` (`DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`) |
| Symfony            | `config/packages/doctrine.yaml`, `.env`                                                              |
| Django             | `settings.py` → `DATABASES`, or `DATABASE_URL`                                                       |
| Flask / SQLAlchemy | `settings.py`, `config.py`, `alembic.ini`                                                            |
| Rails              | `config/database.yml`                                                                                |
| Prisma             | `prisma/schema.prisma` + `.env`                                                                      |
| TypeORM            | `src/data-source.ts`, `ormconfig.json`                                                               |
| Sequelize          | `config/config.json`, `.sequelizerc`                                                                 |
| Knex               | `knexfile.js`, `knexfile.ts`                                                                         |
| Spring Boot        | `src/main/resources/application.yml`, `application-<profile>.yml`, `application.properties`          |
| .NET               | `appsettings.json`, `appsettings.Development.json`                                                   |
| Go                 | `config.go`, `internal/config`, environment variables                                                |
| Docker             | `docker-compose.yml` / `compose.yaml` `environment:` block                                           |
| CI                 | `.github/workflows/*.yml`, pipeline YAML                                                             |

Resolution rules:

- **Ignore commented-out settings.**
- **When a key is repeated in one file, the last active value wins.**
- **Apply the framework's override order.** In CodeIgniter 4 and Laravel, `.env` overrides the committed config file; in Spring Boot, environment variables and `--spring.config.*` override `application.yml`. Resolve the _effective_ value, not the shipped default.
- **Check deployment overlays.** In Docker or CI the effective value may come from `docker-compose.yml`, a `.env` file, or CI secrets. Read those before concluding what the value is.
- The configured **`username` is the expected login schema**. The `database` setting does not identify the object owner.
- **Oracle DSN.** Resolve host, service and effective port per the OCI8 rules: `host:port/service` is the normal connect string; a DSN with no explicit port uses **1521**; `:SID` selects SID mode; a full descriptor is used for a custom descriptor. Compare the resolved service against the connection you actually select in step 2.
- **Never expose credentials.** Do not print, echo, log, commit, or paste the password, and do not include it in any report. When showing configuration, redact the password.

### 2. Connect and inspect through `dbmux-dev`

- Use `db_connections` to match the engine of the connection against the engine in step 1, then use the returned `connectionId` with every other `db_*` tool. All access for this task goes through that `connectionId`.
- Verify the connected identity and current schema with `db_connection_status` or `db_server_info`, plus one appropriate read-only query.
- **Confirm the actual object owner before reading or changing objects.** DBMux may connect as a different user than the application uses. Pass the verified owner as `schema` to the metadata tools. For SQL queries, use owner-filtered `ALL_*` catalog queries (Oracle) or `pg_catalog`/`information_schema` queries (PostgreSQL), and qualify object names as `<owner>.<object>`.
- Query tools do **not** take a schema or owner argument. The only way to constrain a query is to qualify the object name in the SQL itself.
- **Never assume that matching object names imply matching owners.** Two schemas can hold a table with the same name.
- Schema and table arguments must match `^[A-Za-z_][A-Za-z0-9_$#]*$`. Oracle's usual unquoted uppercase owners are fine; a quoted, mixed-case owner is not, and must be handled through `db_search_objects` and a qualified query.

**Oracle metadata-tool fallback.** If `db_list_tables` or `db_describe_table` fails with `ORA-01745` (observed even for a known table and schema), do **not** treat that as proof the object is missing, and do not keep retrying the same metadata call. Instead:

1. Use `db_search_objects` to find the object's owner and kind.
2. Read the object through `db_query` with an explicitly owner-qualified name. For an initial data inspection use a bounded query such as `SELECT * FROM <owner>.<table> WHERE ROWNUM <= 100`; the result also reports the returned column names.
3. If column definitions are needed, query the appropriate owner-filtered Oracle catalog view read-only.

Keep gateway/metadata errors distinct from genuine SQL errors, and never bypass `dbmux-dev` to work around either.

### 3. Prepare and maintain SQL files

Database changes live in the repository as SQL, not only as agent actions.

- Find the folder the project already uses for schema and alter scripts, and use it:

  | Stack         | Schema / migration folder                                           |
  | ------------- | ------------------------------------------------------------------- |
  | CodeIgniter 4 | `app/Database/Migrations/<Module>/`                                 |
  | Laravel       | `database/migrations/` (classes) and `database/schema/<module>.sql` |
  | Symfony       | `migrations/`                                                       |
  | Django        | `<app>/migrations/` (classes) and `<app>/sql/` for raw SQL          |
  | Rails         | `db/migrate/`, `db/structure.sql`                                   |
  | Spring Boot   | `src/main/resources/db/migration/<module>/`                         |
  | .NET          | `Migrations/`                                                       |
  | Generic       | `database/sql/<module>/` or `db/<module>/`                          |

- If a folder already exists for the affected module, use it. If none exists, establish one from verified definitions rather than guessing, and say in your report which folder you created.
- Save an **idempotent** alter script in the module folder, and update that module's **canonical main schema file** to the same final definitions. These are plain SQL files, not framework migration classes.
- Guard additions against the verified owner's metadata, and check the existing definitions for compatibility before altering them.
- Use `USER_*` catalog guards **only** when you are actually connected as the target owner. Otherwise use `ALL_*` views filtered by owner.
- Keep scripts portable across development and live owners. **Do not bake a development owner name into a script** — parameterize it or guard it.
- Every script states its prerequisites and includes a commented rollback/recovery plan.
- If no canonical schema file exists for the module, create one only from definitions you have actually verified through the gateway.

### 4. Apply database changes through `dbmux-dev`

Work on a verified development connection.

- **Preview first.** Use `db_preview_change` to classify each statement and read its risk and permission result. It is a classifier, not a dry run and not a row-count estimate.
- **Apply** authorized, non-destructive schema changes with the matching `db_*` DDL tool (`db_create_table`, `db_alter_table`, `db_create_index`, `db_replace_view`, …) or with `db_execute_script` / `db_apply_migration`, passing explicit statements equivalent to the saved SQL file. Give migrations a unique `name`; names cannot be replayed by accident.
- **Data changes** go only through the `db_*` DML tools (`db_execute`) or the transaction tools. Use `db_transaction_begin` / `db_transaction_execute` / `db_transaction_commit` / `db_transaction_rollback` for related writes when the engine supports it.
- **High-risk changes** (for example a `DELETE` with a `WHERE` clause) require `db_prepare_change`, then a **real human approval**, then `db_execute_change` with the returned `changeId` and `confirm: true`. A prepared change is owner-bound, single-use, and expires after five minutes. The `confirm: true` flag is not evidence of approval — you must actually ask and wait for the user's answer.
- Supply `context` on writes so the change can be filtered later, e.g. `{"project":"my-project","branch":"feature/x"}`.
- **Stop on the first error.** Do not chain past a failure to "see if the rest works".
- **Oracle DDL commits implicitly**, and a failed script may leave partial changes behind. Do not assume a rollback is possible, and do not report an implicit commit as reversible.
- If the gateway cannot safely inspect or apply a required SQL construct — an unsupported dialect, a procedural block, a `RETURNING` clause, a multi-statement string — **do not bypass it**. Report the limitation and leave that step pending.

### 5. Verify every operation

After every insert, update, delete, alter, or other database change, check the result on the same verified target through `dbmux-dev`. An execution response is not proof of success.

- Data change → re-read the affected rows with `db_query`.
- Schema change → re-inspect the object with `db_describe_table`, `db_list_indexes`, `db_list_constraints`, or a read-only catalog query.
- For a larger change, capture a `db_schema_snapshot` before and after and compare with `db_schema_diff`.
- Keep **both** the alter script and the updated canonical schema file in the module folder.
- In your final report, state what was verified, what was applied, and what remains unapplied or unverified. Never claim a change was applied unless you verified it through `dbmux-dev`.

### 6. Live deployment

Live deployment is done by a human, manually, without the MCP server.

- Keep the canonical main schema file for the module complete and current. It is the artifact the user executes by hand.
- If it contains fresh-install `CREATE` statements, also identify the retained alter script needed to upgrade an existing database safely, and say which one the user should run.
- Never execute against production. Destructive or production operations require explicit user authorization, every time.

### 7. Tool reference

Tools are `db_*`; clients that namespace them show `dbmux-dev-db_*`.

| Purpose                                   | Tools                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discover connections and confirm identity | `db_connections`, `db_connection_status`, `db_test_connection`, `db_server_info`                                                                                                                                                                                                                                                      |
| Inspect catalogs                          | `db_list_schemas`, `db_list_tables`, `db_list_views`, `db_list_indexes`, `db_list_constraints`, `db_list_foreign_keys`, `db_list_sequences`, `db_list_triggers`, `db_list_routines`, `db_list_synonyms`, `db_list_enums`, `db_list_extensions`, `db_list_materialized_views`                                                          |
| Inspect one object                        | `db_describe_table`, `db_get_routine_source`, `db_search_objects`, `db_search_routine_source`, `db_object_dependencies`                                                                                                                                                                                                               |
| Build schema context                      | `db_schema_context`                                                                                                                                                                                                                                                                                                                   |
| Read data                                 | `db_query` (read-only SELECT), `db_sample_rows` (explicit columns, max 100 rows), `db_explain`                                                                                                                                                                                                                                        |
| Review a change                           | `db_preview_change`, `db_prepare_change` → `db_execute_change`                                                                                                                                                                                                                                                                        |
| Apply SQL and DDL                         | `db_execute`, `db_execute_script`, `db_apply_migration`, `db_create_table`, `db_alter_table`, `db_create_index`, `db_drop_index`, `db_create_sequence`, `db_drop_sequence`, `db_create_view`, `db_replace_view`, `db_drop_view`, `db_create_trigger`, `db_drop_trigger`, `db_create_routine`, `db_replace_routine`, `db_drop_routine` |
| Transactions                              | `db_transaction_begin`, `db_transaction_execute`, `db_transaction_commit`, `db_transaction_rollback`                                                                                                                                                                                                                                  |
| Review the trail                          | `db_schema_snapshot`, `db_schema_diff`, `db_change_history`, `db_export_changes`, `db_migration_history`                                                                                                                                                                                                                              |

The server also exposes read-only MCP resources: `db://connections`, `db://connections/{connectionId}/schemas`, `db://connections/{connectionId}/schemas/{schema}/tables`, `db://connections/{connectionId}/schemas/{schema}/tables/{table}`, and `db://connections/{connectionId}/schema-context`.

### 8. Gateway limits — work with them, not around them

| Limit                                                                                                 | What to do instead                                                      |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `db_query` accepts a bounded `SELECT` only; modifications are rejected                                | Use `db_execute`, or `db_execute_script` / `db_apply_migration`         |
| Multi-statement strings are denied                                                                    | Pass a `statements` array to `db_execute_script` / `db_apply_migration` |
| `RETURNING`, `CASCADE`, arbitrary procedural execution and unknown SQL are denied                     | Restructure the change, or report it as unsupported                     |
| `UPDATE` / `DELETE` without a top-level `WHERE` are denied by default                                 | Always write an explicit `WHERE`                                        |
| Oracle DDL commits implicitly and is forbidden inside a retained transaction                          | Run DDL outside the transaction, DML inside it                          |
| Queries default to 100 rows and cap at 1,000; `db_sample_rows` caps at 100                            | Paginate deliberately with `limit` and `offset`                         |
| PostgreSQL binds are positional (`$1`, with an array); Oracle binds are named (`:id`, with an object) | Match the placeholder style to the engine                               |
| Prepared changes are single-use, owner-bound, and expire after five minutes                           | Re-prepare if the approval takes longer than that                       |
| Catalog results are bounded and paginated                                                             | Use `offset`; do not assume an empty page means "no such object"        |
| Schema names outside the connection's allowed schemas are rejected                                    | Ask the administrator to widen the policy — do not work around it       |
| Blocked tables and columns are filtered from every response                                           | Treat the absence as a policy decision, not as missing data             |

### 9. Reporting rules

- State the `connectionId` used and how it was resolved.
- State the engine, and the resolved owner of any object you changed.
- List the files you created or changed, with paths.
- List the statements applied, and the verification you performed for each.
- List anything you could not do, and why. A pending step that is clearly reported is a success; a step you claim to have done without verifying it is a failure.
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
