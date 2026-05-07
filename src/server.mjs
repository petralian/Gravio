/**
 * server.mjs — HTTP server for agent-scorecard-platform
 * Serves static web UI + API routes (evaluate, auth, publish, admin)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { evaluate } from "./core/evaluate.mjs";
import { buildRunArtifact, DEFAULT_CORPUS, DEFAULT_WEIGHTS } from "./core/scanner.mjs";
import {
  registerUser, loginUser, createSession,
  validateSession, destroySession,
  generateApiKey, validateApiKey,
  setSessionCookie, clearSessionCookie, parseSessionCookie,
  loginOrCreateSsoUser,
  generateMagicLink, consumeMagicLink, sendMagicLinkEmail,
  changePassword,
} from "./core/auth.mjs";
import { stmts } from "./core/db.mjs";

const GOOGLE_OAUTH_CLIENT_ID = String(process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
const GOOGLE_OAUTH_CLIENT_SECRET = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
const GOOGLE_OAUTH_REDIRECT_URI = String(process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "").trim();
const SSO_STATE_COOKIE = "__sso_state";
const IS_PROD = process.env.NODE_ENV === "production";

function isGoogleSsoConfigured() {
  return Boolean(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REDIRECT_URI);
}

function parseCookieByName(req, name) {
  const header = req.headers["cookie"] ?? "";
  for (const part of header.split(";")) {
    const [cookieName, ...rest] = part.trim().split("=");
    if (cookieName === name) return rest.join("=");
  }
  return null;
}

function buildCookie(name, value, maxAgeSeconds) {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    IS_PROD ? "Secure" : null,
  ].filter(Boolean).join("; ");
}

function addSetCookieHeader(res, cookie) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  const next = Array.isArray(existing) ? [...existing, cookie] : [existing, cookie];
  res.setHeader("Set-Cookie", next);
}

function sanitizeNextPath(value) {
  const next = String(value ?? "").trim();
  if (!next.startsWith("/")) return "/dashboard";
  if (next.startsWith("//")) return "/dashboard";
  return next;
}

function encodeSsoStatePayload(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeSsoStatePayload(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

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

const DIM_ORDER = ["safety", "reliability", "evaluation", "observability", "governance", "agentic"];
const READY_TO_SHIP_TARGET = {
  safety: 90,
  reliability: 85,
  evaluation: 85,
  observability: 80,
  governance: 80,
  agentic: 80,
};

const DIMENSION_GUIDE = {
  safety: {
    label: "Safety",
    summary: "Prevent secret leaks and high-risk security regressions before merge.",
    actions: [
      "Add secret scanning to CI (gitleaks or trufflehog) and fail builds on new leaks.",
      "Ensure .gitignore blocks .env and .env.* patterns across all app roots.",
      "Rotate any key that was ever committed, even if removed later.",
    ],
    commands: [
      "npm run secret-scan",
      "git ls-files | findstr /R \"\\.env$ \\.env\\.\"",
    ],
    doneWhen: "No committed secrets, ignore rules verified, secret scan gate passing in CI.",
  },
  reliability: {
    label: "Reliability",
    summary: "Make regressions visible early with automated tests, CI, and type checks.",
    actions: [
      "Cover critical paths with tests (happy path, failure path, auth edge cases).",
      "Run tests on every PR via GitHub Actions and block merge on failures.",
      "Enable type checking (TypeScript, mypy, or pyright) in CI.",
    ],
    commands: [
      "npm test",
      "node --test tests/server.test.mjs",
    ],
    doneWhen: "Tests and CI are mandatory gates and type checks are enforced on pull requests.",
  },
  evaluation: {
    label: "Evaluation",
    summary: "Measure quality over time with representative evals and baseline tracking.",
    actions: [
      "Create eval cases that mirror your top real user workflows.",
      "Store a baseline run and compare score deltas every release.",
      "Treat eval regressions as release blockers.",
    ],
    commands: [
      "npm run scorecard:check",
      "node scripts/new-run.mjs",
    ],
    doneWhen: "Eval corpus exists, baseline is tracked, and regressions trigger a release hold.",
  },
  observability: {
    label: "Observability",
    summary: "Capture enough runtime evidence to debug failures quickly.",
    actions: [
      "Emit structured logs with correlation IDs across request boundaries.",
      "Persist run artifacts and traces in agent-quality/runs for audits.",
      "Track failure rates and latency trends for scan and publish flows.",
    ],
    commands: [
      "node gravio.mjs doctor",
      "dir agent-quality\\runs",
    ],
    doneWhen: "Structured logs and persisted artifacts are available for every production issue.",
  },
  governance: {
    label: "Governance",
    summary: "Keep repository behavior legible with documentation and change history.",
    actions: [
      "Maintain README, CHANGELOG, and ownership docs as required merge artifacts.",
      "Document release decisions and operational constraints.",
      "Keep onboarding docs aligned with actual CLI behavior.",
    ],
    commands: [
      "type README.md",
      "type CHANGELOG.md",
    ],
    doneWhen: "Operational docs are complete, current, and reviewed during releases.",
  },
  agentic: {
    label: "Agentic",
    summary: "Define repeatable AI-agent behavior with guardrails and reusable prompts.",
    actions: [
      "Add AGENTS.md or .github/copilot-instructions.md with explicit safety rules.",
      "Create reusable prompts/skills for recurring tasks.",
      "Record run outputs and decisions so AI actions are auditable.",
    ],
    commands: [
      "dir .github",
      "dir skills",
    ],
    doneWhen: "Agent instructions, reusable prompt assets, and run artifacts are all present.",
  },
};

const CHECK_PLAYBOOK = {
  "secret-scan": {
    dimension: "safety",
    priority: "critical",
    title: "Remove committed secrets and rotate credentials",
    why: "Committed secrets are an immediate production compromise risk.",
    actions: [
      "Purge leaked secrets from git history using git-filter-repo or BFG.",
      "Rotate all exposed keys, tokens, and passwords immediately.",
      "Add CI secret scan gate so future leaks fail before merge.",
    ],
    commands: ["npm run secret-scan"],
  },
  "gitignore-guard": {
    dimension: "safety",
    priority: "high",
    title: "Harden .gitignore secret coverage",
    why: ".env files are a common accidental leak source.",
    actions: [
      "Ensure .gitignore includes .env and .env.* patterns.",
      "Verify no tracked env files remain in git index.",
      "Add pre-commit checks for secret-containing files.",
    ],
    commands: ["git ls-files | findstr /R \"\\.env$ \\.env\\.\""],
  },
  "test-coverage": {
    dimension: "reliability",
    priority: "critical",
    title: "Establish a minimum automated test suite",
    why: "Without tests, regressions reach production undetected.",
    actions: [
      "Create tests for auth, publish, and dashboard API behavior.",
      "Require passing tests for every pull request.",
      "Add regression tests for each escaped production bug.",
    ],
    commands: ["npm test"],
  },
  "ci-pipeline": {
    dimension: "reliability",
    priority: "high",
    title: "Enable CI pipeline quality gates",
    why: "CI creates a consistent pre-merge contract for quality.",
    actions: [
      "Add a GitHub Actions workflow that runs tests and secret scan.",
      "Fail PR checks on test, lint, or typecheck errors.",
      "Surface artifacts/logs for failed jobs.",
    ],
    commands: ["npm run verify"],
  },
  "type-safety": {
    dimension: "reliability",
    priority: "medium",
    title: "Add type safety checks",
    why: "Type contracts prevent an entire class of runtime defects.",
    actions: [
      "Adopt TypeScript or a type checker for high-risk modules.",
      "Run type checks in CI on every push.",
      "Prioritize request/response and data-boundary typing first.",
    ],
    commands: ["npm run build"],
  },
  "eval-suite": {
    dimension: "evaluation",
    priority: "high",
    title: "Create representative eval suite",
    why: "You cannot improve what you do not measure repeatedly.",
    actions: [
      "Create eval scenarios covering top production workflows.",
      "Include failure-mode and edge-case prompts.",
      "Track pass/fail trend over time.",
    ],
    commands: ["npm run scorecard:check"],
  },
  "baseline-tracking": {
    dimension: "evaluation",
    priority: "high",
    title: "Track score baselines and regressions",
    why: "Baseline drift hides quality decay until it becomes expensive.",
    actions: [
      "Persist baseline.json for known-good runs.",
      "Compare every new run against baseline deltas.",
      "Block releases on major quality drops.",
    ],
    commands: ["node scripts/new-run.mjs"],
  },
  "observability-config": {
    dimension: "observability",
    priority: "high",
    title: "Add structured telemetry",
    why: "Production failures need traces and structured logs for fast diagnosis.",
    actions: [
      "Emit structured logs with request and run IDs.",
      "Instrument key paths with tracing spans.",
      "Monitor error-rate and latency trends.",
    ],
    commands: ["node gravio.mjs doctor"],
  },
  "run-artifacts": {
    dimension: "observability",
    priority: "medium",
    title: "Persist run artifacts for audits",
    why: "Without artifacts, root-cause analysis is guesswork.",
    actions: [
      "Persist run outputs in agent-quality/runs with timestamps.",
      "Retain enough history for trend analysis.",
      "Link run artifacts to deploy and release identifiers.",
    ],
    commands: ["dir agent-quality\\runs"],
  },
  "readme-docs": {
    dimension: "governance",
    priority: "medium",
    title: "Document runtime and ownership expectations",
    why: "Missing docs slows onboarding and causes unsafe operational drift.",
    actions: [
      "Keep README accurate for setup, run, and deploy flows.",
      "Document responsibilities and escalation paths.",
      "Define release readiness requirements.",
    ],
    commands: ["type README.md"],
  },
  "changelog-hygiene": {
    dimension: "governance",
    priority: "medium",
    title: "Track release-level quality changes",
    why: "Changelogs help correlate regressions with code changes.",
    actions: [
      "Add release entries for quality-relevant changes.",
      "Record migration and rollout notes.",
      "Tie score changes to release notes.",
    ],
    commands: ["type CHANGELOG.md"],
  },
  "agent-instructions": {
    dimension: "agentic",
    priority: "critical",
    title: "Define explicit AI agent instructions",
    why: "Agent guardrails reduce unsafe automation and inconsistent outputs.",
    actions: [
      "Add AGENTS.md or .github/copilot-instructions.md with strict operating rules.",
      "Define no-go actions and review requirements.",
      "Keep instructions versioned with code changes.",
    ],
    commands: ["dir .github"],
  },
  "agent-skill-catalog": {
    dimension: "agentic",
    priority: "high",
    title: "Create reusable prompt and skill assets",
    why: "Reusable assets reduce drift and improve consistency across agents.",
    actions: [
      "Create a skills/prompt catalog for frequent workflows.",
      "Version and review prompts like production code.",
      "Define success criteria per skill.",
    ],
    commands: ["dir skills"],
  },
  "agent-orchestration": {
    dimension: "agentic",
    priority: "high",
    title: "Define multi-agent orchestration contract",
    why: "Uncoordinated agents can conflict and degrade quality.",
    actions: [
      "Document orchestration and ownership boundaries in AGENTS.md.",
      "Set deterministic handoff and conflict resolution rules.",
      "Audit agent outputs and escalation paths.",
    ],
    commands: ["type AGENTS.md"],
  },
};

function toTitleCaseDimension(dim) {
  const meta = DIMENSION_GUIDE[dim];
  return meta?.label ?? String(dim ?? "").replace(/^[a-z]/, (m) => m.toUpperCase());
}

function normalizeScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function statusFromGap(gap) {
  if (gap <= 0) return "ready";
  if (gap <= 10) return "near";
  if (gap <= 24) return "at-risk";
  return "critical";
}

function buildDimensionPlan(scorecard) {
  return DIM_ORDER.map((dim) => {
    const current = normalizeScore(scorecard?.[dim]);
    const target = READY_TO_SHIP_TARGET[dim] ?? 80;
    const gap = current === null ? target : Math.max(0, target - current);
    const guide = DIMENSION_GUIDE[dim];
    return {
      dimension: dim,
      label: toTitleCaseDimension(dim),
      current,
      target,
      gap,
      status: statusFromGap(gap),
      summary: guide?.summary ?? "Improve this dimension to reduce release risk.",
      actions: guide?.actions ?? [],
      commands: guide?.commands ?? [],
      doneWhen: guide?.doneWhen ?? "This dimension is stable across repeated scans.",
    };
  }).sort((a, b) => b.gap - a.gap);
}

function synthesizeActionFromDimension(item) {
  return {
    source: "dimension",
    dimension: item.dimension,
    priority: item.status === "critical" ? "critical" : (item.status === "at-risk" ? "high" : "medium"),
    title: `${item.label}: close ${item.gap}-point gap to ready-to-ship target`,
    why: item.summary,
    actions: item.actions.slice(0, 3),
    commands: item.commands.slice(0, 2),
    expectedLift: item.gap,
  };
}

function buildActionPlan(runData, dimensionPlan) {
  const failedChecks = runData?.publicSummary?.failedChecks;
  const checkActions = Array.isArray(failedChecks)
    ? failedChecks.map((id) => ({ id, ...CHECK_PLAYBOOK[id] })).filter((x) => x.dimension)
    : [];

  const normalizedChecks = checkActions.map((item) => ({
    source: "check",
    checkId: item.id,
    dimension: item.dimension,
    priority: item.priority,
    title: item.title,
    why: item.why,
    actions: item.actions,
    commands: item.commands,
    expectedLift: null,
  }));

  const byDimFromChecks = new Set(normalizedChecks.map((x) => x.dimension));
  const topDimActions = dimensionPlan
    .filter((item) => item.gap > 0)
    .filter((item) => !byDimFromChecks.has(item.dimension))
    .slice(0, 4)
    .map((item) => synthesizeActionFromDimension(item));

  const merged = [...normalizedChecks, ...topDimActions];
  const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  return merged
    .sort((a, b) => {
      const p = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
      if (p !== 0) return p;
      return (b.expectedLift ?? 0) - (a.expectedLift ?? 0);
    })
    .slice(0, 8);
}

function buildReadyChecklist(dimensionPlan, overallScore) {
  const items = dimensionPlan.map((item) => ({
    id: `dim-${item.dimension}`,
    label: `${item.label} >= ${item.target}`,
    passed: Number.isFinite(item.current) && item.current >= item.target,
    current: item.current,
    target: item.target,
  }));

  items.unshift({
    id: "overall",
    label: "Overall score >= 85",
    passed: Number.isFinite(overallScore) && overallScore >= 85,
    current: normalizeScore(overallScore),
    target: 85,
  });

  return items;
}

function recommendationsFromRun(runData, limitedDetails) {
  if (limitedDetails) {
    const scorecard = runData?.publicSummary?.scorecard ?? {};
    const dimPreviews = DIM_ORDER.map((dim) => {
      const current = normalizeScore(scorecard?.[dim]);
      const target = READY_TO_SHIP_TARGET[dim] ?? 80;
      const gap = current === null ? target : Math.max(0, target - current);
      const guide = DIMENSION_GUIDE[dim];
      return {
        dimension: dim,
        label: toTitleCaseDimension(dim),
        current,
        target,
        status: statusFromGap(gap),
        topAction: guide?.actions?.[0] ?? "Improve this dimension.",
      };
    }).sort((a, b) => b.gap - a.gap);

    const hasScorecard = DIM_ORDER.some((d) => scorecard?.[d] !== undefined);
    return {
      version: 2,
      tier: "limited",
      headline: "Detailed remediation is available on Pro and Team.",
      summary: hasScorecard
        ? `Your scan detected ${dimPreviews.filter((d) => d.status !== "ready").length} dimension${dimPreviews.filter((d) => d.status !== "ready").length === 1 ? "" : "s"} needing attention. Upgrade for the full action plan.`
        : "Your free-tier report shows trend and score only. Upgrade to unlock per-dimension action plans and ready-to-ship checklists.",
      dimPreviews: hasScorecard ? dimPreviews : [],
      actionPlan: [],
      dimensionPlan: [],
      readyChecklist: [],
    };
  }

  const scorecard = runData?.scorecard ?? runData?.publicSummary?.scorecard ?? {};
  const overallScore = Number(runData?.summary?.overallScore ?? runData?.publicSummary?.overallScore ?? NaN);
  const dimensionPlan = buildDimensionPlan(scorecard);
  const actionPlan = buildActionPlan(runData, dimensionPlan);
  const readyChecklist = buildReadyChecklist(dimensionPlan, overallScore);
  const failed = readyChecklist.filter((i) => !i.passed).length;
  const nextMilestone = failed === 0
    ? "Ready to ship"
    : `${failed} gate${failed === 1 ? "" : "s"} remaining`;

  const urgentItems = actionPlan.filter((item) => item.priority === "critical" || item.priority === "high").slice(0, 3);
  const topIssues = urgentItems.map((item) => ({
    title: item.title,
    dimension: item.dimension,
    priority: item.priority,
    lift: item.expectedLift,
  }));

  return {
    version: 2,
    tier: "full",
    headline: nextMilestone,
    summary: Number.isFinite(overallScore)
      ? `Current overall score is ${Math.round(overallScore)}/100. Close the highest gaps first to reach ready-to-ship status.`
      : "Score detected, but overall score summary is unavailable. Focus on closing dimension gaps below.",
    quickActions: urgentItems.length > 0
      ? urgentItems.map((item) => item.title)
      : ["Run scans weekly and watch trend direction.", "Prioritize the two lowest dimensions first.", "Compare score deltas after each fix batch."],
    topIssues,
    actionPlan,
    dimensionPlan,
    readyChecklist,
  };
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

function parseMaybeInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function boolToInt(value) {
  return value ? 1 : 0;
}

function lemonHeaders(apiKey) {
  return {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function extractSubscriptionAttrs(payload) {
  return payload?.data?.attributes ?? payload?.attributes ?? {};
}

function subscriptionSeatsFromAttrs(attrs, fallback = 1) {
  const fromItem = parseMaybeInt(attrs?.first_subscription_item?.quantity, NaN);
  const fromAttrs = parseMaybeInt(attrs?.quantity ?? attrs?.seats ?? attrs?.subscription_quantity, NaN);
  if (Number.isInteger(fromItem)) return fromItem;
  if (Number.isInteger(fromAttrs)) return fromAttrs;
  return fallback;
}

function derivePlanFromSubscription(attrs, existingPlan = "free", explicitPlan = null) {
  if (explicitPlan === "pro" || explicitPlan === "team" || explicitPlan === "free") return explicitPlan;
  const seats = subscriptionSeatsFromAttrs(attrs, 1);
  if (seats >= TEAM_INCLUDED_SEATS) return "team";
  if (existingPlan === "team") return "pro";
  if (existingPlan === "free") return "pro";
  return existingPlan;
}

function persistedBillingFromSubscription(attrs, existing, explicitPlan = null) {
  const existingSeats = parseMaybeInt(existing?.billing_seats, 1);
  const seats = subscriptionSeatsFromAttrs(attrs, existingSeats);
  const plan = derivePlanFromSubscription(attrs, existing?.plan ?? "free", explicitPlan);
  const status = String(attrs?.status ?? existing?.billing_status ?? "none").trim().toLowerCase() || "none";
  const cancelled = boolToInt(Boolean(attrs?.cancelled ?? attrs?.is_cancelled ?? existing?.billing_cancelled));
  const customerId = String(attrs?.customer_id ?? existing?.lemon_customer_id ?? "").trim() || null;
  const subscriptionId = String(attrs?.id ?? attrs?.subscription_id ?? existing?.lemon_subscription_id ?? "").trim() || null;
  const renewsAt = attrs?.renews_at ?? attrs?.ends_at ?? attrs?.billing_anchor ?? existing?.billing_renews_at ?? null;
  const portalUrl = attrs?.urls?.customer_portal
    ?? attrs?.urls?.customer_portal_update_subscription
    ?? attrs?.urls?.update_payment_method
    ?? existing?.billing_portal_url
    ?? null;
  return {
    plan,
    customerId,
    subscriptionId,
    status,
    seats,
    renewsAt,
    cancelled,
    portalUrl,
  };
}

async function lemonApiRequest(apiKey, method, endpointPath, jsonApiBody = null) {
  const response = await fetch(`https://api.lemonsqueezy.com${endpointPath}`, {
    method,
    headers: lemonHeaders(apiKey),
    ...(jsonApiBody ? { body: JSON.stringify(jsonApiBody) } : {}),
  });

  const raw = await response.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }

  return {
    ok: response.ok,
    status: response.status,
    body: parsed ?? raw,
  };
}

function userOwnsLemonSubscription(authUser, billingRow, subscriptionAttrs) {
  const authEmail = String(authUser?.email ?? "").trim().toLowerCase();
  const lemonEmail = String(subscriptionAttrs?.user_email ?? "").trim().toLowerCase();
  if (authEmail && lemonEmail && authEmail === lemonEmail) return true;

  const expectedCustomerId = String(billingRow?.lemon_customer_id ?? "").trim();
  const lemonCustomerId = String(subscriptionAttrs?.customer_id ?? "").trim();
  if (expectedCustomerId && lemonCustomerId && expectedCustomerId === lemonCustomerId) return true;

  return false;
}

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

  // ── POST /auth/magic-link/request ──────────────────────────────────────
  // Always responds 200 regardless of whether the email exists (prevents enumeration).
  if (req.method === "POST" && req.url === "/auth/magic-link/request") {
    try {
      const body = JSON.parse(await readBody(req));
      const next = (typeof body?.next === "string" && body.next.startsWith("/")) ? body.next : "/dashboard";
      const appUrl = IS_PROD ? `https://${process.env.CANONICAL_HOST ?? "gravio.dev"}` : `http://localhost:${PORT}`;
      const result = generateMagicLink(body?.email);
      if (result) {
        const magicUrl = `${appUrl}/auth/magic-link/verify?token=${encodeURIComponent(result.token)}&next=${encodeURIComponent(next)}`;
        await sendMagicLinkEmail(result.user.email, magicUrl);
      }
    } catch {
      // Fall through — always 200
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── GET /auth/magic-link/verify ─────────────────────────────────────────
  if (req.method === "GET" && pathOnly === "/auth/magic-link/verify") {
    const requestUrl = new URL(req.url, "http://localhost");
    const token = requestUrl.searchParams.get("token") ?? "";
    const next = String(requestUrl.searchParams.get("next") ?? "").startsWith("/")
      ? requestUrl.searchParams.get("next")
      : "/dashboard";
    const user = consumeMagicLink(token);
    if (!user) {
      res.writeHead(302, { Location: "/login?authError=magic_link_invalid" });
      res.end();
      return;
    }
    const sessionToken = createSession(user.id);
    setSessionCookie(res, sessionToken);
    res.writeHead(302, { Location: next });
    res.end();
    return;
  }

  // ── POST /auth/password/change ──────────────────────────────────────────
  if (req.method === "POST" && req.url === "/auth/password/change") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }
    try {
      const { currentPassword, newPassword } = JSON.parse(await readBody(req));
      const result = await changePassword(user.uid ?? user.id, currentPassword, newPassword);
      if (!result.ok) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
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

  // ── GET /auth/sso/providers ─────────────────────────────────────────────
  if (req.method === "GET" && pathOnly === "/auth/sso/providers") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ google: isGoogleSsoConfigured() }));
    return;
  }

  // ── GET /auth/sso/google/start ──────────────────────────────────────────
  if (req.method === "GET" && pathOnly === "/auth/sso/google/start") {
    if (!isGoogleSsoConfigured()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Google SSO is not configured" }));
      return;
    }

    const requestUrl = new URL(req.url, "http://localhost");
    const nextPath = sanitizeNextPath(requestUrl.searchParams.get("next"));
    const state = crypto.randomBytes(24).toString("base64url");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    const payload = encodeSsoStatePayload({ state, nextPath, verifier });
    addSetCookieHeader(res, buildCookie(SSO_STATE_COOKIE, payload, 600));

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", GOOGLE_OAUTH_REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    res.writeHead(302, { Location: authUrl.toString() });
    res.end();
    return;
  }

  // ── GET /auth/sso/google/callback ───────────────────────────────────────
  if (req.method === "GET" && pathOnly === "/auth/sso/google/callback") {
    addSetCookieHeader(res, buildCookie(SSO_STATE_COOKIE, "", 0));

    if (!isGoogleSsoConfigured()) {
      res.writeHead(302, { Location: "/login?authError=sso_not_configured" });
      res.end();
      return;
    }

    const requestUrl = new URL(req.url, "http://localhost");
    const code = String(requestUrl.searchParams.get("code") ?? "").trim();
    const returnedState = String(requestUrl.searchParams.get("state") ?? "").trim();
    const statePayload = decodeSsoStatePayload(parseCookieByName(req, SSO_STATE_COOKIE));

    if (!code || !returnedState || !statePayload || statePayload.state !== returnedState) {
      res.writeHead(302, { Location: "/login?authError=sso_state_invalid" });
      res.end();
      return;
    }

    try {
      const tokenBody = new URLSearchParams({
        code,
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: GOOGLE_OAUTH_REDIRECT_URI,
        grant_type: "authorization_code",
        code_verifier: String(statePayload.verifier ?? ""),
      });

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      });
      if (!tokenResponse.ok) {
        res.writeHead(302, { Location: "/login?authError=sso_token_exchange_failed" });
        res.end();
        return;
      }

      const tokenData = await tokenResponse.json();
      const accessToken = String(tokenData?.access_token ?? "").trim();
      if (!accessToken) {
        res.writeHead(302, { Location: "/login?authError=sso_token_missing" });
        res.end();
        return;
      }

      const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!profileResponse.ok) {
        res.writeHead(302, { Location: "/login?authError=sso_profile_failed" });
        res.end();
        return;
      }

      const profile = await profileResponse.json();
      const email = String(profile?.email ?? "").trim().toLowerCase();
      const subject = String(profile?.sub ?? "").trim();
      const emailVerified = Boolean(profile?.email_verified);

      if (!email || !subject || !emailVerified) {
        res.writeHead(302, { Location: "/login?authError=sso_email_unverified" });
        res.end();
        return;
      }

      const authResult = await loginOrCreateSsoUser({ provider: "google", subject, email });
      if (!authResult.ok) {
        res.writeHead(302, { Location: "/login?authError=sso_signin_denied" });
        res.end();
        return;
      }

      setSessionCookie(res, authResult.token);
      addSetCookieHeader(res, buildCookie(SSO_STATE_COOKIE, "", 0));
      res.writeHead(302, { Location: sanitizeNextPath(statePayload.nextPath) });
      res.end();
    } catch {
      res.writeHead(302, { Location: "/login?authError=sso_unexpected_error" });
      res.end();
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
    const userId = user.uid ?? user.id;
    const fullUser = stmts.getUserById.get(userId);
    res.end(JSON.stringify({
      id: userId,
      email: user.email,
      role: user.role,
      plan: user.plan ?? "free",
      authProvider: fullUser?.auth_provider ?? null,
    }));
    return;
  }

  // ── GET /api/billing/status ──────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/api/billing/status") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }
    const uid = user.uid ?? user.id;
    const billing = stmts.getBillingForUser.get(uid);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      plan: billing?.plan ?? "free",
      provider: billing?.billing_provider ?? null,
      status: billing?.billing_status ?? "none",
      seats: Number(billing?.billing_seats ?? 1),
      renewsAt: billing?.billing_renews_at ?? null,
      cancelled: Boolean(billing?.billing_cancelled ?? 0),
      portalUrl: billing?.billing_portal_url ?? null,
      customerId: billing?.lemon_customer_id ?? null,
      subscriptionId: billing?.lemon_subscription_id ?? null,
    }));
    return;
  }

  // ── POST /api/billing/(cancel|resume|seats) — customer billing actions ──
  const billingActionMatch = req.method === "POST" && /^\/api\/billing\/(cancel|resume|seats)$/.exec(req.url);
  if (billingActionMatch) {
    const authUser = getAuthUser(req);
    if (!authUser) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }

    const apiKey = process.env.LEMON_API_KEY;
    if (!apiKey) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Billing is not configured. Missing LEMON_API_KEY." }));
      return;
    }

    const uid = authUser.uid ?? authUser.id;
    const billing = stmts.getBillingForUser.get(uid);
    const subscriptionId = String(billing?.lemon_subscription_id ?? "").trim();
    if (!subscriptionId) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No linked subscription found for this account." }));
      return;
    }

    const retrieveSub = await lemonApiRequest(apiKey, "GET", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
    if (!retrieveSub.ok) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "Unable to retrieve subscription",
        lemonStatus: retrieveSub.status,
        lemonBody: retrieveSub.body,
      }));
      return;
    }

    const initialAttrs = extractSubscriptionAttrs(retrieveSub.body);
    const subscriptionAttrs = { ...initialAttrs, id: retrieveSub.body?.data?.id ?? initialAttrs.id ?? subscriptionId };
    if (!userOwnsLemonSubscription(authUser, billing, subscriptionAttrs)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden: subscription does not belong to authenticated user." }));
      return;
    }

    const action = billingActionMatch[1];
    let updatedSubscriptionAttrs = subscriptionAttrs;

    if (action === "cancel" || action === "resume") {
      const cancelled = action === "cancel";
      const patchSub = await lemonApiRequest(apiKey, "PATCH", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        data: {
          type: "subscriptions",
          id: String(subscriptionId),
          attributes: {
            cancelled,
          },
        },
      });

      if (!patchSub.ok) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: `Unable to ${action} subscription`,
          lemonStatus: patchSub.status,
          lemonBody: patchSub.body,
        }));
        return;
      }

      const attrs = extractSubscriptionAttrs(patchSub.body);
      updatedSubscriptionAttrs = { ...attrs, id: patchSub.body?.data?.id ?? attrs.id ?? subscriptionId };
    }

    if (action === "seats") {
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

      const subItemId = String(subscriptionAttrs?.first_subscription_item?.id ?? "").trim();
      if (!subItemId) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Subscription does not expose a quantity item to update." }));
        return;
      }

      const patchItem = await lemonApiRequest(apiKey, "PATCH", `/v1/subscription-items/${encodeURIComponent(subItemId)}`, {
        data: {
          type: "subscription-items",
          id: String(subItemId),
          attributes: {
            quantity: seats,
          },
        },
      });

      if (!patchItem.ok) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Unable to update subscription seats",
          lemonStatus: patchItem.status,
          lemonBody: patchItem.body,
        }));
        return;
      }

      const refreshedSub = await lemonApiRequest(apiKey, "GET", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`);
      if (!refreshedSub.ok) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Seats were updated but billing sync failed. Try refreshing in a moment.",
          lemonStatus: refreshedSub.status,
          lemonBody: refreshedSub.body,
        }));
        return;
      }

      const attrs = extractSubscriptionAttrs(refreshedSub.body);
      updatedSubscriptionAttrs = { ...attrs, id: refreshedSub.body?.data?.id ?? attrs.id ?? subscriptionId };
    }

    const nextState = persistedBillingFromSubscription(updatedSubscriptionAttrs, billing);
    stmts.setUserBillingState.run(
      nextState.plan,
      nextState.customerId,
      nextState.subscriptionId,
      nextState.status,
      nextState.seats,
      nextState.renewsAt,
      nextState.cancelled,
      nextState.portalUrl,
      uid,
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      action,
      billing: {
        plan: nextState.plan,
        status: nextState.status,
        seats: nextState.seats,
        renewsAt: nextState.renewsAt,
        cancelled: Boolean(nextState.cancelled),
        portalUrl: nextState.portalUrl,
      },
    }));
    return;
  }

  // ── POST /api/keys/onboarding — rotate user-bound onboarding CLI key ────
  // Returns a freshly-minted key (plaintext, shown once) auto-filled into
  // the authorize command on the onboarding page. Deletes any prior key
  // labelled "onboarding" for this user so the list stays clean.
  if (req.method === "POST" && req.url === "/api/keys/onboarding") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }
    const uid = user.uid ?? user.id;
    const existingKeys = stmts.listApiKeys.all(uid);
    const prior = existingKeys.find((k) => k.label === "onboarding");
    if (prior) stmts.deleteApiKey.run(prior.id, uid);
    const key = generateApiKey(uid, "onboarding");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, key }));
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

  // ── API: GET /api/projects/list — alias for CLI relink flows ───────────
  if (req.method === "GET" && req.url === "/api/projects/list") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }
    const uid = user.uid ?? user.id;
    const projects = stmts.listRunsForUser.all(uid).map((row) => ({
      project_id: row.project_id,
      scan_count: row.scan_count,
      last_scan_at: row.last_scan_at,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ projects }));
    return;
  }

  // ── API: POST /api/projects/rename ─────────────────────────────────────
  if (req.method === "POST" && req.url === "/api/projects/rename") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }
    try {
      const { fromProjectId, toProjectId } = JSON.parse(await readBody(req));
      if (!isValidProjectId(fromProjectId) || !isValidProjectId(toProjectId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid project ID" }));
        return;
      }
      if (fromProjectId === toProjectId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Source and destination must be different" }));
        return;
      }

      const uid = user.uid ?? user.id;
      const fromCount = Number(stmts.countRunsForProjectUser.get(fromProjectId, uid)?.c ?? 0);
      const toCount = Number(stmts.countRunsForProjectUser.get(toProjectId, uid)?.c ?? 0);
      if (fromCount === 0) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Source project not found" }));
        return;
      }
      if (toCount > 0) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Target project already exists. Use merge instead." }));
        return;
      }

      const changed = stmts.renameProjectRunsForUser.run(toProjectId, fromProjectId, uid).changes;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, projectId: toProjectId, movedRuns: changed }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── API: POST /api/projects/merge ──────────────────────────────────────
  if (req.method === "POST" && req.url === "/api/projects/merge") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }
    try {
      const { sourceProjectId, destinationProjectId } = JSON.parse(await readBody(req));
      if (!isValidProjectId(sourceProjectId) || !isValidProjectId(destinationProjectId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid project ID" }));
        return;
      }
      if (sourceProjectId === destinationProjectId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Source and destination must be different" }));
        return;
      }

      const uid = user.uid ?? user.id;
      const sourceCount = Number(stmts.countRunsForProjectUser.get(sourceProjectId, uid)?.c ?? 0);
      const destCount = Number(stmts.countRunsForProjectUser.get(destinationProjectId, uid)?.c ?? 0);
      if (sourceCount === 0) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Source project not found" }));
        return;
      }
      if (destCount === 0) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Destination project not found" }));
        return;
      }

      const changed = stmts.renameProjectRunsForUser.run(destinationProjectId, sourceProjectId, uid).changes;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, destinationProjectId, movedRuns: changed }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── API: POST /api/scan-evaluate ─────────────────────────────────────────
  if (req.method === "POST" && req.url === "/api/scan-evaluate") {
    const user = getAuthUser(req);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Authentication required. Use a Bearer API key." }));
      return;
    }
    try {
      const { scan } = JSON.parse(await readBody(req));
      if (!scan || typeof scan !== "object" || Array.isArray(scan)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "scan is required and must be a JSON object" }));
        return;
      }
      const repoRoot = path.join(__dirname, "..");
      const corpusPath = path.join(repoRoot, "agent-quality", "evals", "workflow-corpus.json");
      const weightsPath = path.join(repoRoot, "agent-quality", "scorecard", "weights.json");
      const loadedCorpus = fs.existsSync(corpusPath)
        ? JSON.parse(fs.readFileSync(corpusPath, "utf8"))
        : DEFAULT_CORPUS;
      const loadedWeightsObj = fs.existsSync(weightsPath)
        ? JSON.parse(fs.readFileSync(weightsPath, "utf8"))
        : { weights: {} };
      const weights = Object.keys(loadedWeightsObj.weights ?? {}).length > 0
        ? loadedWeightsObj.weights
        : DEFAULT_WEIGHTS;
      const run = buildRunArtifact({ scan, corpus: loadedCorpus, weights, previousRun: null });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(run));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
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

      // Free tier: enforce lifetime scan limit of 3 per email (survives deletions)
      if (!isPaid(user)) {
        const freshUser = stmts.getUserById.get(uid);
        const lifetimeCount = Number(freshUser?.scans_published ?? 0);
        if (lifetimeCount >= 3) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Free tier limit reached (3 lifetime scans). Upgrade to Pro or Team to continue scanning." }));
          return;
        }
      }

      stmts.insertRun.run(projectId, uid, JSON.stringify(run));
      stmts.incrementScansPublished.run(uid);
      if (!isPaid(user)) {
        // Free tier keeps only the latest 3 visible records.
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
        recommendations: recommendationsFromRun(parsed, limited),
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
                  seats: String(seats),
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

  // ── API: POST /api/webhooks/lemonsqueezy — upgrade plan on payment ───────
  if (req.method === "POST" && req.url === "/api/webhooks/lemonsqueezy") {
    const webhookSecret = process.env.LEMON_WEBHOOK_SECRET;
    const rawBody = await readBody(req);

    // Always verify signature when secret is configured
    if (webhookSecret) {
      const sig = req.headers["x-signature"] ?? "";
      const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      const sigBuf = Buffer.from(sig, "hex");
      const expBuf = Buffer.from(expected, "hex");
      const valid = sigBuf.length > 0 && sigBuf.length === expBuf.length &&
        crypto.timingSafeEqual(sigBuf, expBuf);
      if (!valid) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid signature" }));
        return;
      }
    }

    let event;
    try { event = JSON.parse(rawBody); } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const eventName = event?.meta?.event_name ?? "";
    const objectId = String(event?.data?.id ?? "").trim() || null;
    const eventDigest = crypto.createHash("sha256").update(rawBody).digest("hex");
    const headerEventId = String(req.headers["x-event-id"] ?? req.headers["x-webhook-id"] ?? "").trim();
    const eventKey = headerEventId || `${eventName}:${objectId ?? "none"}:${eventDigest}`;

    const insert = stmts.insertWebhookEvent.run("lemonsqueezy", eventKey, eventName, objectId, rawBody);
    if (insert.changes === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, duplicate: true }));
      return;
    }

    const attrs = event?.data?.attributes ?? {};
    const attrsWithId = { ...attrs, id: event?.data?.id ?? attrs.id };
    const email = String(attrs.user_email ?? "").trim();
    const rawPlan = String(event?.meta?.custom_data?.plan ?? "").trim();
    const mappedPlan = ["free", "pro", "team"].includes(rawPlan) ? rawPlan : null;

    const upgradableEvents = [
      "order_created",
      "subscription_created",
      "subscription_payment_success",
      "subscription_payment_recovered",
      "subscription_plan_changed",
      "subscription_resumed",
      "subscription_updated",
    ];
    const statusOnlyEvents = ["subscription_cancelled", "subscription_payment_failed", "subscription_paused", "subscription_unpaused"];
    const downgradeEvents = ["subscription_expired", "order_refunded", "subscription_payment_refunded"];

    if (email && (upgradableEvents.includes(eventName) || statusOnlyEvents.includes(eventName) || downgradeEvents.includes(eventName))) {
      const dbUser = stmts.getUserByEmail.get(email);
      if (dbUser) {
        const qtyFromCustom = parseMaybeInt(event?.meta?.custom_data?.seats, NaN);
        const seats = Number.isInteger(qtyFromCustom)
          ? qtyFromCustom
          : subscriptionSeatsFromAttrs(attrsWithId, parseMaybeInt(dbUser.billing_seats, 1));

        const explicitPlan = downgradeEvents.includes(eventName)
          ? "free"
          : (mappedPlan === "pro" || mappedPlan === "team" ? mappedPlan : null);

        const nextState = persistedBillingFromSubscription(
          { ...attrsWithId, quantity: seats },
          dbUser,
          explicitPlan,
        );
        if (eventName === "subscription_cancelled") nextState.cancelled = 1;

        stmts.setUserBillingState.run(
          nextState.plan,
          nextState.customerId,
          nextState.subscriptionId,
          nextState.status,
          nextState.seats,
          nextState.renewsAt,
          nextState.cancelled,
          nextState.portalUrl,
          dbUser.id,
        );
      }
      // If user is not found we still return 200 to avoid endless retries.
    }

    // Always return 200 so Lemon doesn't retry for unrecognised event types
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
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

  if (req.method === "GET" && urlPath === "/settings") {
    serveStatic(res, path.join(WEB_DIR, "settings.html"));
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
