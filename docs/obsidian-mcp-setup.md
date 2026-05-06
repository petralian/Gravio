# Obsidian MCP Server — Setup Guide

The Gravio repo ships a lightweight MCP (Model Context Protocol) server at `scripts/obsidian-mcp-server.mjs`. It lets any MCP-aware AI assistant (Claude Desktop, VS Code Copilot with MCP support, Cursor, etc.) read and write notes directly in your Gravio Obsidian vault without leaving the coding session.

---

## What it exposes

| Tool | Purpose |
|---|---|
| `obsidian_read` | Read any note in the Gravio vault |
| `obsidian_append` | Append text to a note (creates if missing) |
| `obsidian_write` | Full overwrite of a note |

All three tools are sandboxed to `C:\Obsidian\obsidian\40_Projects (Personal)\Gravio\` — paths that escape the vault root are rejected.

---

## Claude Desktop configuration

Add this block to your `claude_desktop_config.json` (usually at `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gravio-obsidian": {
      "command": "node",
      "args": ["D:\\VS Code Projects\\Gravio\\scripts\\obsidian-mcp-server.mjs"]
    }
  }
}
```

Restart Claude Desktop. The three tools will appear in the tool list automatically.

---

## VS Code Copilot (MCP) configuration

If you use VS Code with MCP support enabled, add to your workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "gravio-obsidian": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/scripts/obsidian-mcp-server.mjs"]
    }
  }
}
```

---

## Cursor configuration

Add to `.cursor/mcp.json` in the repo root:

```json
{
  "mcpServers": {
    "gravio-obsidian": {
      "command": "node",
      "args": ["D:\\VS Code Projects\\Gravio\\scripts\\obsidian-mcp-server.mjs"]
    }
  }
}
```

---

## npm convenience scripts

```powershell
npm run obsidian:mcp        # start the MCP server manually (for testing)
```

---

## Testing the server manually

```powershell
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}' | node scripts/obsidian-mcp-server.mjs
```

Should return the server info response.

---

## Session summary contract

At the end of every session, AI assistants should call `obsidian_append` with path `Operations/Session Summaries.md` and content matching this format:

```
## YYYY-MM-DD — <Session Title>

**Objective:** <one line>
**Changes made:** <comma-separated list>
**Files changed:** <comma-separated list>
**Deploy needed:** Yes/No — reason
**Open loops carried forward:** <bullet list>
**Next session start:** <one action>

---
```
