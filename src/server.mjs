/**
 * server.mjs — HTTP server for agent-scorecard-platform
 * Serves static web UI + API routes (evaluate, auth, publish, admin)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "./core/evaluate.mjs";
import {
  registerUser, loginUser, createSession,
  validateSession, destroySession,
  generateApiKey, validateApiKey,
  setSessionCookie, clearSessionCookie, parseSessionCookie,
} from "./core/auth.mjs";
import { stmts } from "./core/db.mjs";

/** Validate projectId: 1–64 chars, alphanumeric + hyphens + underscores only. */
function isValidProjectId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);
}

/**
 * Resolve the authenticated user from a request.
 * Checks session cookie first, then Bearer API key header.
 * Returns user row or null.
 */
function getAuthUser(req) {
  const token = parseSessionCookie(req);
  if (token) return validateSession(token);
  const auth = req.headers["authorization"] ?? "";
  if (auth.startsWith("Bearer ")) return validateApiKey(auth.slice(7));
  return null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "web");
const PORT = process.env.PORT ?? 3000;

/** Current platform version, served to CLI for auto-update checks. */
const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version ?? "0.0.0";
  } catch { return "0.0.0"; }
})();

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  const hostHeader = String(req.headers.host ?? "").split(":")[0].toLowerCase();
  const canonicalHost = String(process.env.CANONICAL_HOST ?? "gravio.dev").toLowerCase();
  const pathOnly = String(req.url ?? "/").split("?")[0];
  const shouldRedirectToCanonical =
    req.method === "GET" &&
    (hostHeader === "gravio-platform.fly.dev" || hostHeader === `www.${canonicalHost}`) &&
    pathOnly !== "/health" &&
    !pathOnly.startsWith("/.well-known/");

  if (shouldRedirectToCanonical) {
    res.writeHead(308, { Location: `https://${canonicalHost}${req.url}` });
    res.end();
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── POST /auth/register ─────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/auth/register") {
    try {
      const { email, password } = JSON.parse(await readBody(req));
      const result = await registerUser(email, password);
      if (!result.ok) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      const token = createSession(result.user.id);
      setSessionCookie(res, token);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, email: result.user.email, role: result.user.role }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /auth/login ────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/auth/login") {
    try {
      const { email, password } = JSON.parse(await readBody(req));
      const result = await loginUser(email, password);
      if (!result.ok) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      setSessionCookie(res, result.token);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, email: result.user.email, role: result.user.role }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /auth/logout ───────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/auth/logout") {
    const token = parseSessionCookie(req);
    destroySession(token);
    clearSessionCookie(res);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── GET /api/me ─────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/api/me") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: user.uid ?? user.id, email: user.email, role: user.role }));
    return;
  }

  // ── POST /api/keys — generate API key ───────────────────────────────────
  if (req.method === "POST" && req.url === "/api/keys") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }
    try {
      const body = await readBody(req);
      const { label } = body ? JSON.parse(body) : {};
      const key = generateApiKey(user.uid ?? user.id, label ?? "default");
      const keys = stmts.listApiKeys.all(user.uid ?? user.id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, key, keys }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── GET /api/keys — list user's API keys ────────────────────────────────
  if (req.method === "GET" && req.url === "/api/keys") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }
    const keys = stmts.listApiKeys.all(user.uid ?? user.id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ keys }));
    return;
  }

  // ── DELETE /api/keys/:id ─────────────────────────────────────────────────
  const deleteKeyMatch = req.method === "DELETE" && /^\/api\/keys\/(\d+)$/.exec(req.url);
  if (deleteKeyMatch) {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }
    stmts.deleteApiKey.run(Number(deleteKeyMatch[1]), user.uid ?? user.id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: GET /api/runs/list — list caller's projects ────────────────────
  if (req.method === "GET" && req.url === "/api/runs/list") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }
    const runs = stmts.listRunsForUser.all(user.uid ?? user.id);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ runs }));
    return;
  }

  // ── API: POST /api/publish ───────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/api/publish") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Authentication required. Use a Bearer API key." }));
      return;
    }
    try {
      const { projectId, run } = JSON.parse(await readBody(req));
      if (!isValidProjectId(projectId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid projectId. Use 1\u201364 alphanumeric, hyphen, or underscore characters." }));
        return;
      }
      if (!run || typeof run !== "object" || Array.isArray(run)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "run is required and must be a JSON object" }));
        return;
      }

      const uid = user.uid ?? user.id;
      const existing = stmts.getRun.get(projectId, uid);
      const runCount = stmts.listRunsForUser.all(uid).length;
      if (!existing && user.role !== "admin" && runCount >= 3) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Free plan limit reached (3 scans). Sign in to your dashboard to manage projects or upgrade.",
        }));
        return;
      }

      stmts.upsertRun.run(projectId, uid, JSON.stringify(run));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, projectId }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── API: GET /api/runs/:projectId ────────────────────────────────────────
  const runsMatch = req.method === "GET" && /^\/api\/runs\/([^/?]+)/.exec(req.url);
  if (runsMatch) {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }
    const projectId = decodeURIComponent(runsMatch[1]);
    if (!isValidProjectId(projectId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid projectId" }));
      return;
    }
    const uid = user.uid ?? user.id;
    const entry = user.role === "admin"
      ? stmts.getRunAdmin.get(projectId)
      : stmts.getRun.get(projectId, uid);
    if (!entry) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Project not found" }));
      return;
    }
    let runData;
    try { runData = JSON.parse(entry.ciphertext); } catch { runData = null; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ run: runData, publishedAt: entry.published_at }));
    return;
  }

  // ── Admin: GET /api/admin/users ──────────────────────────────────────────
  if (req.method === "GET" && req.url === "/api/admin/users") {
    const user = getAuthUser(req);
    if (!user || user.role !== "admin") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }
    const users = stmts.listUsers.all();
    const runCounts = Object.fromEntries(
      stmts.runCountPerUser.all().map((r) => [r.user_id, r.run_count]),
    );
    const allRuns = stmts.listAllRuns.all();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ users, runCounts, recentRuns: allRuns.slice(0, 50) }));
    return;
  }

  // ── Admin: POST /api/admin/users/:id/disable|enable|delete ──────────────
  const adminUserMatch = req.method === "POST" &&
    /^\/api\/admin\/users\/(\d+)\/(disable|enable|delete)$/.exec(req.url);
  if (adminUserMatch) {
    const user = getAuthUser(req);
    if (!user || user.role !== "admin") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }
    const targetId = Number(adminUserMatch[1]);
    const action = adminUserMatch[2];
    if (action === "disable") stmts.setUserActive.run(0, targetId);
    else if (action === "enable") stmts.setUserActive.run(1, targetId);
    else if (action === "delete") stmts.deleteUser.run(targetId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── API: POST /api/evaluate (unchanged) ─────────────────────────────────
  if (req.method === "POST" && req.url === "/api/evaluate") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Please sign in to use the scoring tool." }));
      return;
    }
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

  // ── CLI version check (unauthenticated — used by self-update) ─────────
  if (req.method === "GET" && req.url === "/api/cli/version") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: APP_VERSION }));
    return;
  }

  // ── Health check ─────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // ── Page routes (strip query string before matching) ────────────────────
  const urlPath = req.url.split("?")[0].replace(/\/+$/, "") || "/";

  if (req.method === "GET" && urlPath === "/login") {
    serveStatic(res, path.join(WEB_DIR, "login.html"));
    return;
  }

  if (req.method === "GET" && urlPath === "/tool") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(302, { Location: "/login?next=/tool" });
      res.end();
      return;
    }
    serveStatic(res, path.join(WEB_DIR, "tool.html"));
    return;
  }

  if (req.method === "GET" && urlPath === "/dashboard") {
    serveStatic(res, path.join(WEB_DIR, "dashboard.html"));
    return;
  }

  if (req.method === "GET" && urlPath === "/onboarding") {
    serveStatic(res, path.join(WEB_DIR, "onboarding.html"));
    return;
  }

  if (req.method === "GET" && urlPath === "/download") {
    serveStatic(res, path.join(WEB_DIR, "download.html"));
    return;
  }

  if (req.method === "GET" && urlPath === "/dp") {
    serveStatic(res, path.join(WEB_DIR, "admin.html"));
    return;
  }

  // /admin → 404 (obscure the panel URL)
  if (req.method === "GET" && urlPath === "/admin") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────────
  if (req.method === "GET") {
    let staticPath = urlPath === "/" ? "/index.html" : urlPath;
    const filePath = path.join(WEB_DIR, staticPath);
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
