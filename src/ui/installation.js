export const clients = {
  Codex: {
    instructions:
      "Save in your user ~/.codex/config.toml (on Windows: %USERPROFILE%\\.codex\\config.toml). Project-scoped .codex/config.toml works for trusted projects. Codex reads the bearer token from the DB_MCP_TOKEN variable at connection time.",
    docs: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli",
  },
  "Claude Code": {
    instructions:
      "Save as .mcp.json in your project (project scope, shared with the team after approval), or use claude mcp add --scope user for a personal configuration. Approve the project MCP server when Claude Code asks.",
    docs: "https://code.claude.com/docs/en/mcp",
  },
  Cursor: {
    instructions:
      "Save in ~/.cursor/mcp.json for your user, or .cursor/mcp.json in your project. Restart Cursor (or toggle the server under Customize) after setting the environment.",
    docs: "https://cursor.com/docs/mcp",
  },
  "VS Code": {
    instructions:
      "Editor-managed configuration for the deprecated Local harness (removal planned for February 2027): save as .vscode/mcp.json in your project or in your user profile, then start the server from VS Code’s MCP controls. For new setups, prefer the GitHub Copilot profile, which the native Copilot harness reads.",
    docs: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration",
  },
  "GitHub Copilot": {
    instructions:
      "Native Copilot harness configuration (also read by GitHub Copilot in VS Code). Save as ~/.copilot/mcp-config.json for your user (or $COPILOT_HOME/mcp-config.json when COPILOT_HOME is set) to use the server across workspaces, or as .mcp.json at the workspace root to share it with the team. The Authorization header references ${DB_MCP_TOKEN}; provide the variable in the environment of the host that actually runs or connects to the server — the shell, container, dev-container or remote runner that launches the harness. Do not commit real tokens; this file contains references only. For remote/Dev Container sessions, configure the server in the execution environment, or use a forwarded configuration instead of relying on your local user file.",
    docs: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration",
  },
  "Generic MCP": {
    instructions:
      "Adapt this template to your client’s Streamable HTTP configuration. Check whether it expands environment variables in headers; if it does not, provide the token through the client’s own secret or environment mechanism instead of pasting it into the file.",
  },
  "STDIO Bridge": {
    instructions:
      "Run npm ci in the bridge directory first. Replace the absolute path below with your local bridge/index.mjs path. The client process must inherit DB_MCP_TOKEN. A pinned npx launch command is documented for after the @dbmux/db-mcp-bridge package is published; until a release is available, use the local checkout.",
  },
};

export function clientConfiguration(client, url) {
  const remote = { url, headers: { Authorization: "Bearer ${DB_MCP_TOKEN}" } };
  if (client === "Codex")
    return `[mcp_servers.dbmux-dev]\nurl = ${JSON.stringify(url)}\nbearer_token_env_var = "DB_MCP_TOKEN"`;
  if (client === "VS Code")
    return JSON.stringify(
      {
        servers: {
          "dbmux-dev": {
            type: "http",
            url,
            headers: { Authorization: "Bearer ${env:DB_MCP_TOKEN}" },
          },
        },
      },
      null,
      2,
    );
  if (client === "GitHub Copilot")
    return JSON.stringify(
      {
        mcpServers: {
          "dbmux-dev": {
            type: "http",
            url,
            headers: { Authorization: "Bearer ${DB_MCP_TOKEN}" },
            tools: ["*"],
          },
        },
      },
      null,
      2,
    );
  if (client === "STDIO Bridge")
    return JSON.stringify(
      {
        mcpServers: {
          "dbmux-dev": {
            command: "node",
            args: ["/absolute/path/to/dbmux/bridge/index.mjs", "--url", url],
          },
        },
      },
      null,
      2,
    );
  return JSON.stringify(
    {
      mcpServers: {
        "dbmux-dev":
          client === "Claude Code"
            ? { type: "http", ...remote }
            : client === "Cursor"
              ? {
                  url,
                  headers: { Authorization: "Bearer ${env:DB_MCP_TOKEN}" },
                }
              : remote,
      },
    },
    null,
    2,
  );
}

export const shellCommands = {
  PowerShell: '$env:DB_MCP_TOKEN = "YOUR_PERSONAL_TOKEN"',
  "macOS / Linux": 'export DB_MCP_TOKEN="YOUR_PERSONAL_TOKEN"',
  "Command Prompt": 'set "DB_MCP_TOKEN=YOUR_PERSONAL_TOKEN"',
};

export function teamHandoff(url, client, guideUrl) {
  return `DBMux — developer setup\n\nMCP endpoint: ${url}\nUser guide: ${guideUrl}\n\n1. Request your personal token from the administrator through a private channel.\n2. Set DB_MCP_TOKEN in the environment used to launch your client. Replace YOUR_PERSONAL_TOKEN locally; provide the variable to the process, container or remote runner that actually executes the harness:\n\n${Object.entries(
    shellCommands,
  )
    .map(([name, command]) => `${name}:\n${command}`)
    .join(
      "\n\n",
    )}\n\n3. ${clients[client].instructions}\n\n${clientConfiguration(client, url)}\n\n4. Restart/reconnect the client and ask: Use DBMux to call db_connections and list my available development connections without making changes.\n\nDatabase drivers and database passwords are not needed on your machine. Never commit tokens. For remote access use HTTPS. Your permissions are limited by both your token and the connection policy.\n`;
}
