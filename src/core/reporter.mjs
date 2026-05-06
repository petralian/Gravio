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
 * Builds the scan catalog — pass/fail status and brief summaries only.
 * Full remediation details (why, how-to-fix, docs) are server-side only.
 * Each entry: { dim, id, severity, pass, label, brief }
 */
function buildCatalog(scan) {
  const {
    committedEnvFiles, gitignoreCoversEnv, gitignoreExists, securityPolicyExists,
    testSignal, cicdExists, hasRetryDependency, hasTypeSafety,
    evalCorpusExists, evalCorpusFileCount, hasBaseline, hasEvalScript,
    hasOtelDependency, hasStructuredLogging, hasRunArtifacts,
    readmeExists, licenseExists, hasChangelog, hasVersion,
  } = scan;

  return [
    // ── SAFETY ───────────────────────────────────────────────────────────────
    { dim: "safety", id: "secret-exposure", severity: "critical",
      pass: committedEnvFiles.length === 0,
      label: "Secret exposure",
      brief: committedEnvFiles.length === 0
        ? "0 files exposed"
        : `${committedEnvFiles.length} committed: ${committedEnvFiles.slice(0, 2).join(", ")}` },
    { dim: "safety", id: "gitignore-env", severity: "high",
      pass: scan.gitignoreEnvPasses,
      label: ".gitignore guards",
      brief: scan.gitignoreEnvNotApplicable
        ? "n/a — project does not use .env files"
        : scan.gitignoreCoversEnv
          ? ".env* covered"
          : scan.gitignoreExists ? ".gitignore missing .env*" : ".gitignore not found" },
    { dim: "safety", id: "security-policy", severity: "medium",
      pass: securityPolicyExists,
      label: "Security policy",
      brief: securityPolicyExists ? "SECURITY.md found" : "SECURITY.md missing" },

    // ── RELIABILITY ───────────────────────────────────────────────────────────
    { dim: "reliability", id: "test-signal", severity: "critical",
      pass: testSignal.testSignal,
      label: "Test signal",
      brief: testSignal.testSignal
        ? (testSignal.hasTestsFolder ? "tests/ detected" : "test files detected")
        : "no tests found" },
    { dim: "reliability", id: "cicd-pipeline", severity: "high",
      pass: cicdExists,
      label: "CI/CD pipeline",
      brief: cicdExists ? "workflow file found" : "no workflow file detected" },
    { dim: "reliability", id: "type-safety", severity: "medium",
      pass: hasTypeSafety,
      label: "Type safety",
      brief: hasTypeSafety ? "TypeScript / typecheck found" : "no type checking configured" },
    { dim: "reliability", id: "retry-resilience", severity: "medium",
      pass: scan.hasRetryLibrary ?? scan.hasRetryDependency,
      label: "Retry / resilience",
      brief: (scan.hasRetryLibrary ?? scan.hasRetryDependency)
        ? "retry library found"
        : scan.isPython
          ? "no tenacity / backoff / stamina detected"
          : "no retry library detected" },

    // ── EVALUATION ────────────────────────────────────────────────────────────
    { dim: "evaluation", id: "eval-corpus", severity: "high",
      pass: evalCorpusExists,
      label: "Eval corpus",
      brief: evalCorpusExists
        ? `evals/ found (${evalCorpusFileCount} JSON file${evalCorpusFileCount !== 1 ? "s" : ""})`
        : "no evals/ directory found" },
    { dim: "evaluation", id: "baseline-tracking", severity: "medium",
      pass: hasBaseline,
      label: "Baseline tracking",
      brief: hasBaseline ? "baseline.json found" : "no baseline.json" },
    { dim: "evaluation", id: "eval-script", severity: "low",
      pass: hasEvalScript,
      label: "Eval script",
      brief: hasEvalScript
        ? (scan.isPython ? "pytest / eval script found" : "eval script in package.json")
        : (scan.isPython ? "no pytest / tox / eval script detected" : "no eval script found") },

    // ── OBSERVABILITY ─────────────────────────────────────────────────────────
    { dim: "observability", id: "otel-tracing", severity: "high",
      pass: hasOtelDependency,
      label: "OTEL / tracing",
      brief: hasOtelDependency ? "tracing dependency found" : "no @opentelemetry dependency" },
    { dim: "observability", id: "structured-logging", severity: "medium",
      pass: hasStructuredLogging,
      label: "Structured logging",
      brief: hasStructuredLogging ? "logging library found" : "no logging library detected" },
    { dim: "observability", id: "run-artifacts", severity: "low",
      pass: hasRunArtifacts,
      label: "Run artifacts",
      brief: hasRunArtifacts ? "run JSON found" : "no run artifacts found" },

    // ── GOVERNANCE ────────────────────────────────────────────────────────────
    { dim: "governance", id: "readme", severity: "medium",
      pass: readmeExists,
      label: "README",
      brief: readmeExists ? "README.md found" : "README.md missing" },
    { dim: "governance", id: "changelog", severity: "medium",
      pass: hasChangelog,
      label: "Changelog",
      brief: hasChangelog ? "CHANGELOG.md found" : "CHANGELOG.md missing" },
    { dim: "governance", id: "license", severity: "low",
      pass: licenseExists,
      label: "License",
      brief: licenseExists ? "LICENSE found" : "no LICENSE file" },
    { dim: "governance", id: "version-pinned", severity: "low",
      pass: hasVersion,
      label: "Version field",
      brief: hasVersion ? "package.json versioned" : "no version in package.json" },
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

  // ── Dashboard CTA — remediation detail lives server-side ───────────────────
  console.log();
  if (totalIssues > 0) {
    const critLine = criticalFails > 0
      ? `  ${c.bgRed}${c.white}${c.bold}  ⚠  ${criticalFails} critical risk${criticalFails !== 1 ? "s" : ""} — open your dashboard immediately  ${c.reset}`
      : null;
    if (critLine) { console.log(critLine); console.log(); }

    console.log(
      `  ${scoreColor(overall)}${c.bold}${totalIssues} issue${totalIssues !== 1 ? "s" : ""} found across ${highFails + criticalFails} high/critical check${highFails + criticalFails !== 1 ? "s" : ""}${c.reset}` +
      `  ${c.dim}·  publish first, then open your dashboard for full remediation${c.reset}`
    );
  } else {
    console.log(`  ${c.bgreen}${c.bold}✦  All checks passed — publish for your quality certificate.${c.reset}`);
  }

  console.log();
  console.log(`  ${c.dim}${"─".repeat(60)}${c.reset}`);
  console.log();
  console.log(
    `  ${c.bcyan}${c.bold}  Full report + remediation steps${c.reset}` +
    `  ${c.dim}→${c.reset}  ${c.under}${c.bcyan}https://gravio.dev/dashboard${c.reset}`
  );
  console.log();
  console.log(hr("═"));
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
