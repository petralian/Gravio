#!/usr/bin/env node
/**
 * scripts/obsidian-mcp-server.mjs
 *
 * Minimal MCP (Model Context Protocol) server that exposes two tools to AI
 * coding assistants running in this repo:
 *
 *   obsidian_append   — append text (e.g. a session summary) to any note
 *                       under the Gravio Obsidian vault.
 *   obsidian_read     — read the contents of a vault note.
 *
 * Protocol: JSON-RPC 2.0 over stdio (MCP standard transport).
 *
 * Usage (Claude Desktop / VS Code MCP config):
 *   command: node
 *   args: ["D:\\VS Code Projects\\Gravio\\scripts\\obsidian-mcp-server.mjs"]
 *
 * See docs/obsidian-mcp-setup.md for full configuration instructions.
 */

import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, normalize } from "node:path";

// ── Vault root — only paths inside here are accessible ─────────────────────
const VAULT_ROOT = resolve("C:\\Obsidian\\obsidian\\40_Projects (Personal)\\Gravio");

// ── MCP protocol helpers ────────────────────────────────────────────────────
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function ok(id, content) {
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: content }],
      isError: false,
    },
  });
}

function err(id, message) {
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    },
  });
}

// ── Path safety: must stay inside VAULT_ROOT ────────────────────────────────
function safePath(relPath) {
  if (!relPath || typeof relPath !== "string") throw new Error("path is required");
  // Accept either forward or backslashes; resolve against vault root
  const target = normalize(join(VAULT_ROOT, relPath.replace(/\//g, "\\")));
  if (!target.startsWith(VAULT_ROOT + "\\") && target !== VAULT_ROOT) {
    throw new Error("path escapes vault root");
  }
  return target;
}

// ── Tool: obsidian_read ─────────────────────────────────────────────────────
function toolRead({ path: relPath }) {
  const target = safePath(relPath);
  if (!existsSync(target)) return `Note not found: ${relPath}`;
  return readFileSync(target, "utf8");
}

// ── Tool: obsidian_append ───────────────────────────────────────────────────
function toolAppend({ path: relPath, content }) {
  if (!content || typeof content !== "string") throw new Error("content is required");
  const target = safePath(relPath);
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = existsSync(target) ? readFileSync(target, "utf8") : "";
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(target, existing + separator + content, "utf8");
  return `Appended ${content.length} characters to ${relPath}`;
}

// ── Tool: obsidian_write (full overwrite — use sparingly) ───────────────────
function toolWrite({ path: relPath, content }) {
  if (!content || typeof content !== "string") throw new Error("content is required");
  const target = safePath(relPath);
  const dir = dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(target, content, "utf8");
  return `Written ${content.length} characters to ${relPath}`;
}

// ── MCP handshake + dispatch ────────────────────────────────────────────────
const TOOLS = [
  {
    name: "obsidian_read",
    description: "Read the contents of a note in the Gravio Obsidian vault.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Vault-relative path, e.g. 'Operations/Session Summaries.md'",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "obsidian_append",
    description: "Append text to a note in the Gravio Obsidian vault. Creates the note if it does not exist.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Vault-relative path, e.g. 'Operations/Session Summaries.md'",
        },
        content: {
          type: "string",
          description: "Text to append. Include a leading newline if needed.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "obsidian_write",
    description: "Overwrite a note in the Gravio Obsidian vault. Use obsidian_append unless full overwrite is needed.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Vault-relative path, e.g. 'Operations/AI Session Bridge.md'",
        },
        content: {
          type: "string",
          description: "Full note content to write.",
        },
      },
      required: ["path", "content"],
    },
  },
];

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    // Ignore unparseable input
    return;
  }

  const { id, method, params } = msg;

  // ── Initialise ──────────────────────────────────────────────────────────
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "gravio-obsidian-mcp", version: "1.0.0" },
      },
    });
    return;
  }

  if (method === "notifications/initialized") return;

  // ── List tools ──────────────────────────────────────────────────────────
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  // ── Call tool ───────────────────────────────────────────────────────────
  if (method === "tools/call") {
    const { name, arguments: args } = params ?? {};
    try {
      let result;
      if (name === "obsidian_read")   result = toolRead(args ?? {});
      else if (name === "obsidian_append") result = toolAppend(args ?? {});
      else if (name === "obsidian_write")  result = toolWrite(args ?? {});
      else throw new Error(`Unknown tool: ${name}`);
      ok(id, result);
    } catch (e) {
      err(id, e.message);
    }
    return;
  }

  // ── Unknown method ──────────────────────────────────────────────────────
  send({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
});
