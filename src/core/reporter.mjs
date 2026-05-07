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
  agentic:       c.bcyan,
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
const DIM_ORDER = ["safety", "reliability", "evaluation", "observability", "governance", "agentic"];
const DIM_META  = {
  safety:        { label: "Safety",        icon: "�", weight: "25%" },
  reliability:   { label: "Reliability",   icon: "⚡️", weight: "20%" },
  evaluation:    { label: "Evaluation",    icon: "🧪", weight: "15%" },
  observability: { label: "Observability", icon: "📡", weight: "10%" },
  governance:    { label: "Governance",    icon: "📋", weight: "15%" },
  agentic:       { label: "Agentic",       icon: "🤖", weight: "15%" },
};

// ─── Diagnostic Catalog ───────────────────────────────────────────────────────
/**
 * Builds the scan catalog — pass/fail status and brief summaries.
 * Each entry: { dim, subdim, id, severity, difficulty, estimatedMinutes, impactScore, pass, label, brief, action }
 *
 * difficulty: "quick-win" | "medium" | "deep-refactor" | "architectural"
 * impactScore: estimated pts added to overall score if this check is fixed
 */
function buildCatalog(scan) {
  const {
    committedEnvFiles, securityPolicyExists,
    testSignal, cicdExists, hasTypeSafety,
    evalCorpusExists, evalCorpusFileCount, hasBaseline, hasEvalScript,
    hasOtelDependency, hasStructuredLogging, hasRunArtifacts,
    readmeExists, licenseExists, hasChangelog, hasVersion,
    hasAiDocs, hasAgentSkillCatalog, hasPromptAssets,
    // Phase 1 expansion signals
    hasCloudCredentialFiles, hasDependencyVulnCheck,
    hasTestCoverage, hasIntegrationTests, hasE2eTests, hasHealthCheck,
    hasAdversarialTests, hasGoldenDatasets,
    hasMonitoringConfig, hasSloDefinition,
    hasApiDocs, hasCommitLintConfig, hasDependencyUpdateConfig,
    hasCodeOwners,
    hasSafetyRulesInInstructions, hasModelPinned, hasPromptVersioning, hasToolWhitelist,
    hasLockFile, hasLintConfig, hasPreCommitHooks, hasEvalConfig,
  } = scan;

  return [
    // ── SAFETY — Secrets & Exposure ─────────────────────────────────────────
    { dim: "safety", subdim: "secrets-exposure", id: "secret-exposure", severity: "critical",
      difficulty: "quick-win", estimatedMinutes: 5, impactScore: 4,
      pass: committedEnvFiles.length === 0,
      label: "Secret exposure",
      brief: committedEnvFiles.length === 0
        ? "0 files exposed"
        : `${committedEnvFiles.length} committed: ${committedEnvFiles.slice(0, 2).join(", ")}`,
      action: "Remove committed env files and rotate any exposed credentials immediately." },
    { dim: "safety", subdim: "secrets-exposure", id: "gitignore-env", severity: "high",
      difficulty: "quick-win", estimatedMinutes: 5, impactScore: 2,
      pass: scan.gitignoreEnvPasses,
      label: ".gitignore guards",
      brief: scan.gitignoreEnvNotApplicable
        ? "n/a — project does not use .env files"
        : scan.gitignoreCoversEnv
          ? ".env* covered"
          : scan.gitignoreExists ? ".gitignore missing .env*" : ".gitignore not found",
      action: "Add `.env*` to .gitignore to prevent future accidental commits." },
    { dim: "safety", subdim: "secrets-exposure", id: "secret-scan-ci", severity: "medium",
      difficulty: "quick-win", estimatedMinutes: 20, impactScore: 2,
      pass: scan.hasSecretScanConfig,
      label: "Automated secret scan",
      brief: scan.hasSecretScanConfig ? "secret scan config found" : "no gitleaks / trufflehog config",
      action: "Add .gitleaks.toml or trufflehog CI step to block future secret commits." },
    { dim: "safety", subdim: "access-permissions", id: "cloud-credential-files", severity: "critical",
      difficulty: "quick-win", estimatedMinutes: 5, impactScore: 1,
      pass: !hasCloudCredentialFiles,
      label: "Cloud credential files",
      brief: !hasCloudCredentialFiles ? "none committed" : "cloud credentials found in repo",
      action: "Remove .aws/credentials or .gcloud keys from the repo immediately." },
    { dim: "safety", subdim: "dependency-security", id: "dep-vuln-check", severity: "medium",
      difficulty: "quick-win", estimatedMinutes: 15, impactScore: 2,
      pass: hasDependencyVulnCheck,
      label: "Dep vulnerability scan",
      brief: hasDependencyVulnCheck ? "vuln scan tooling found" : "no dep vulnerability check",
      action: "Add `npm audit` or Snyk to your CI pipeline or package.json scripts." },
    { dim: "safety", subdim: "access-permissions", id: "security-policy", severity: "medium",
      difficulty: "quick-win", estimatedMinutes: 30, impactScore: 1,
      pass: securityPolicyExists,
      label: "Security policy",
      brief: securityPolicyExists ? "SECURITY.md found" : "SECURITY.md missing",
      action: "Create SECURITY.md describing your vulnerability disclosure process." },

    // ── RELIABILITY — Testing & Coverage ────────────────────────────────────
    { dim: "reliability", subdim: "testing-coverage", id: "test-signal", severity: "critical",
      difficulty: "medium", estimatedMinutes: 90, impactScore: 5,
      pass: testSignal.testSignal,
      label: "Test signal",
      brief: testSignal.testSignal
        ? (testSignal.hasTestsFolder ? "tests/ detected" : "test files detected")
        : "no tests found",
      action: "Create a tests/ directory with at least one test file and a test script." },
    { dim: "reliability", subdim: "testing-coverage", id: "test-coverage-config", severity: "medium",
      difficulty: "quick-win", estimatedMinutes: 20, impactScore: 2,
      pass: hasTestCoverage,
      label: "Coverage config",
      brief: hasTestCoverage ? "coverage tooling found" : "no coverage thresholds set",
      action: "Add c8 (Node) or pytest-cov (Python) and define a minimum coverage threshold." },
    { dim: "reliability", subdim: "testing-coverage", id: "integration-tests", severity: "medium",
      difficulty: "medium", estimatedMinutes: 120, impactScore: 2,
      pass: hasIntegrationTests || hasE2eTests,
      label: "Integration / E2E tests",
      brief: (hasIntegrationTests || hasE2eTests) ? "integration or E2E tests found" : "no integration/E2E tests",
      action: "Create tests/integration/ with end-to-end workflow tests for critical paths." },
    { dim: "reliability", subdim: "cicd-stability", id: "cicd-pipeline", severity: "high",
      difficulty: "medium", estimatedMinutes: 60, impactScore: 4,
      pass: cicdExists,
      label: "CI/CD pipeline",
      brief: cicdExists ? "workflow file found" : "no workflow file detected",
      action: "Create .github/workflows/ci.yml running tests on every push." },
    { dim: "reliability", subdim: "cicd-stability", id: "health-check", severity: "low",
      difficulty: "quick-win", estimatedMinutes: 15, impactScore: 1,
      pass: hasHealthCheck,
      label: "Health check",
      brief: hasHealthCheck ? "health check detected" : "no HEALTHCHECK or /health endpoint",
      action: "Add HEALTHCHECK to Dockerfile or a /health endpoint verified in CI." },
    { dim: "reliability", subdim: "cicd-stability", id: "lock-file", severity: "medium",
      difficulty: "quick-win", estimatedMinutes: 5, impactScore: 2,
      pass: hasLockFile,
      label: "Dependency lock file",
      brief: hasLockFile ? "lock file found" : "no lock file (non-deterministic builds)",
      action: "Commit package-lock.json, poetry.lock, or equivalent to the repo." },
    { dim: "reliability", subdim: "cicd-stability", id: "lint-config", severity: "low",
      difficulty: "quick-win", estimatedMinutes: 15, impactScore: 1,
      pass: hasLintConfig,
      label: "Lint / static analysis",
      brief: hasLintConfig ? "linting configured" : "no linting detected",
      action: "Add ESLint, Ruff, or equivalent linter with a CI step." },
    { dim: "reliability", subdim: "cicd-stability", id: "pre-commit-hooks", severity: "low",
      difficulty: "quick-win", estimatedMinutes: 20, impactScore: 1,
      pass: hasPreCommitHooks,
      label: "Pre-commit hooks",
      brief: hasPreCommitHooks ? "pre-commit hooks found" : "no local quality gates",
      action: "Add .pre-commit-config.yaml or Husky to enforce checks before every commit." },
    { dim: "reliability", subdim: "type-safety", id: "type-safety", severity: "medium",
      difficulty: "deep-refactor", estimatedMinutes: 240, impactScore: 3,
      pass: hasTypeSafety,
      label: "Type safety",
      brief: hasTypeSafety ? "TypeScript / typecheck found" : "no type checking configured",
      action: "Add tsconfig.json (Node) or mypy/pyright (Python) and enable strict mode." },

    // ── EVALUATION — Corpus Depth ────────────────────────────────────────────
    { dim: "evaluation", subdim: "eval-corpus", id: "eval-corpus", severity: "high",
      difficulty: "medium", estimatedMinutes: 120, impactScore: 5,
      pass: evalCorpusExists,
      label: "Eval corpus",
      brief: evalCorpusExists
        ? `evals/ found (${evalCorpusFileCount} JSON file${evalCorpusFileCount !== 1 ? "s" : ""})`
        : "no evals/ directory found",
      action: "Create evals/ with at least 10 test cases mirroring real user workflows." },
    { dim: "evaluation", subdim: "eval-corpus", id: "adversarial-tests", severity: "high",
      difficulty: "medium", estimatedMinutes: 90, impactScore: 2,
      pass: hasAdversarialTests,
      label: "Adversarial tests",
      brief: hasAdversarialTests ? "adversarial test cases found" : "no adversarial/injection tests",
      action: "Add prompt injection, jailbreak, and adversarial test cases to evals/adversarial/." },
    { dim: "evaluation", subdim: "eval-corpus", id: "golden-datasets", severity: "medium",
      difficulty: "medium", estimatedMinutes: 60, impactScore: 2,
      pass: hasGoldenDatasets,
      label: "Golden datasets",
      brief: hasGoldenDatasets ? "golden test data found" : "no golden/fixture datasets",
      action: "Create fixtures/ or a golden.json with expected outputs for regression testing." },
    { dim: "evaluation", subdim: "baseline-hygiene", id: "baseline-tracking", severity: "medium",
      difficulty: "quick-win", estimatedMinutes: 20, impactScore: 2,
      pass: hasBaseline,
      label: "Baseline tracking",
      brief: hasBaseline ? "baseline.json found" : "no baseline.json",
      action: "Run `node scripts/new-run.mjs` and commit the output as baseline.json." },
    { dim: "evaluation", subdim: "baseline-hygiene", id: "eval-script", severity: "low",
      difficulty: "quick-win", estimatedMinutes: 15, impactScore: 1,
      pass: hasEvalScript,
      label: "Eval script",
      brief: hasEvalScript
        ? (scan.isPython ? "pytest / eval script found" : "eval script in package.json")
        : (scan.isPython ? "no pytest / eval script" : "no eval script found"),
      action: "Add an `eval` script to package.json: `\"eval\": \"node scripts/new-run.mjs\"`." },

    // ── OBSERVABILITY — Tracing & Logging ───────────────────────────────────
    { dim: "observability", subdim: "tracing-instrumentation", id: "otel-tracing", severity: "high",
      difficulty: "deep-refactor", estimatedMinutes: 300, impactScore: 3,
      pass: hasOtelDependency,
      label: "OTEL / tracing",
      brief: hasOtelDependency ? "tracing dependency found" : "no @opentelemetry dependency",
      action: "Install @opentelemetry/sdk-node and instrument your key request handlers." },
    { dim: "observability", subdim: "logging-diagnostics", id: "structured-logging", severity: "medium",
      difficulty: "medium", estimatedMinutes: 60, impactScore: 2,
      pass: hasStructuredLogging,
      label: "Structured logging",
      brief: hasStructuredLogging ? "logging library found" : "no structured logging library",
      action: "Add pino (Node) or structlog (Python) and emit JSON-formatted logs." },
    { dim: "observability", subdim: "logging-diagnostics", id: "run-artifacts", severity: "low",
      difficulty: "quick-win", estimatedMinutes: 20, impactScore: 2,
      pass: hasRunArtifacts,
      label: "Run artifacts",
      brief: hasRunArtifacts ? "run JSON found" : "no run artifacts found",
      action: "Persist agent run outputs to agent-quality/runs/ after each execution." },
    { dim: "observability", subdim: "metrics-alerting", id: "monitoring-config", severity: "medium",
      difficulty: "medium", estimatedMinutes: 90, impactScore: 2,
      pass: hasMonitoringConfig,
      label: "Monitoring config",
      brief: hasMonitoringConfig ? "monitoring config found" : "no monitoring / alerting config",
      action: "Add Datadog, Prometheus, or Sentry config to capture production errors." },
    { dim: "observability", subdim: "metrics-alerting", id: "slo-definition", severity: "low",
      difficulty: "medium", estimatedMinutes: 60, impactScore: 1,
      pass: hasSloDefinition,
      label: "SLO definition",
      brief: hasSloDefinition ? "SLO document found" : "no SLO / reliability targets defined",
      action: "Create SLO.md defining availability, latency, and error rate targets." },

    // ── GOVERNANCE — Documentation ───────────────────────────────────────────
    { dim: "governance", subdim: "documentation", id: "readme", severity: "medium",
      difficulty: "quick-win", estimatedMinutes: 30, impactScore: 2,
      pass: readmeExists,
      label: "README",
      brief: readmeExists ? "README.md found" : "README.md missing",
      action: "Create README.md with setup, usage, and architecture overview sections." },
    { dim: "governance", subdim: "documentation", id: "changelog", severity: "medium",
      difficulty: "quick-win", estimatedMinutes: 15, impactScore: 2,
      pass: hasChangelog,
      label: "Changelog",
      brief: hasChangelog ? "CHANGELOG.md found" : "CHANGELOG.md missing",
      action: "Create CHANGELOG.md and add an [Unreleased] section for current changes." },
    { dim: "governance", subdim: "documentation", id: "api-documentation", severity: "low",
      difficulty: "medium", estimatedMinutes: 120, impactScore: 1,
      pass: hasApiDocs,
      label: "API documentation",
      brief: hasApiDocs ? "OpenAPI / Swagger docs found" : "no API docs",
      action: "Add openapi.yaml or use swagger-jsdoc to document your API contract." },
    { dim: "governance", subdim: "process-ownership", id: "license", severity: "low",
      difficulty: "quick-win", estimatedMinutes: 5, impactScore: 1,
      pass: licenseExists,
      label: "License",
      brief: licenseExists ? "LICENSE found" : "no LICENSE file",
      action: "Add a LICENSE file (MIT, Apache-2.0, etc.) to establish usage rights." },
    { dim: "governance", subdim: "process-ownership", id: "version-pinned", severity: "low",
      difficulty: "quick-win", estimatedMinutes: 5, impactScore: 1,
      pass: hasVersion,
      label: "Version field",
      brief: hasVersion ? "package.json versioned" : "no version in package.json",
      action: "Add a `version` field to package.json and tag releases in git." },
    { dim: "governance", subdim: "process-ownership", id: "codeowners", severity: "low",
      difficulty: "quick-win", estimatedMinutes: 10, impactScore: 1,
      pass: hasCodeOwners,
      label: "Code ownership",
      brief: hasCodeOwners ? "CODEOWNERS found" : "no CODEOWNERS file",
      action: "Create .github/CODEOWNERS to define who reviews what." },
    { dim: "governance", subdim: "process-ownership", id: "dependency-updates", severity: "low",
      difficulty: "quick-win", estimatedMinutes: 10, impactScore: 1,
      pass: hasDependencyUpdateConfig,
      label: "Dep update automation",
      brief: hasDependencyUpdateConfig ? "Dependabot / Renovate found" : "no automated dep updates",
      action: "Add .github/dependabot.yml to automate security patch PRs." },
    { dim: "governance", subdim: "process-ownership", id: "commit-conventions", severity: "low",
      difficulty: "quick-win", estimatedMinutes: 15, impactScore: 1,
      pass: hasCommitLintConfig,
      label: "Commit conventions",
      brief: hasCommitLintConfig ? "commitlint config found" : "no commit convention enforced",
      action: "Add commitlint.config.js with conventional commits to make history readable." },

    // ── AGENTIC — Agent Governance ───────────────────────────────────────────
    { dim: "agentic", subdim: "agent-governance", id: "agent-instructions", severity: "medium",
      difficulty: "quick-win", estimatedMinutes: 30, impactScore: 3,
      pass: hasAiDocs,
      label: "Agent instructions",
      brief: hasAiDocs ? "agent rules detected" : "no agent instruction files",
      action: "Create .github/copilot-instructions.md or AGENTS.md with operating rules." },
    { dim: "agentic", subdim: "agent-governance", id: "safety-rules", severity: "high",
      difficulty: "quick-win", estimatedMinutes: 20, impactScore: 2,
      pass: hasSafetyRulesInInstructions,
      label: "Safety guardrails",
      brief: hasSafetyRulesInInstructions ? "safety rules detected" : "no explicit safety rules in instructions",
      action: "Add at least 3 `never do X` rules to your agent instructions file." },
    { dim: "agentic", subdim: "agent-governance", id: "model-pinned", severity: "low",
      difficulty: "quick-win", estimatedMinutes: 10, impactScore: 1,
      pass: hasModelPinned,
      label: "Model version pinned",
      brief: hasModelPinned ? "model version found in config" : "no model version pinned",
      action: "Specify the exact model (e.g. claude-sonnet-4 or gpt-4o) in your instructions." },
    { dim: "agentic", subdim: "prompt-engineering", id: "agent-skill-catalog", severity: "low",
      difficulty: "medium", estimatedMinutes: 60, impactScore: 2,
      pass: hasAgentSkillCatalog || hasPromptAssets,
      label: "Skills / prompts",
      brief: (hasAgentSkillCatalog || hasPromptAssets) ? "skill or prompt assets found" : "no reusable skills/prompts",
      action: "Create .github/prompts/ or skills/ with reusable prompt templates." },
    { dim: "agentic", subdim: "prompt-engineering", id: "prompt-versioning", severity: "low",
      difficulty: "quick-win", estimatedMinutes: 10, impactScore: 1,
      pass: hasPromptVersioning,
      label: "Prompt versioning",
      brief: hasPromptVersioning ? "prompts tracked in git" : "prompt assets not git-tracked",
      action: "Ensure prompts/ or skills/ files are committed to git for version history." },
    { dim: "agentic", subdim: "prompt-engineering", id: "tool-whitelist", severity: "medium",
      difficulty: "quick-win", estimatedMinutes: 20, impactScore: 1,
      pass: hasToolWhitelist,
      label: "Tool whitelist",
      brief: hasToolWhitelist ? "tool permissions defined" : "no tool/function allowlist",
      action: "List allowed tools and capabilities in your agent instructions file." },
  ];
}

// ─── Checks section ───────────────────────────────────────────────────────────
// Critical + high severity checks shown in the header summary.
const HEADER_CHECK_IDS = [
  "secret-exposure",      "gitignore-env",
  "cloud-credential-files","dep-vuln-check",
  "test-signal",          "cicd-pipeline",
  "type-safety",          "eval-corpus",
  "adversarial-tests",    "otel-tracing",
  "changelog",            "readme",
  "agent-instructions",   "safety-rules",
];

// ─── Recommendations section ─────────────────────────────────────────────────
const DIFFICULTY_LABEL = {
  "quick-win":     "QUICK WIN",
  "medium":        "MEDIUM",
  "deep-refactor": "DEEP REFACTOR",
  "architectural": "ARCHITECTURAL",
};
const DIFFICULTY_COLOR = {
  "quick-win":     (c) => c.bgreen,
  "medium":        (c) => c.byellow,
  "deep-refactor": (c) => c.bmagenta,
  "architectural": (c) => c.bred,
};

function printRecommendations(catalog) {
  const failing = catalog
    .filter((ch) => !ch.pass)
    .sort((a, b) => {
      // Sort by: severity weight DESC, then impactScore DESC, then estimatedMinutes ASC
      const sevWeight = { critical: 4, high: 3, medium: 2, low: 1 };
      const sevDiff = (sevWeight[b.severity] ?? 0) - (sevWeight[a.severity] ?? 0);
      if (sevDiff !== 0) return sevDiff;
      const impDiff = (b.impactScore ?? 0) - (a.impactScore ?? 0);
      if (impDiff !== 0) return impDiff;
      return (a.estimatedMinutes ?? 999) - (b.estimatedMinutes ?? 999);
    })
    .slice(0, 5);

  if (failing.length === 0) return;

  console.log();
  console.log(hr());
  console.log();
  console.log(`  ${c.bold}${c.white}Next Steps${c.reset}  ${c.dim}Top ${failing.length} recommendations ordered by ROI${c.reset}`);
  console.log();

  for (let i = 0; i < failing.length; i++) {
    const ch = failing[i];
    const diffColor = (DIFFICULTY_COLOR[ch.difficulty] ?? ((x) => x.gray))(c);
    const diffLabel = DIFFICULTY_LABEL[ch.difficulty] ?? ch.difficulty;
    const timeStr   = ch.estimatedMinutes >= 60
      ? `${Math.round(ch.estimatedMinutes / 60)}h`
      : `${ch.estimatedMinutes}min`;
    const impStr    = `+${ch.impactScore ?? "?"}pts`;
    const dimMeta   = DIM_META[ch.dim] ?? { icon: "?", label: ch.dim };
    const subdimStr = ch.subdim ? `${c.dim}${ch.subdim}${c.reset}` : "";

    console.log(
      `  ${c.bold}${c.white}${i + 1}${c.reset}  ` +
      `${diffColor}[${diffLabel}]${c.reset}  ` +
      `${c.byellow}${timeStr}${c.reset}  ` +
      `${c.bgreen}${impStr}${c.reset}  ` +
      `${dimMeta.icon} ${c.dim}${ch.dim}${ch.subdim ? "/" + ch.subdim : ""}${c.reset}`
    );
    console.log(
      `     ${c.bold}${c.white}${ch.label}${c.reset}  ` +
      `${sevColor(ch.severity)}[${ch.severity}]${c.reset}`
    );
    if (ch.action) {
      console.log(`     ${c.dim}→  ${c.reset}${c.gray}${ch.action}${c.reset}`);
    }
    if (i < failing.length - 1) console.log();
  }

  const quickWinCount = failing.filter((ch) => ch.difficulty === "quick-win").length;
  const totalMins     = failing
    .filter((ch) => ch.difficulty === "quick-win")
    .reduce((s, ch) => s + (ch.estimatedMinutes ?? 0), 0);

  if (quickWinCount > 0) {
    console.log();
    console.log(
      `  ${c.dim}${quickWinCount} quick win${quickWinCount !== 1 ? "s" : ""} above — ` +
      `estimated ${totalMins < 60 ? totalMins + " min" : Math.ceil(totalMins / 60) + "h"} total${c.reset}`
    );
  }
}

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
    `${c.dim}Codebase Quality Engine${c.reset}` +
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
  console.log(`  ${c.bold}${c.white}Scores${c.reset}  ${c.dim}Six dimensions of codebase quality${c.reset}`);
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

  // ── Dashboard CTA — remediation detail lives server-side ———————————————————————
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