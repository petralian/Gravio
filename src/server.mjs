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

function isPaidOrAdmin(user) {
  return user?.role === "admin" || user?.plan === "pro" || user?.plan === "team";
}

// Plan-only check — used where admin should test under their own plan restrictions
function isPaid(user) {
  return user?.plan === "pro" || user?.plan === "team";
}

function scoreBand(score) {
  if (!Number.isFinite(score)) return "Unknown";
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Strong";
  if (score >= 70) return "Fair";
  return "Needs work";
}

function toFreeTierGenericRun(runData) {
  const fromPublic = runData?.publicSummary;
  const fromSummary = runData?.summary;
  const overall = Number(fromPublic?.overallScore ?? fromSummary?.overallScore ?? NaN);
  const runId = fromPublic?.runId ?? runData?.runId ?? "run";
  const createdAt = fromPublic?.createdAt ?? runData?.createdAt ?? null;
  return {
    runId,
    createdAt,
    summary: {
      overallScore: Number.isFinite(overall) ? Number(overall.toFixed(2)) : null,
      rating: scoreBand(overall),
    },
    limitedDetails: true,
    upgradeMessage: "Upgrade to Pro or Team to view remediation details and fix guidance.",
  };
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractScoreSummary(runData) {
  const publicSummary = runData?.publicSummary;
  const summary = runData?.summary;
  const overall = Number(publicSummary?.overallScore ?? summary?.overallScore ?? NaN);
  const runId = publicSummary?.runId ?? runData?.runId ?? "run";
  const createdAt = publicSummary?.createdAt ?? runData?.createdAt ?? null;
  return {
    runId,
    createdAt,
    overallScore: Number.isFinite(overall) ? Number(overall.toFixed(2)) : null,
    rating: scoreBand(overall),
  };
}

// Per-check actionable remediation copy. Ordered by business impact (critical first).
const CHECK_ADVICE = {
  "secret-scan":          { critical: true,  text: "CRITICAL: Remove committed .env files from git history immediately (git filter-repo or BFG). Rotate any exposed credentials now." },
  "gitignore-guard":      { critical: true,  text: "Add .env and .env.* to your .gitignore to prevent accidental secret commits on every future push." },
  "agent-instructions":   { critical: true,  text: "No agent instructions file found. Add AGENTS.md or .github/copilot-instructions.md to define how AI tools must behave in this repo — prevents unbounded agent actions." },
  "test-coverage":        { critical: true,  text: "No test suite detected. Add tests (Jest, pytest, go test, etc.) — testing is the single biggest reliability signal and worth 35 pts in your Reliability score." },
  "ci-pipeline":          { critical: false, text: "No CI/CD pipeline found. Add .github/workflows/test.yml to run tests automatically on every push — worth 25 Reliability points and the #1 quality gate for teams." },
  "type-safety":          { critical: false, text: "No type system detected. Add TypeScript (tsconfig.json) or a Python type checker (mypy/pyright) to catch regressions before runtime." },
  "eval-suite":           { critical: false, text: "No eval suite found. Create an evals/ directory with representative test cases to measure whether agent quality improves or regresses across releases." },
  "baseline-tracking":    { critical: false, text: "No regression baseline found. Add a baseline.json or an agent-quality/runs/ directory to track score deltas over time and catch regressions before deploy." },
  "observability-config": { critical: false, text: "No structured logging or monitoring detected. Add OpenTelemetry, Winston/Pino (Node), or structlog (Python) to make agent failures diagnosable in production." },
  "run-artifacts":        { critical: false, text: "Agent run outputs are not being persisted. Create an agent-quality/runs/ directory and write run artifacts after each scan to build an audit trail." },
  "readme-docs":          { critical: false, text: "Missing README.md. Document what this agent does, how to run it, and what it's authorized to do — essential for team onboarding and trust." },
  "changelog-hygiene":    { critical: false, text: "No CHANGELOG.md found. Track releases so you can correlate score drops with specific code changes." },
  "agent-skill-catalog":  { critical: false, text: "No reusable prompt assets found. Create a skills/ or .github/prompts/ directory to standardize prompts across team members and reduce prompt drift." },
  "agent-orchestration":  { critical: false, text: "No multi-agent orchestration config found. If using multiple AI agents, define coordination rules in AGENTS.md to prevent conflicting actions." },
};

function recommendationsFromRun(runData, limitedDetails) {
  if (limitedDetails) {
    return [
      "Keep scan cadence consistent and monitor score trend week over week.",
      "Upgrade to Pro or Team to unlock per-check remediation guidance.",
    ];
  }

  const scorecard = runData?.scorecard ?? runData?.publicSummary?.scorecard ?? {};
  const failedChecks = runData?.publicSummary?.failedChecks ?? null;

  // If we have specific failed check IDs, give precise actionable advice per check.
  if (Array.isArray(failedChecks) && failedChecks.length > 0) {
    // Sort: critical failures first, then by check order in CHECK_ADVICE
    const adviceOrder = Object.keys(CHECK_ADVICE);
    const sorted = [...failedChecks].sort((a, b) => {
      const aC = CHECK_ADVICE[a]?.critical ? 0 : 1;
      const bC = CHECK_ADVICE[b]?.critical ? 0 : 1;
      if (aC !== bC) return aC - bC;
      return adviceOrder.indexOf(a) - adviceOrder.indexOf(b);
    });

    const recs = sorted
      .map((id) => CHECK_ADVICE[id]?.text)
      .filter(Boolean)
      .slice(0, 5); // cap at 5 to avoid overwhelming the UI

    if (recs.length > 0) return recs;
  }

  // Fallback: derive from lowest dimension scores when check IDs unavailable (older scans).
  const dims = ["safety", "reliability", "evaluation", "observability", "governance", "agentic"];
  const DIM_ADVICE = {
    safety:        (s) => `Safety score is ${s}/100 — audit committed files for secrets and ensure .gitignore covers all .env patterns.`,
    reliability:   (s) => `Reliability is ${s}/100 — add a test suite and CI pipeline to automatically catch regressions on every push.`,
    evaluation:    (s) => `Evaluation score is ${s}/100 — create an evals/ directory with representative test cases and a baseline.json to track regressions.`,
    observability: (s) => `Observability is ${s}/100 — add structured logging (Winston, Pino, structlog) and persist run artifacts to diagnose agent failures.`,
    governance:    (s) => `Governance is ${s}/100 — add README.md, CHANGELOG.md, and AGENTS.md to document what this agent does and how it is controlled.`,
    agentic:       (s) => `Agentic readiness is ${s}/100 — define agent instructions, create reusable prompt assets, and persist run outputs for audit trails.`,
  };

  const ranked = dims
    .map((k) => ({ key: k, value: Number(scorecard[k] ?? NaN) }))
    .filter((x) => Number.isFinite(x.value) && x.value < 80) // only surface genuinely weak dims
    .sort((a, b) => a.value - b.value)
    .slice(0, 3);

  if (ranked.length > 0) {
    return ranked.map((d) => DIM_ADVICE[d.key]?.(Math.round(d.value)) ?? `Improve ${d.key} (current score ${Math.round(d.value)}/100).`);
  }

  return ["All major dimensions are scoring above 80. Focus on maintaining test coverage and scan cadence."];
}

function summarizeScans(scans) {
  const scored = scans.filter((s) => Number.isFinite(s.overallScore));
  if (scored.length === 0) {
    return {
      totalScans: scans.length,
      lastScanAt: scans[0]?.publishedAt ?? null,
      averageScore: null,
      bestScore: null,
      trendDelta: null,
      trendDirection: "stable",
    };
  }

  const avg = scored.reduce((acc, s) => acc + s.overallScore, 0) / scored.length;
  const best = Math.max(...scored.map((s) => s.overallScore));
  const latest = scored[0]?.overallScore ?? null;
  const previous = scored[1]?.overallScore ?? latest;
  const delta = (latest !== null && previous !== null) ? Number((latest - previous).toFixed(2)) : null;
  const trendDirection = delta === null ? "stable" : (delta > 0 ? "up" : (delta < 0 ? "down" : "stable"));

  return {
    totalScans: scans.length,
    lastScanAt: scans[0]?.publishedAt ?? null,
    averageScore: Number(avg.toFixed(2)),
    bestScore: Number(best.toFixed(2)),
    trendDelta: delta,
    trendDirection,
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "web");
const PORT = process.env.PORT ?? 3000;
const TEAM_BASE_PRICE_CENTS = 5900;
const TEAM_INCLUDED_SEATS = 2;
const TEAM_ADDITIONAL_SEAT_CENTS = 1900;
const TEAM_MAX_SEATS = 10;

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
    res.end(JSON.stringify({ id: user.uid ?? user.id, email: user.email, role: user.role, plan: user.plan ?? "free" }));
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
      const { label: rawLabel } = body ? JSON.parse(body) : {};
      // Deduplicate label: if "default" exists, use "default 2", "default 3", …
      const baseLabel = (typeof rawLabel === "string" && rawLabel.trim()) ? rawLabel.trim() : "default";
      const existingKeys = stmts.listApiKeys.all(user.uid ?? user.id);
      const usedLabels = new Set(existingKeys.map((k) => k.label));
      let label = baseLabel;
      if (usedLabels.has(label)) {
        let n = 2;
        while (usedLabels.has(`${baseLabel} ${n}`)) n++;
        label = `${baseLabel} ${n}`;
      }
      const key = generateApiKey(user.uid ?? user.id, label);
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
    const uid = user.uid ?? user.id;
    const runs = stmts.listRunsForUser.all(uid).map((row) => {
      const latestEntry = stmts.getLatestRun.get(row.project_id, uid);
      const parsed = latestEntry ? safeJsonParse(latestEntry.ciphertext) : null;
      const summary = extractScoreSummary(parsed);
      return {
        project_id: row.project_id,
        last_scan_at: row.last_scan_at,
        scan_count: row.scan_count,
        latest_score: summary.overallScore,
        latest_rating: summary.rating,
      };
    });
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
      stmts.insertRun.run(projectId, uid, JSON.stringify(run));
      if (!isPaid(user)) {
        // Free tier is cloud-only and keeps only the latest 3 cloud records.
        stmts.trimRunsForFreeUser.run(uid, uid);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, projectId }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── API: GET /api/runs/:projectId/history ───────────────────────────────
  const runHistoryMatch = req.method === "GET" && /^\/api\/runs\/([^/?]+)\/history$/.exec(req.url);
  if (runHistoryMatch) {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }

    const projectId = decodeURIComponent(runHistoryMatch[1]);
    if (!isValidProjectId(projectId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid projectId" }));
      return;
    }

    const uid = user.uid ?? user.id;
    const limited = !isPaidOrAdmin(user);
    const rows = stmts.listProjectScansForUser.all(projectId, uid);
    if (!rows.length) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Project not found" }));
      return;
    }

    const scans = rows.map((row) => {
      const parsed = safeJsonParse(row.ciphertext);
      const summary = extractScoreSummary(parsed);
      return {
        id: row.id,
        projectId: row.project_id,
        publishedAt: row.published_at,
        runId: summary.runId,
        overallScore: summary.overallScore,
        rating: summary.rating,
        limitedDetails: limited,
        summary: {
          overallScore: summary.overallScore,
          rating: summary.rating,
        },
        recommendations: recommendationsFromRun(limited ? null : parsed, limited),
      };
    });

    const aggregate = summarizeScans(scans);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      projectId,
      limitedDetails: limited,
      scans,
      stats: aggregate,
    }));
    return;
  }

  // ── API: POST /api/runs/delete ──────────────────────────────────────────
  if (req.method === "POST" && req.url === "/api/runs/delete") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { projectId, scanIds } = body ?? {};
    if (!isValidProjectId(projectId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid projectId" }));
      return;
    }
    if (!Array.isArray(scanIds) || scanIds.length === 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "scanIds must be a non-empty array" }));
      return;
    }

    const uid = user.uid ?? user.id;
    let deleted = 0;
    for (const rawId of scanIds) {
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) continue;
      deleted += stmts.deleteScanByIdForUserProject.run(id, uid, projectId).changes;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, deleted }));
    return;
  }

  // ── API: GET /api/runs/:projectId ────────────────────────────────────────
  const runsMatch = req.method === "GET" && /^\/api\/runs\/([^/?]+)$/.exec(req.url);
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
      ? stmts.getLatestRunAdmin.get(projectId)
      : stmts.getLatestRun.get(projectId, uid);
    if (!entry) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Project not found" }));
      return;
    }
    let runData;
    try { runData = JSON.parse(entry.ciphertext); } catch { runData = null; }
    const outputRun = isPaidOrAdmin(user) ? runData : toFreeTierGenericRun(runData);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ run: outputRun, publishedAt: entry.published_at, limitedDetails: !isPaidOrAdmin(user) }));
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

  // ── Admin: POST /api/admin/users/:id/plan ───────────────────────────────────
  const adminSetPlanMatch = req.method === "POST" &&
    /^\/api\/admin\/users\/(\d+)\/plan$/.exec(req.url);
  if (adminSetPlanMatch) {
    const user = getAuthUser(req);
    if (!user || user.role !== "admin") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }
    const targetId = Number(adminSetPlanMatch[1]);
    let planBody;
    try { planBody = JSON.parse(await readBody(req)); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }
    const { plan } = planBody;
    if (!plan || !["free", "pro", "team"].includes(plan)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "plan must be free, pro, or team" }));
      return;
    }
    stmts.setUserPlan.run(plan, targetId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
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

  // ── API: POST /api/billing/team-checkout — custom Lemon checkout by seats ─
  if (req.method === "POST" && req.url === "/api/billing/team-checkout") {
    const apiKey = process.env.LEMON_API_KEY;
    const storeId = process.env.LEMON_STORE_ID;
    const variantId = process.env.LEMON_TEAM_VARIANT_ID;

    if (!apiKey || !storeId || !variantId) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "Billing is not configured. Missing LEMON_API_KEY, LEMON_STORE_ID, or LEMON_TEAM_VARIANT_ID.",
      }));
      return;
    }

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const seats = Number(payload?.seats);
    if (!Number.isInteger(seats) || seats < TEAM_INCLUDED_SEATS || seats > TEAM_MAX_SEATS) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: `seats must be an integer between ${TEAM_INCLUDED_SEATS} and ${TEAM_MAX_SEATS}`,
      }));
      return;
    }

    const customPrice = TEAM_BASE_PRICE_CENTS + (seats - TEAM_INCLUDED_SEATS) * TEAM_ADDITIONAL_SEAT_CENTS;

    try {
      const lsResponse = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
        method: "POST",
        headers: {
          Accept: "application/vnd.api+json",
          "Content-Type": "application/vnd.api+json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          data: {
            type: "checkouts",
            attributes: {
              custom_price: customPrice,
              checkout_options: {
                embed: true,
              },
              checkout_data: {
                custom: {
                  plan: "team",
                  seats,
                },
              },
            },
            relationships: {
              store: {
                data: { type: "stores", id: String(storeId) },
              },
              variant: {
                data: { type: "variants", id: String(variantId) },
              },
            },
          },
        }),
      });

      const raw = await lsResponse.text();
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }

      if (!lsResponse.ok) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Unable to create checkout",
          lemonStatus: lsResponse.status,
          lemonBody: parsed ?? raw,
        }));
        return;
      }

      const checkoutUrl = parsed?.data?.attributes?.url;
      if (!checkoutUrl) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Checkout URL missing from Lemon response" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        seats,
        totalCents: customPrice,
        checkoutUrl,
      }));
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
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
    res.writeHead(308, { Location: "/dashboard" });
    res.end();
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
    res.writeHead(308, { Location: "/onboarding" });
    res.end();
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
