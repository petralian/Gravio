/**
 * reporter.mjs
 * Gravio Scanner — CLI reporter.
 * Rich, colorful terminal output. No external dependencies — ANSI only.
 */

// ─── ANSI color palette ───────────────────────────────────────────────────────
const c = {
  reset:    "\x1b[0m",
  bold:     "\x1b[1m",
  dim:      "\x1b[2m",
  italic:   "\x1b[3m",
  under:    "\x1b[4m",

  // Standard foreground
  black:    "\x1b[30m",
  red:      "\x1b[31m",
  green:    "\x1b[32m",
  yellow:   "\x1b[33m",
  blue:     "\x1b[34m",
  magenta:  "\x1b[35m",
  cyan:     "\x1b[36m",
  white:    "\x1b[97m",
  gray:     "\x1b[90m",

  // Bright foreground
  bred:     "\x1b[91m",
  bgreen:   "\x1b[92m",
  byellow:  "\x1b[93m",
  bblue:    "\x1b[94m",
  bmagenta: "\x1b[95m",
  bcyan:    "\x1b[96m",

  // Background
  bgBlack:  "\x1b[40m",
  bgRed:    "\x1b[41m",
  bgGreen:  "\x1b[42m",
  bgBlue:   "\x1b[44m",
  bgCyan:   "\x1b[46m",
};

// Dimension accent colors
const DIM_COLOR = {
  safety:        c.bred,
  reliability:   c.bgreen,
  evaluation:    c.bblue,
  observability: c.bmagenta,
  governance:    c.byellow,
};

function scoreColor(score) {
  if (score >= 90) return c.bgreen;
  if (score >= 70) return c.bcyan;
  if (score >= 50) return c.byellow;
  return c.bred;
}

function sevColor(sev) {
  if (sev === "critical") return c.bred;
  if (sev === "high")     return c.byellow;
  if (sev === "medium")   return c.cyan;
  return c.gray;
}

function sevBadge(sev) {
  const col   = sevColor(sev);
  const label = sev.toUpperCase().padEnd(8);
  return `${col}${c.bold} ${label}${c.reset}`;
}

function gradeLabel(score) {
  if (score >= 90) return `${c.bgreen}${c.bold}A${c.reset}`;
  if (score >= 80) return `${c.bgreen}${c.bold}B${c.reset}`;
  if (score >= 70) return `${c.byellow}${c.bold}C${c.reset}`;
  if (score >= 60) return `${c.byellow}${c.bold}D${c.reset}`;
  return `${c.bred}${c.bold}F${c.reset}`;
}

function bar(score, width = 22) {
  const filled = Math.max(0, Math.min(width, Math.round((score / 100) * width)));
  const col = scoreColor(score);
  return `${col}${"█".repeat(filled)}${c.reset}${c.dim}${"░".repeat(width - filled)}${c.reset}`;
}

function hr(char = "─", len = 74, color = c.dim) {
  return `${color}${char.repeat(len)}${c.reset}`;
}

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

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Spinner (sync-friendly, rewrites the same line) ─────────────────────────
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let _spinnerIdx   = 0;
let _spinnerTimer = null;
let _spinnerLine  = "";

function spinnerStart(msg) {
  if (!process.stdout.isTTY) return;
  _spinnerLine = msg;
  _spinnerIdx  = 0;
  _spinnerTimer = setInterval(() => {
    const frame = SPINNER_FRAMES[_spinnerIdx++ % SPINNER_FRAMES.length];
    process.stdout.write(`\r  ${c.cyan}${frame}${c.reset}  ${_spinnerLine}`);
  }, 80);
}

function spinnerStop(icon, msg) {
  if (_spinnerTimer) { clearInterval(_spinnerTimer); _spinnerTimer = null; }
  if (process.stdout.isTTY) {
    process.stdout.write(`\r  ${icon}  ${msg}${" ".repeat(Math.max(0, 60 - msg.length))}\n`);
  } else {
    console.log(`  ${icon}  ${msg}`);
  }
}

// ─── Dimension config ─────────────────────────────────────────────────────────
const DIM_ORDER = ["safety", "reliability", "evaluation", "observability", "governance"];
const DIM_META  = {
  safety:        { label: "Safety",        icon: "🛡 ", weight: "30%" },
  reliability:   { label: "Reliability",   icon: "⚡ ", weight: "25%" },
  evaluation:    { label: "Evaluation",    icon: "🧪 ", weight: "20%" },
  observability: { label: "Observability", icon: "📡 ", weight: "10%" },
  governance:    { label: "Governance",    icon: "📋 ", weight: "15%" },
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
      docs: "https://gravio.dev/dashboard",
    },
    {
      dim: "evaluation", id: "baseline-tracking", severity: "medium",
      pass: hasBaseline,
      label: "Baseline tracking",
      brief: hasBaseline ? "baseline.json found" : "no baseline.json",
      title: "No score baseline tracked",
      why: "A baseline file lets CI fail the build when quality scores drop — it acts as a ratchet that prevents you from shipping a measurably worse agent than the last release.",
      fix: "# After a clean scan, commit the baseline:\ncp agent-quality/runs/latest.json agent-quality/baseline.json\ngit add agent-quality/baseline.json\ngit commit -m 'chore: capture quality baseline'\n\n# In CI, add after tests:\nnpm run scorecard:check",
      docs: "https://gravio.dev/onboarding",
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

// ─── Checks section ───────────────────────────────────────────────────────────
const HEADER_CHECK_IDS = [
  "secret-exposure", "gitignore-env",
  "test-signal",     "cicd-pipeline",
  "type-safety",     "eval-corpus",
  "otel-tracing",    "changelog",
  "readme",
];

function printCheckLines(catalog, scan) {
  let passCount = 0;
  let failCount = 0;

  for (const id of HEADER_CHECK_IDS) {
    const check = catalog.find((ch) => ch.id === id);
    if (!check) continue;

    if (check.pass) {
      passCount++;
      const icon  = `${c.bgreen}✔${c.reset}`;
      const label = `${c.white}${rpad(check.label, 24)}${c.reset}`;
      const brief = `${c.gray}${check.brief}${c.reset}`;
      console.log(`  ${icon}  ${label}${brief}`);
    } else {
      failCount++;
      const sevCol = sevColor(check.severity);
      const icon   = `${sevCol}✖${c.reset}`;
      const label  = `${c.bold}${rpad(check.label, 24)}${c.reset}`;
      const brief  = `${sevCol}${check.brief}${c.reset}`;
      const badge  = `  ${sevCol}${c.dim}[${check.severity}]${c.reset}`;
      console.log(`  ${icon}  ${label}${brief}${badge}`);
    }
  }

  // Git hygiene line
  const gitOk   = scan.trackedFileCount > 0;
  const gitIcon = gitOk ? `${c.bgreen}✔${c.reset}` : `${c.dim}~${c.reset}`;
  const gitLabel = `${c.white}${rpad("Git hygiene", 24)}${c.reset}`;
  const gitInfo  = gitOk
    ? `${c.gray}${scan.trackedFileCount} files tracked${c.reset}`
    : `${c.dim}no git tracking detected${c.reset}`;
  console.log(`  ${gitIcon}  ${gitLabel}${gitInfo}`);

  return { passCount, failCount };
}

// ─── Dimension bars ───────────────────────────────────────────────────────────
function printDimensionBars(scorecard) {
  console.log();
  for (const dim of DIM_ORDER) {
    const score    = scorecard[dim] ?? 0;
    const meta     = DIM_META[dim];
    const col      = DIM_COLOR[dim];
    const barStr   = bar(score);
    const scoreStr = lpad(String(Math.round(score)), 3);
    const grade    = gradeLabel(score);
    const label    = `${col}${rpad(meta.label, 14)}${c.reset}`;
    const weight   = `${c.dim}${meta.weight}${c.reset}`;
    console.log(`  ${meta.icon} ${label}  ${barStr}  ${scoreColor(score)}${c.bold}${scoreStr}${c.reset}  ${grade}  ${weight}`);
  }
  console.log();
}

// ─── Issue cards ──────────────────────────────────────────────────────────────
const SEV_ORDER = ["critical", "high", "medium", "low"];

function printIssues(catalog) {
  const failing = catalog.filter((ch) => !ch.pass);
  if (failing.length === 0) {
    console.log();
    console.log(`  ${c.bgreen}${c.bold}✦  Perfect scan — all checks passed.${c.reset}`);
    return;
  }

  // ── Critical alert banner ──────────────────────────────────────────────────
  const critCount = failing.filter((ch) => ch.severity === "critical").length;
  if (critCount > 0) {
    console.log();
    console.log(`  ${c.bgRed}${c.white}${c.bold}  ⚠  CRITICAL — immediate action required  ${c.reset}`);
  }

  for (const dim of DIM_ORDER) {
    const issues = failing
      .filter((ch) => ch.dim === dim)
      .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
    if (issues.length === 0) continue;

    const meta   = DIM_META[dim];
    const dimCol = DIM_COLOR[dim];

    console.log();
    console.log(`  ${dimCol}${c.bold}${meta.icon} ${meta.label.toUpperCase()}${c.reset}  ${c.dim}${"─".repeat(54)}${c.reset}`);

    for (const issue of issues) {
      console.log();

      // Severity badge + title
      console.log(`  ${sevBadge(issue.severity)} ${c.bold}${c.white}${issue.title}${c.reset}`);

      // Why this matters
      console.log();
      for (const line of wrapText(issue.why, 66)) {
        console.log(`  ${c.dim}${line}${c.reset}`);
      }

      // Fix block
      console.log();
      console.log(`  ${c.cyan}${c.bold}How to fix${c.reset}  ${c.dim}${"·".repeat(54)}${c.reset}`);
      for (const line of issue.fix.split("\n")) {
        if (line.startsWith("#")) {
          console.log(`  ${c.dim}${line}${c.reset}`);
        } else if (line.startsWith("⚠")) {
          console.log(`  ${c.byellow}${c.bold}${line}${c.reset}`);
        } else if (line === "") {
          console.log();
        } else {
          console.log(`  ${c.bcyan}│${c.reset}  ${c.white}${line}${c.reset}`);
        }
      }

      // Docs link
      if (issue.docs) {
        console.log();
        console.log(`  ${c.dim}📖  ${issue.docs}${c.reset}`);
      }

      console.log();
      console.log(`  ${c.dim}${"·".repeat(72)}${c.reset}`);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Print the full, colorful scan report.
 * @param {{ run: object, scan: object, version?: string }} opts
 */
export function printScanReport({ run, scan, version = "?" }) {
  const catalog   = buildCatalog(scan);
  const scorecard = run.scorecard ?? {};
  const overall   = run.summary?.overallScore ?? 0;

  const criticalFails = catalog.filter((ch) => !ch.pass && ch.severity === "critical").length;
  const highFails     = catalog.filter((ch) => !ch.pass && ch.severity === "high").length;
  const totalIssues   = catalog.filter((ch) => !ch.pass).length;
  const totalChecks   = HEADER_CHECK_IDS.length + 1; // +1 for git hygiene
  const overallPassed = overall >= 87 && criticalFails === 0;

  // ── Header banner ───────────────────────────────────────────────────────────
  console.log();
  console.log(hr("═"));
  console.log();
  console.log(
    `  ${c.bcyan}${c.bold}  gravio  ${c.reset}` +
    `${c.dim}AI Agent Quality Engine${c.reset}` +
    " ".repeat(22) +
    `${c.dim}v${version}  ${timestamp()}${c.reset}`
  );
  console.log();
  console.log(`  ${c.dim}Target   ${c.reset}${c.cyan}${scan.targetDir}${c.reset}`);
  console.log(`  ${c.dim}Files    ${c.reset}${c.white}${scan.totalFiles}${c.reset}${c.dim} total · ${scan.trackedFileCount} git-tracked${c.reset}`);
  console.log();
  console.log(hr("═"));

  // ── Checks ──────────────────────────────────────────────────────────────────
  console.log();
  console.log(`  ${c.bold}${c.white}Checks${c.reset}  ${c.dim}Running ${totalChecks} quality gates${c.reset}`);
  console.log();
  const { passCount, failCount } = printCheckLines(catalog, scan);

  // ── Pass/fail summary pill ──────────────────────────────────────────────────
  console.log();
  const passStr = `${c.bgreen}${c.bold}✔ ${passCount} passed${c.reset}`;
  const failStr = failCount > 0 ? `  ${c.bred}${c.bold}✖ ${failCount} failed${c.reset}` : "";
  console.log(`  ${passStr}${failStr}  ${c.dim}· ${scan.totalFiles} files scanned${c.reset}`);

  // ── Dimension scores ─────────────────────────────────────────────────────────
  console.log();
  console.log(hr());
  console.log();
  console.log(`  ${c.bold}${c.white}Scores${c.reset}  ${c.dim}Five dimensions of agent quality${c.reset}`);
  printDimensionBars(scorecard);

  // ── Overall score banner ─────────────────────────────────────────────────────
  console.log(hr());
  console.log();

  const grade     = gradeLabel(overall);
  const passLabel = overallPassed
    ? `${c.bgGreen}${c.black}${c.bold}  PASS  ${c.reset}`
    : `${c.bgRed}${c.white}${c.bold}  FAIL  ${c.reset}`;

  console.log(
    `  ${c.dim}Overall score${c.reset}   ` +
    `${scoreColor(overall)}${c.bold}${overall.toFixed(1)}${c.reset}${c.dim} / 100${c.reset}` +
    `   ${grade}   ${passLabel}`
  );
  console.log();

  // Stats row
  const critStr  = criticalFails > 0
    ? `${c.bred}${c.bold}⚠ ${criticalFails} critical${c.reset}`
    : `${c.bgreen}✔ 0 critical${c.reset}`;
  const highStr  = highFails > 0
    ? `  ${c.byellow}⚠ ${highFails} high${c.reset}`
    : `  ${c.dim}0 high${c.reset}`;
  const issueStr = totalIssues > 0
    ? `  ${c.dim}${totalIssues} issue${totalIssues !== 1 ? "s" : ""} total${c.reset}`
    : `  ${c.dim}0 issues${c.reset}`;

  console.log(`  ${critStr}${highStr}${issueStr}`);
  console.log();
  console.log(hr());

  // ── Issues ──────────────────────────────────────────────────────────────────
  if (totalIssues > 0) {
    console.log();
    console.log(`  ${c.bold}${c.white}Issues${c.reset}  ${c.dim}${totalIssues} thing${totalIssues !== 1 ? "s" : ""} to fix${c.reset}`);
    printIssues(catalog);
    console.log(hr());
  } else {
    console.log();
    console.log(`  ${c.bgreen}${c.bold}✦  Excellent — all checks passed. Your agent is production-grade.${c.reset}`);
    console.log();
    console.log(hr());
  }

  // ── Next step hint ───────────────────────────────────────────────────────────
  console.log();
  console.log(`  ${c.dim}Next  ${c.reset}${c.cyan}gravio.dev/dashboard${c.reset}${c.dim}  →  view trends & history${c.reset}`);
  console.log();
}

/**
 * Print a compact, colorful one-line update for watch mode.
 */
export function printWatchUpdate({ run, scan }) {
  const scorecard = run.scorecard ?? {};
  const overall   = run.summary?.overallScore ?? 0;
  const passed    = overall >= 87;
  const passLabel = passed
    ? `${c.bgGreen}${c.black}${c.bold} PASS ${c.reset}`
    : `${c.bgRed}${c.white}${c.bold} FAIL ${c.reset}`;

  const dims = DIM_ORDER
    .map((d) => {
      const score = Math.round(scorecard[d] ?? 0);
      const meta  = DIM_META[d];
      return `${meta.icon}${DIM_COLOR[d]}${score}${c.reset}`;
    })
    .join("  ");

  const now  = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, "0")).join(":");

  console.log(
    `\n  ${c.dim}[${time}]${c.reset}  ` +
    `${scoreColor(overall)}${c.bold}${overall.toFixed(1)}${c.reset}${c.dim}/100${c.reset}  ` +
    `${passLabel}  ` +
    `${dims}  ` +
    `${c.dim}${scan.totalFiles} files${c.reset}`
  );
}

/**
 * Print a scan progress bar (reuses same line on TTY).
 */
export function printScanStep(step) {
  const SCAN_STEPS = [
    "Reading file tree",
    "Checking git tracking",
    "Analysing safety signals",
    "Analysing reliability signals",
    "Analysing evaluation signals",
    "Analysing observability signals",
    "Analysing governance signals",
    "Computing scorecard",
  ];
  if (!process.stdout.isTTY) return;
  const total  = SCAN_STEPS.length;
  const cur    = Math.min(step, total);
  const pct    = Math.round((cur / total) * 100);
  const barW   = 28;
  const filled = Math.round((cur / total) * barW);
  const b      = `${c.cyan}${"█".repeat(filled)}${c.reset}${c.dim}${"░".repeat(barW - filled)}${c.reset}`;
  const label  = step < total ? (SCAN_STEPS[step] ?? "") : "Complete";
  process.stdout.write(
    `\r  ${b}  ${c.dim}${lpad(String(pct), 3)}%${c.reset}  ${c.gray}${label}${" ".repeat(36)}${c.reset}`
  );
}

/**
 * Print the publish result.
 */
export function printPublishResult({ server, project, success, error }) {
  console.log();
  if (success) {
    const dashUrl = `${server}/dashboard`;
    console.log(`  ${c.bgreen}${c.bold}✔  Published${c.reset}  ${c.dim}→${c.reset}  ${c.cyan}${c.under}${dashUrl}${c.reset}`);
    console.log(`  ${c.dim}Project${c.reset}  ${c.white}${project}${c.reset}`);
    console.log();
    console.log(`  ${c.dim}Open your dashboard to view trends, history, and issue details.${c.reset}`);
  } else {
    console.log(`  ${c.bred}${c.bold}✖  Publish failed${c.reset}  ${c.dim}${error ?? "unknown error"}${c.reset}`);
    console.log();
    console.log(`  ${c.dim}Check your --api-key and --server flags, then try again.${c.reset}`);
    console.log(`  ${c.dim}Create an API key at ${c.reset}${c.cyan}gravio.dev/dashboard${c.reset}`);
  }
  console.log();
}
