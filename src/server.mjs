/**
 * server.mjs — HTTP server for agent-scorecard-platform
 * Serves static web UI + POST /api/evaluate endpoint
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "./core/evaluate.mjs";

// ── In-memory run store (Phase 2 MVP — not persisted across restarts) ──
// Key: projectId (validated string). Value: { ciphertext, publishedAt }.
// The server never decrypts ciphertext — zero-knowledge by design.
const runStore = new Map();

/** Validate projectId: 1–64 chars, alphanumeric + hyphens + underscores only. */
function isValidProjectId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "web");
const PORT = process.env.PORT ?? 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
};

function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const type = MIME[ext] ?? "application/octet-stream";
  try {
    const body = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: POST /api/evaluate
  if (req.method === "POST" && req.url === "/api/evaluate") {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body);
      const { run, previous, weights, thresholds } = payload;
      if (!run || typeof run !== "object") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing or invalid 'run' field" }));
        return;
      }
      const result = evaluate(run, { previous, weights, thresholds });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: POST /api/publish — blind-store encrypted run payload
  // Body: { projectId: string, ciphertext: string }
  // Server never decrypts. Overwrites previous entry for same projectId.
  if (req.method === "POST" && req.url === "/api/publish") {
    try {
      const body = await readBody(req);
      const { projectId, ciphertext } = JSON.parse(body);
      if (!isValidProjectId(projectId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid projectId. Use 1–64 alphanumeric, hyphen, or underscore characters." }));
        return;
      }
      if (typeof ciphertext !== "string" || ciphertext.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "ciphertext is required and must be a non-empty string" }));
        return;
      }
      runStore.set(projectId, { ciphertext, publishedAt: new Date().toISOString() });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, projectId }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: GET /api/runs/:projectId — retrieve stored encrypted payload
  // Returns: { ciphertext, publishedAt } — client decrypts locally
  const runsMatch = req.method === "GET" && /^\/api\/runs\/([^/?]+)/.exec(req.url);
  if (runsMatch) {
    const projectId = decodeURIComponent(runsMatch[1]);
    if (!isValidProjectId(projectId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid projectId" }));
      return;
    }
    const entry = runStore.get(projectId);
    if (!entry) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Project not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(entry));
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // /tool → serve tool.html
  if (req.method === "GET" && (req.url === "/tool" || req.url === "/tool/")) {
    serveStatic(res, path.join(WEB_DIR, "tool.html"));
    return;
  }

  // /dashboard → serve dashboard.html
  if (req.method === "GET" && (req.url === "/dashboard" || req.url === "/dashboard/")) {
    serveStatic(res, path.join(WEB_DIR, "dashboard.html"));
    return;
  }

  // Static files
  if (req.method === "GET") {
    let urlPath = req.url.split("?")[0];
    if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
    const filePath = path.join(WEB_DIR, urlPath);
    // Prevent path traversal
    if (!filePath.startsWith(WEB_DIR + path.sep) && filePath !== WEB_DIR) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }
    serveStatic(res, filePath);
    return;
  }

  res.writeHead(405, { "Content-Type": "text/plain" });
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`agent-scorecard-platform running at http://localhost:${PORT}`);
});

export { server };
