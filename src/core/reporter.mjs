/**
 * reporter.mjs
 * Gravio Scanner — CLI reporter.
 * Formats scan results as a rich, Lighthouse-style terminal report.
 * No external dependencies — plain ANSI escape codes only.
 */

// ─── ANSI helpers ────────────────────────────────────────────────────────────
const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  cyan:   "\x1b[96m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  white:  "\x1b[97m",
  gray:   "\x1b[90m",
};

function scoreColor(score) {
  if (score >= 90) return c.green;
  if (score >= 70) return c.cyan;
  if (score >= 50) return c.yellow;
  return c.red;
}

function sevColor(sev) {
  if (sev === "critical") return c.red;
  if (sev === "high")     return c.yellow;
  return c.dim;
}

function bar(score, width = 20) {
  const filled = Math.max(0, Math.min(width, Math.round((score / 100) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function hr(len = 72) { return `${c.dim}${"─".repeat(len)}${c.reset}`; }

function rpad(str, len) { return str + " ".repeat(Math.max(0, len - str.length)); }

function lpad(str, len) { return " ".repeat(Math.max(0, len - str.length)) + str; }

function wrapText(text, maxLen) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const word of words) {
    if ((cur + word).length > maxLen) {
      if (cur) lines.push(cur.trimEnd());
      cur = word + " ";
    } else {
      cur += word + " ";
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Dimension config ─────────────────────────────────────────────────────────
const DIM_ORDER  = ["safety", "reliability", "evaluation", "observability", "governance"];
const DIM_LABELS = {
  safety:        "Safety",
  reliability:   "Reliability",
  evaluation:    "Evaluation",
  observability: "Observability",
  governance:    "Governance",
};

// ─── Diagnostic Catalog ───────────────────────────────────────────────────────
/**
 * Builds the full diagnostic catalog from a scan result.
 * Each entry: { dim, id, severity, pass, label, brief, title, why, fix, docs? }
 */
function buildCatalog(scan) {
  const {
    committedEnvFiles, gitignoreCoversEnv, gitignoreExists, securityPolicyExists,
    testSignal, cicdExists, hasRetryDependency, hasTypeSafety,
    evalCorpusExists, evalCorpusFileCount, hasBaseline, hasEvalScript, hasGoldenDatasets,
    hasOtelDependency, hasStructuredLogging, hasRunArtifacts,
    readmeExists, licenseExists, hasChangelog, hasVersion, hasNotes,
  } = scan;

  return [
    // ── SAFETY ───────────────────────────────────────────────────────────────
    {
      dim: "safety", id: "secret-exposure", severity: "critical",
      pass: committedEnvFiles.length === 0,
      label: "Secret exposure",
      brief: committedEnvFiles.length === 0
        ? "0 files exposed"
        : `${committedEnvFiles.length} committed: ${committedEnvFiles.slice(0, 2).join(", ")}`,
      title: "Committed secret file detected",
      why: `${committedEnvFiles.join(", ")} found in git history. Secrets in git history are permanent — even after deletion, they live in every old commit and every clone of the repo.`,
      fix: `git rm --cached ${committedEnvFiles[0] ?? ".env"}\necho '.env*' >> .gitignore\ngit commit -m "fix: remove committed secrets"\n\n⚠  Rotate all exposed credentials immediately — treat them as fully compromised.`,
      docs: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository",
    },
    {
      dim: "safety", id: "gitignore-env", severity: "high",
      pass: gitignoreCoversEnv,
      label: ".gitignore guards",
      brief: gitignoreCoversEnv
        ? ".env* covered"
        : gitignoreExists ? ".gitignore missing .env*" : ".gitignore not found",
      title: ".gitignore does not cover .env files",
      why: "A single `git add .` with .env* unignored exposes every secret in one push. This is the single most common credential leak vector for agent projects.",
      fix: "# Append to .gitignore:\n.env\n.env.*\n!.env.example",
      docs: "https://docs.github.com/en/get-started/getting-started-with-git/ignoring-files",
    },
    {
      dim: "safety", id: "security-policy", severity: "medium",
      pass: securityPolicyExists,
      label: "Security policy",
      brief: securityPolicyExists ? "SECURITY.md found" : "SECURITY.md missing",
      title: "No SECURITY.md vulnerability disclosure policy",
      why: "Without a security policy, reporters have no private channel — so they post findings publicly instead, which puts your users at risk.",
      fix: "Create SECURITY.md with:\n  - Contact email for vulnerability reports\n  - Scope: what is / isn't in scope\n  - Response timeline (e.g. 48h ack, 90-day fix window)",
      docs: "https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository",
    },

    // ── RELIABILITY ───────────────────────────────────────────────────────────
    {
      dim: "reliability", id: "test-signal", severity: "critical",
      pass: testSignal.testSignal,
      label: "Test signal",
      brief: testSignal.testSignal
        ? (testSignal.hasTestsFolder ? "tests/ detected" : "test files detected")
        : "no tests found",
      title: "No tests detected",
      why: "Untested agent code regresses silently. Every prompt change, tool schema update, or dependency bump needs an automated safety net to catch the break before it ships.",
      fix: "mkdir tests\ncat > tests/sample.test.mjs << 'EOF'\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('basic sanity', () => assert.ok(true));\nEOF\n\n# Add to package.json scripts:\n\"test\": \"node --test\"",
      docs: "https://nodejs.org/api/test.html",
    },
    {
      dim: "reliability", id: "cicd-pipeline", severity: "high",
      pass: cicdExists,
      label: "CI/CD pipeline",
      brief: cicdExists ? "workflow file found" : "no workflow file detected",
      title: "No CI/CD pipeline detected",
      why: "Under deadline pressure, local tests get skipped. Automation makes the build gate non-negotiable — every push is blocked until tests pass, regardless of how rushed the dev is.",
      fix: "# Create .github/workflows/ci.yml:\nname: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: 20 }\n      - run: npm ci && npm test",
      docs: "https://docs.github.com/en/actions/quickstart",
    },
    {
      dim: "reliability", id: "type-safety", severity: "medium",
      pass: hasTypeSafety,
      label: "Type safety",
      brief: hasTypeSafety ? "TypeScript / typecheck found" : "no type checking configured",
      title: "No type checking configured",
      why: "LLM tool call interfaces are strongly typed contracts. A mismatched schema means the model sends a malformed call and nothing warns you — the bug only surfaces at runtime, in production.",
      fix: "npm install -D typescript\nnpx tsc --init\n\n# Add to package.json scripts:\n\"typecheck\": \"tsc --noEmit\"",
      docs: "https://www.typescriptlang.org/docs/handbook/tsconfig-json.html",
    },
    {
      dim: "reliability", id: "retry-resilience", severity: "medium",
      pass: hasRetryDependency,
      label: "Retry / resilience",
      brief: hasRetryDependency ? "retry library found" : "no retry library detected",
      title: "No retry / resilience library detected",
      why: "LLM APIs fail transiently — rate limits, timeouts, model overload, network blips. Without retry logic, every transient error becomes a user-visible failure and a wasted token spend.",
      fix: "npm install p-retry\n\n# Wrap every LLM call:\nimport pRetry from 'p-retry';\nconst result = await pRetry(\n  () => callLLM(prompt),\n  { retries: 3, factor: 2, minTimeout: 1000 }\n);",
      docs: "https://github.com/sindresorhus/p-retry",
    },

    // ── EVALUATION ────────────────────────────────────────────────────────────
    {
      dim: "evaluation", id: "eval-corpus", severity: "high",
      pass: evalCorpusExists,
      label: "Eval corpus",
      brief: evalCorpusExists
        ? `evals/ found (${evalCorpusFileCount} JSON file${evalCorpusFileCount !== 1 ? "s" : ""})`
        : "no evals/ directory found",
      title: "No eval corpus detected",
      why: "Without golden test cases you cannot tell if a prompt change improved or degraded your agent's output quality. You are shipping blind — every release is a guess.",
      fix: "mkdir -p evals/golden\ncat > evals/golden/sample.json << 'EOF'\n{\n  \"id\": \"basic-001\",\n  \"input\": \"Summarise this meeting in 3 bullets\",\n  \"expected_contains\": [\"action items\", \"owner\", \"deadline\"],\n  \"tags\": [\"regression\"]\n}\nEOF",
      docs: "https://gravio.dev/tool",
    },
    {
      dim: "evaluation", id: "baseline-tracking", severity: "medium",
      pass: hasBaseline,
      label: "Baseline tracking",
      brief: hasBaseline ? "baseline.json found" : "no baseline.json",
      title: "No score baseline tracked",
      why: "A baseline file lets CI fail the build when quality scores drop — it acts as a ratchet that prevents you from shipping a measurably worse agent than the last release.",
      fix: "# After a clean scan, commit the baseline:\ncp agent-quality/runs/latest.json agent-quality/baseline.json\ngit add agent-quality/baseline.json\ngit commit -m 'chore: capture quality baseline'\n\n# In CI, add after tests:\nnpm run scorecard:check",
      docs: "https://gravio.dev/download",
    },
    {
      dim: "evaluation", id: "eval-script", severity: "low",
      pass: hasEvalScript,
      label: "Eval script",
      brief: hasEvalScript ? "eval script in package.json" : "no eval script found",
      title: "No eval / bench script in package.json",
      why: "A runnable eval script makes it one command to benchmark the effect of every prompt change across your entire golden corpus — without one, evals are ad hoc and skipped.",
      fix: "# Add to package.json scripts:\n\"eval\": \"node scripts/run-evals.mjs\"\n\n# Then run:\nnpm run eval",
    },

    // ── OBSERVABILITY ─────────────────────────────────────────────────────────
    {
      dim: "observability", id: "otel-tracing", severity: "high",
      pass: hasOtelDependency,
      label: "OTEL / tracing",
      brief: hasOtelDependency ? "tracing dependency found" : "no @opentelemetry dependency",
      title: "No distributed tracing dependency detected",
      why: "Without traces you cannot diagnose why your agent failed, was slow, or over-spent tokens. Every LLM call should be a span with token counts, latency, and error metadata you can inspect.",
      fix: "npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node\n\n# instrumentation.js (import before all other code):\nimport { NodeSDK } from '@opentelemetry/sdk-node';\nimport { getNodeAutoInstrumentations } from\n  '@opentelemetry/auto-instrumentations-node';\nnew NodeSDK({\n  serviceName: 'my-agent',\n  instrumentations: [getNodeAutoInstrumentations()],\n}).start();",
      docs: "https://opentelemetry.io/docs/languages/js/getting-started/nodejs/",
    },
    {
      dim: "observability", id: "structured-logging", severity: "medium",
      pass: hasStructuredLogging,
      label: "Structured logging",
      brief: hasStructuredLogging ? "logging library found" : "no logging library detected",
      title: "No structured logging library detected",
      why: "Plain console.log is unqueryable and unsearchable in production. Structured JSON logs let you build real-time alerts, dashboards, and trace LLM call cost per user in one query.",
      fix: "npm install pino\n\nimport pino from 'pino';\nconst log = pino({ level: 'info' });\nlog.info({ runId, tokens, latencyMs }, 'LLM call complete');",
      docs: "https://getpino.io",
    },
    {
      dim: "observability", id: "run-artifacts", severity: "low",
      pass: hasRunArtifacts,
      label: "Run artifacts",
      brief: hasRunArtifacts ? "run JSON found" : "no run artifacts found",
      title: "No run artifacts found in agent-quality/runs/",
      why: "Run artifacts give you a time-series quality history. Without them you cannot answer \"when did our safety score drop?\" or correlate regressions to specific deploys.",
      fix: "# Generate your first artifact:\nnode gravio.mjs --once --target .\n\n# This writes agent-quality/runs/latest.json with your full scorecard.\n# Commit it to track quality over time.",
    },

    // ── GOVERNANCE ────────────────────────────────────────────────────────────
    {
      dim: "governance", id: "readme", severity: "medium",
      pass: readmeExists,
      label: "README",
      brief: readmeExists ? "README.md found" : "README.md missing",
      title: "No README.md",
      why: "Without documentation the next developer — or your future self at 2am during an incident — cannot safely understand, extend, or operate your agent.",
      fix: "# Create README.md with at minimum:\n## What this agent does\n## Setup\n  npm install && cp .env.example .env\n## Running evals\n  npm run eval\n## Environment variables\n  OPENAI_API_KEY — required\n## Architecture decisions",
    },
    {
      dim: "governance", id: "changelog", severity: "medium",
      pass: hasChangelog,
      label: "Changelog",
      brief: hasChangelog ? "CHANGELOG.md found" : "CHANGELOG.md missing",
      title: "No CHANGELOG.md",
      why: "A changelog is your incident log. Without it you cannot trace which release introduced a regression, what changed between versions, or communicate risk to stakeholders.",
      fix: "# Create CHANGELOG.md:\n## [Unreleased]\n### Added\n- Initial agent implementation\n\n## [0.1.0] - 2026-01-01\n### Added\n- Project scaffold",
      docs: "https://keepachangelog.com",
    },
    {
      dim: "governance", id: "license", severity: "low",
      pass: licenseExists,
      label: "License",
      brief: licenseExists ? "LICENSE found" : "no LICENSE file",
      title: "No LICENSE file",
      why: "Without a license, all rights are reserved by default — no one can legally use, fork, or deploy your agent, including your own team members under different employment contracts.",
      fix: "# Add MIT license (or pick at choosealicense.com):\nnpx license MIT > LICENSE\ngit add LICENSE && git commit -m 'chore: add MIT license'",
      docs: "https://choosealicense.com",
    },
    {
      dim: "governance", id: "version-pinned", severity: "low",
      pass: hasVersion,
      label: "Version field",
      brief: hasVersion ? "package.json versioned" : "no version in package.json",
      title: "No version field in package.json",
      why: "Version pinning enables rollback correlation. When a bug is reported you can ask \"did this start in v1.2?\" and answer it — without a version there is no breadcrumb.",
      fix: "# Add to package.json:\n\"version\": \"0.1.0\"\n\n# Then tag every release:\ngit tag v0.1.0 && git push origin --tags",
    },
  ];
}

// ─── Check-line summary ───────────────────────────────────────────────────────
const HEADER_CHECK_IDS = [
  "secret-exposure",
  "gitignore-env",
  "test-signal",
  "cicd-pipeline",
  "eval-corpus",
  "otel-tracing",
  "changelog",
  "readme",
];

function printCheckLines(catalog, scan) {
  for (const id of HEADER_CHECK_IDS) {
    const check = catalog.find((ch) => ch.id === id);
    if (!check) continue;
    const icon   = check.pass ? `${c.green}[✓]${c.reset}` : `${c.red}[✗]${c.reset}`;
    const label  = rpad(check.label, 22);
    const detail = check.pass
      ? `${c.gray}${check.brief}${c.reset}`
      : `${c.yellow}${check.brief}${c.reset}`;
    console.log(`  ${icon}  ${label}${detail}`);
  }

  // Git hygiene line
  const gitOk   = scan.trackedFileCount > 0;
  const gitIcon = gitOk ? `${c.green}[✓]${c.reset}` : `${c.dim}[~]${c.reset}`;
  const gitInfo = gitOk
    ? `${c.gray}${scan.trackedFileCount} files tracked${c.reset}`
    : `${c.dim}no git tracking detected${c.reset}`;
  console.log(`  ${gitIcon}  ${rpad("Git hygiene", 22)}${gitInfo}`);
}

// ─── Dimension bars ───────────────────────────────────────────────────────────
function printDimensionBars(scorecard) {
  console.log();
  for (const dim of DIM_ORDER) {
    const score   = scorecard[dim] ?? 0;
    const label   = rpad(DIM_LABELS[dim], 13);
    const col     = scoreColor(score);
    const filled  = bar(score);
    const scoreStr = lpad(String(Math.round(score)), 3);
    console.log(`  ${c.white}${label}${c.reset}  ${col}${filled}${c.reset}  ${col}${c.bold}${scoreStr}${c.reset}`);
  }
  console.log();
}

// ─── Issue detail section ─────────────────────────────────────────────────────
const SEV_ORDER = ["critical", "high", "medium", "low"];

function printIssues(catalog) {
  const failing = catalog.filter((ch) => !ch.pass);
  if (failing.length === 0) {
    console.log(`  ${c.green}✓${c.reset}  All checks passed — no issues to report.`);
    return;
  }

  // Group by dimension in DIM_ORDER, sort each group by severity
  for (const dim of DIM_ORDER) {
    const issues = failing
      .filter((ch) => ch.dim === dim)
      .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
    if (issues.length === 0) continue;

    for (const issue of issues) {
      const sevCol   = sevColor(issue.severity);
      const sevLabel = issue.severity.toUpperCase();
      const dimTitle = DIM_LABELS[dim].toUpperCase();

      console.log();
      console.log(
        `  ${c.bold}${c.white}${dimTitle}${c.reset}  ` +
        `${c.dim}${"─".repeat(Math.max(0, 44 - dimTitle.length))}${c.reset}  ` +
        `${sevCol}[${sevLabel}]${c.reset}`
      );
      console.log();
      console.log(`  ${c.bold}${issue.title}${c.reset}`);
      const wrapped = wrapText(issue.why, 68);
      for (const line of wrapped) {
        console.log(`  ${c.dim}${line}${c.reset}`);
      }
      console.log();
      console.log(`  ${c.cyan}Fix ▸${c.reset}`);
      for (const line of issue.fix.split("\n")) {
        console.log(`  ${c.gray}│${c.reset}  ${line}`);
      }
      if (issue.docs) {
        console.log();
        console.log(`  ${c.dim}Docs ▸ ${issue.docs}${c.reset}`);
      }
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Print the full scan report to stdout.
 * @param {{ run: object, scan: object, version?: string }} opts
 */
export function printScanReport({ run, scan, version = "?" }) {
  const catalog  = buildCatalog(scan);
  const scorecard = run.scorecard ?? {};
  const overall  = run.summary?.overallScore ?? 0;

  const criticalFails = catalog.filter((ch) => !ch.pass && ch.severity === "critical").length;
  const totalIssues   = catalog.filter((ch) => !ch.pass).length;
  // Use same gate as evaluate.mjs default threshold
  const overallPassed = overall >= 87 && criticalFails === 0;

  // ── Header ─────────────────────────────────────────────────────────────────
  console.log();
  console.log(hr());
  console.log();
  console.log(
    `  ${c.cyan}${c.bold}gravio${c.reset}` +
    " ".repeat(38) +
    `${c.dim}Gravio v${version}  ${today()}${c.reset}`
  );
  console.log();
  console.log(`  Scanning  ${c.cyan}${scan.targetDir}${c.reset}`);
  console.log(`  ${c.dim}${scan.totalFiles} files · ${scan.trackedFileCount} tracked${c.reset}`);
  console.log();

  // ── Check lines ─────────────────────────────────────────────────────────────
  printCheckLines(catalog, scan);

  // ── Dimension bars ──────────────────────────────────────────────────────────
  console.log();
  console.log(hr());
  printDimensionBars(scorecard);

  // ── Score summary ───────────────────────────────────────────────────────────
  console.log(hr());
  console.log();

  const passLabel = overallPassed
    ? `${c.green}${c.bold} PASS ${c.reset}`
    : `${c.red}${c.bold} FAIL ${c.reset}`;

  const critStr = criticalFails > 0
    ? `  ${c.red}·  ${criticalFails} critical risk${criticalFails !== 1 ? "s" : ""}${c.reset}`
    : `  ${c.dim}·  0 critical risks${c.reset}`;

  const issueStr = totalIssues > 0
    ? `  ${c.dim}·  ${totalIssues} issue${totalIssues !== 1 ? "s" : ""}${c.reset}`
    : "";

  console.log(
    `  Score: ${c.cyan}${c.bold}${overall.toFixed(1)}${c.reset} / 100` +
    `  ·  ${passLabel}${critStr}${issueStr}`
  );
  console.log();
  console.log(hr());

  // ── Issues section ──────────────────────────────────────────────────────────
  if (totalIssues > 0) {
    console.log();
    console.log(
      `  ${c.bold}${c.white}Issues  (${totalIssues})${c.reset}` +
      `  ${c.dim}${"─".repeat(56)}${c.reset}`
    );
    printIssues(catalog);
    console.log();
    console.log(hr());
  }

  console.log();
}

/**
 * Print a compact one-line update for watch mode.
 * @param {{ run: object, scan: object }} opts
 */
export function printWatchUpdate({ run, scan }) {
  const scorecard = run.scorecard ?? {};
  const overall   = run.summary?.overallScore ?? 0;
  const now       = new Date();
  const time      = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, "0")).join(":");
  const passed    = overall >= 87;
  const passLabel = passed ? `${c.green}PASS${c.reset}` : `${c.red}FAIL${c.reset}`;
  const dims      = DIM_ORDER
    .map((d) => `${d.slice(0, 3)}: ${scoreColor(scorecard[d] ?? 0)}${Math.round(scorecard[d] ?? 0)}${c.reset}`)
    .join("  ");

  console.log(
    `  ${c.dim}[${time}]${c.reset}  Score: ${c.cyan}${c.bold}${overall.toFixed(1)}${c.reset}/100` +
    `  ${passLabel}  ${c.dim}${dims}${c.reset}`
  );
}

/**
 * Print the publish result line(s).
 * @param {{ server: string, project: string, success: boolean, error?: string }} opts
 */
export function printPublishResult({ server, project, success, error }) {
  console.log();
  if (success) {
    const dashUrl = `${server}/dashboard?project=${encodeURIComponent(project)}`;
    console.log(`  ${c.green}[✓]${c.reset}  Encrypting result...`);
    console.log(`  ${c.green}[✓]${c.reset}  Published to ${c.cyan}${dashUrl}${c.reset}`);
  } else {
    console.log(`  ${c.red}[✗]${c.reset}  Publish failed: ${error ?? "unknown error"}`);
  }
  console.log();
}
