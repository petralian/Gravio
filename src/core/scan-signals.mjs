/**
 * scan-signals.mjs
 * Gravio Scanner — filesystem signal detection ONLY.
 *
 * This module is bundled into the distributed CLI (src/web/cli/gravio.mjs).
 * It MUST NOT import or reference any evaluation logic (corpus, weights,
 * scoring formulas, workflow definitions). Those live server-side only in
 * scanner.mjs so they are never shipped to end-users.
 *
 * Constraint: never read .env file contents. Only detect file presence/tracking.
 */
import { execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  ".cache",
]);

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function isEnvFileName(fileName) {
  return fileName === ".env" || fileName.startsWith(".env.");
}

function safeReadJson(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Read text content of a file safely (returns "" on error).
 * Used only for known config files — never for .env files.
 */
function safeReadText(filePath) {
  try { return readFileSync(filePath, "utf8"); } catch { return ""; }
}

function listFilesRecursive(rootDir, currentDir = rootDir, out = []) {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(currentDir, entry.name);
    const rel = toPosix(path.relative(rootDir, abs));

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      listFilesRecursive(rootDir, abs, out);
      continue;
    }

    if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function gitTrackedFiles(targetDir) {
  try {
    const out = execSync("git ls-files", {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!out) return [];
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split("/").join("/"));
  } catch {
    return [];
  }
}

/**
 * Collect all dependency identifiers from any package manifest in the project.
 * Supports: package.json, requirements*.txt, pyproject.toml, go.mod, Cargo.toml,
 * Gemfile, pom.xml, build.gradle, composer.json.
 * Returns a single lowercase string — cheap substring check for any dep name.
 */
function collectAllDepsText(targetDir, allFiles) {
  const chunks = [];

  // Node
  const pkgJson = safeReadJson(path.join(targetDir, "package.json"), null);
  if (pkgJson) {
    chunks.push(
      ...Object.keys(pkgJson?.dependencies ?? {}),
      ...Object.keys(pkgJson?.devDependencies ?? {}),
    );
  }

  // Python requirements files
  for (const f of allFiles) {
    if (/^requirements[^/]*\.txt$/i.test(f)) {
      chunks.push(safeReadText(path.join(targetDir, f)));
    }
  }

  // Other manifests
  for (const name of ["pyproject.toml", "Pipfile", "Cargo.toml", "go.mod", "Gemfile", "composer.json", "pom.xml", "build.gradle", "build.gradle.kts"]) {
    if (allFiles.includes(name)) {
      chunks.push(safeReadText(path.join(targetDir, name)));
    }
  }

  return chunks.join("\n").toLowerCase();
}

/**
 * Scan a target project directory and return raw signal booleans.
 * These signals are then sent to the Gravio server for scoring.
 * No evaluation logic (weights, formulas, corpus) lives here.
 */
export function scanTargetProject(targetDir) {
  const resolvedTarget = path.resolve(targetDir);
  const allFiles = listFilesRecursive(resolvedTarget).sort();
  const trackedFiles = gitTrackedFiles(resolvedTarget);
  const depsText = collectAllDepsText(resolvedTarget, allFiles);

  const has = (rel) => allFiles.includes(rel);
  const hasMatch = (fn) => allFiles.some(fn);
  const hasGlob = (prefix) => allFiles.some((f) => f.startsWith(prefix));

  // ━━━ ECOSYSTEM DETECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const isPython = hasMatch((f) => /\.py$/.test(f)) ||
    has("pyproject.toml") || has("setup.py") || has("setup.cfg") || has("Pipfile");

  const isNode = has("package.json");
  const isGo = has("go.mod");
  const isRust = has("Cargo.toml");
  const isJava = hasMatch((f) => /\.(java|kt|scala)$/.test(f)) ||
    has("pom.xml") || hasMatch((f) => /build\.gradle(\.kts)?$/.test(f));
  const isDotnet = hasMatch((f) => /\.(cs|fs|vb)$/.test(f)) ||
    hasMatch((f) => /\.(csproj|sln|fsproj)$/.test(f));
  const isRuby = has("Gemfile");

  const usesDotenv =
    depsText.includes("dotenv") ||
    depsText.includes("python-dotenv") ||
    depsText.includes("django-environ") ||
    depsText.includes("decouple") ||
    has(".env.example") || has(".env.sample") || has(".env.template") ||
    allFiles.some((f) => isEnvFileName(path.basename(f)));

  const hasRetryLibrary =
    depsText.includes("p-retry") || depsText.includes("retry") || depsText.includes("axios-retry") ||
    depsText.includes("cockatiel") || depsText.includes("backoff") ||
    depsText.includes("tenacity") || depsText.includes("backoff") ||
    depsText.includes("stamina") || depsText.includes("retry") ||
    depsText.includes("resilience4j") || depsText.includes("spring-retry") ||
    (() => {
      if (!isPython) return false;
      return hasMatch((f) => f.endsWith(".py") && (
        f.includes("retry") || f.includes("backoff") || f.includes("resilience")
      ));
    })();

  const packageJson = safeReadJson(path.join(resolvedTarget, "package.json"), null);
  const hasNodeEvalScript = Object.keys(packageJson?.scripts ?? {}).some(
    (s) => s === "eval" || s === "evals" || s === "bench" || s === "benchmark" || s.includes("eval")
  );
  const hasPythonEvalScript =
    depsText.includes("pytest") || depsText.includes("tox") ||
    hasMatch((f) => /make(file)?$/i.test(f)) ||
    hasMatch((f) => f.endsWith(".py") && (f.includes("eval") || f.includes("bench")));
  const hasEvalScript = hasNodeEvalScript || (isPython && hasPythonEvalScript);

  // ━━━ SAFETY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const envFiles = allFiles.filter((f) => isEnvFileName(path.basename(f)));
  const committedEnvFiles = trackedFiles.filter((f) => isEnvFileName(path.basename(f)));

  const gitignoreExists = existsSync(path.join(resolvedTarget, ".gitignore"));
  let gitignoreCoversEnv = false;
  if (gitignoreExists) {
    const gi = safeReadText(path.join(resolvedTarget, ".gitignore"));
    gitignoreCoversEnv = /^\s*\.env/m.test(gi) || /^\s*\*\.env/m.test(gi);
  }
  const gitignoreEnvNotApplicable = !usesDotenv;
  const gitignoreEnvPasses = gitignoreCoversEnv || gitignoreEnvNotApplicable;

  const hasAltSecretManagement =
    depsText.includes("environs") || depsText.includes("pydantic-settings") ||
    depsText.includes("dynaconf") || depsText.includes("konfig") ||
    depsText.includes("boto3") ||
    depsText.includes("google-cloud-secret-manager") ||
    depsText.includes("azure-keyvault") ||
    has("secrets.yaml") || has(".sops.yaml") || has(".sops.yml");

  const securityPolicyExists = hasMatch((f) => /^SECURITY\.md$/i.test(f));

  const hasSecretScanConfig =
    has(".gitleaks.toml") || has(".secretlintrc") || has(".secretlintrc.json") ||
    has(".secretlintrc.yaml") || has(".trufflehog.yml") ||
    has(".github/secret_scanning.yml") ||
    hasMatch((f) => f.startsWith(".github/") && f.includes("secret-scan"));

  const hasDependencyUpdateConfig =
    has(".github/dependabot.yml") || has(".github/dependabot.yaml") ||
    has("renovate.json") || has(".renovaterc") || has(".renovaterc.json") || has("renovate.json5");

  const hasAgentInstructions =
    has("AGENTS.md") || has(".github/copilot-instructions.md") || has(".cursorrules") ||
    has(".cursor/rules") || has("system_prompt.md") || has("SYSTEM_PROMPT.md") ||
    has(".continue/config.json") || has(".aider.conf.yml") || has(".claude/NOTES.md");

  const hasAgentSkillCatalog =
    hasGlob(".github/skills/") || hasGlob("skills/") || hasGlob(".cursor/rules/") || has("SKILL.md");

  const hasPromptAssets =
    hasGlob(".github/prompts/") || hasGlob("prompts/") || has("STARTUP_PROMPT.md") || has("SYSTEM_PROMPT.md");

  const hasAgentOrchestration =
    hasGlob(".github/agents/") || has("AGENTS.md") || has(".continue/config.json") || has(".aider.conf.yml");

  // ━━━ RELIABILITY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const hasTestFiles =
    hasGlob("tests/") || hasGlob("test/") || hasGlob("spec/") ||
    hasGlob("__tests__/") || hasGlob("testdata/") ||
    hasMatch((f) => /\.(test|spec)\.[^/]+$/.test(f)) ||
    hasMatch((f) => /_test\.(go|rs|py|rb|java|cs)$/.test(f)) ||
    hasMatch((f) => /Test\.(java|kt|cs)$/.test(f)) ||
    hasMatch((f) => /_spec\.rb$/.test(f));

  const hasTestScript = Boolean(packageJson?.scripts?.test);
  const testSignal = {
    testSignal: hasTestFiles || hasTestScript,
    hasTestFiles,
    hasTestScript,
    hasTypecheck: Boolean(packageJson?.scripts?.typecheck || packageJson?.scripts?.["type-check"]),
    hasBuild: Boolean(packageJson?.scripts?.build),
  };

  const cicdExists =
    hasMatch((f) => f.startsWith(".github/workflows/") && /\.(ya?ml)$/.test(f)) ||
    has(".circleci/config.yml") || has(".circleci/config.yaml") ||
    has(".travis.yml") || has("Jenkinsfile") ||
    has(".gitlab-ci.yml") || has(".gitlab-ci.yaml") ||
    hasGlob(".buildkite/") || has("azure-pipelines.yml");

  const hasTypeSafety =
    has("tsconfig.json") || has("jsconfig.json") ||
    Boolean(packageJson?.scripts?.typecheck) ||
    Boolean(packageJson?.scripts?.["type-check"]) ||
    depsText.includes("typescript") ||
    has("mypy.ini") || has("pyrightconfig.json") || has(".mypy.ini") ||
    hasMatch((f) => f.endsWith(".pyi")) ||
    depsText.includes("mypy") || depsText.includes("pyright") ||
    has("Cargo.toml") || has("go.mod") ||
    hasMatch((f) => /\.(java|kt|scala|cs|fs)$/.test(f)) ||
    hasMatch((f) => /pom\.xml$|build\.gradle(\.kts)?$|.*\.csproj$|.*\.sln$/.test(f)) ||
    hasGlob("sorbet/") || hasMatch((f) => f.endsWith(".rbi"));

  const hasLockFile =
    has("package-lock.json") || has("yarn.lock") || has("pnpm-lock.yaml") ||
    has("requirements.txt") || has("Pipfile.lock") || has("poetry.lock") || has("uv.lock") ||
    has("go.sum") || has("Cargo.lock") || has("composer.lock") || has("Gemfile.lock") || has("pubspec.lock");

  const hasLintConfig =
    hasMatch((f) => /^\.eslintrc(\.(js|json|yaml|yml|cjs))?$/.test(f)) ||
    hasMatch((f) => /^eslint\.config\.(js|mjs|cjs|ts)$/.test(f)) ||
    has(".pylintrc") || has(".flake8") || has("ruff.toml") || has(".ruff.toml") ||
    has(".golangci.yml") || has(".golangci.yaml") ||
    has("clippy.toml") || has(".clippy.toml") || has(".rubocop.yml") ||
    hasMatch((f) => /checkstyle\.xml$/.test(f)) ||
    depsText.includes("eslint") || depsText.includes("ruff") || depsText.includes("pylint");

  const hasPreCommitHooks =
    has(".pre-commit-config.yaml") || has(".pre-commit-config.yml") ||
    hasGlob(".husky/") || has("lefthook.yml") || has(".lefthook.yml") || hasGlob(".githooks/");

  // ━━━ EVALUATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const EVAL_DIRS = ["evals/", "eval/", "agent-quality/evals/", "benchmarks/", "benchmark/", "evaluations/"];
  const hasEvalDir = EVAL_DIRS.some((d) => hasGlob(d));
  const evalCorpusFileCount = allFiles.filter(
    (f) => EVAL_DIRS.some((d) => f.startsWith(d)) && f.endsWith(".json")
  ).length;

  const hasEvalConfig =
    has("promptfoo.yaml") || has("promptfooconfig.yaml") ||
    hasMatch((f) => /^promptfoo\.config\.[^/]+$/.test(f)) ||
    depsText.includes("promptfoo") || depsText.includes("langsmith") ||
    depsText.includes("langfuse") || depsText.includes("ragas") ||
    depsText.includes("deepeval") || depsText.includes("phoenix") ||
    depsText.includes("braintrust") || depsText.includes("evals");

  const hasBaseline =
    hasMatch((f) => f.includes("baseline.json") || f.includes("/baseline/")) ||
    hasMatch((f) => /baseline\.[^/]+$/.test(f));

  const hasGoldenDatasets =
    hasMatch((f) => f.includes(".golden.") || f.includes("/golden/")) ||
    hasGlob("fixtures/") || hasGlob("fixture/") ||
    hasGlob("test-data/") || hasGlob("testdata/") || hasGlob("test_data/");

  // ━━━ OBSERVABILITY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const hasOtelDependency =
    depsText.includes("opentelemetry") ||
    depsText.includes("@opentelemetry/") ||
    depsText.includes("go.opentelemetry.io") ||
    has("otel-collector-config.yaml") || has("otel-collector-config.yml") ||
    hasMatch((f) => f.includes("opentelemetry"));

  const hasStructuredLogging =
    depsText.includes("winston") || depsText.includes("pino") || depsText.includes("bunyan") ||
    depsText.includes("morgan") || depsText.includes("loglevel") || depsText.includes("tslog") ||
    depsText.includes("structlog") || depsText.includes("loguru") ||
    depsText.includes("python-json-logger") ||
    depsText.includes("go.uber.org/zap") || depsText.includes("github.com/rs/zerolog") ||
    depsText.includes("github.com/sirupsen/logrus") ||
    depsText.includes("logback") || depsText.includes("log4j") || depsText.includes("slf4j") ||
    depsText.includes("tracing") || depsText.includes("env_logger") ||
    has("logging.yaml") || has("logging.yml") || has("logging.ini") ||
    has("log_config.py") || has("logback.xml") ||
    hasMatch((f) => /log4j[^/]*\.xml$/.test(f));

  const hasMonitoringConfig =
    has(".datadog.yml") || has("datadog.yaml") ||
    has("prometheus.yml") || has("prometheus.yaml") ||
    hasMatch((f) => f.includes("grafana") && f.endsWith(".json")) ||
    depsText.includes("dd-trace") || depsText.includes("datadog") ||
    depsText.includes("newrelic") || depsText.includes("sentry") ||
    depsText.includes("honeycomb") || depsText.includes("@honeycombio/");

  const hasRunArtifacts =
    hasMatch((f) => f.includes("/runs/") && f.endsWith(".json")) ||
    hasMatch((f) => f.includes("/traces/") && f.endsWith(".json")) ||
    has("agent-quality/runs/latest.json");

  // ━━━ GOVERNANCE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  const readmeExists = hasMatch((f) => /^readme\.md$/i.test(f));
  const licenseExists = hasMatch((f) => /^license(\.md|\.txt)?$/i.test(f));
  const hasChangelog = hasMatch((f) => /^changelog(\.md|\.txt)?$/i.test(f)) || has("HISTORY.md");

  const hasVersion =
    Boolean(packageJson?.version) ||
    (has("Cargo.toml") && /^\s*version\s*=/m.test(safeReadText(path.join(resolvedTarget, "Cargo.toml")))) ||
    (has("pyproject.toml") && /version\s*=/i.test(safeReadText(path.join(resolvedTarget, "pyproject.toml")))) ||
    (has("go.mod") && safeReadText(path.join(resolvedTarget, "go.mod")).trim().length > 0) ||
    hasMatch((f) => /setup\.py$/.test(f));

  const hasContributing = hasMatch((f) => /^contributing\.md$/i.test(f));

  const hasAiDocs =
    has("AGENTS.md") || has(".github/copilot-instructions.md") || has(".cursorrules") ||
    has(".cursor/rules") || has("system_prompt.md") || has("SYSTEM_PROMPT.md") ||
    has(".continue/config.json") || has(".aider.conf.yml") ||
    has(".claude/NOTES.md") || has(".claude/NEXT_SESSION.md");

  const hasDecisionLog =
    has(".claude/NOTES.md") || has("NOTES.md") ||
    hasGlob("docs/adr/") || hasGlob("ADR/") ||
    has("DECISIONS.md") || has("ARCHITECTURE.md");

  const hasCodeOwners = has("CODEOWNERS") || has(".github/CODEOWNERS");
  const hasNotes = has(".claude/NOTES.md") || has("NOTES.md");
  const hasNextSession = has(".claude/NEXT_SESSION.md") || has("NEXT_SESSION.md");

  // ━━━ PHASE 1 EXPANSION — SUB-DIMENSION SIGNALS ━━━━━━━━━━━━━━━━━━━━━━━━━

  const hasCloudCredentialFiles =
    has(".aws/credentials") ||
    has(".gcloud/application_default_credentials.json") ||
    hasMatch((f) => /^\.azure\/.*\.(json|pem|p12)$/.test(f));

  const hasDependencyVulnCheck =
    depsText.includes("snyk") || depsText.includes("audit-ci") || depsText.includes("pip-audit") ||
    has(".snyk") ||
    Boolean(packageJson?.scripts?.audit) ||
    Boolean(packageJson?.scripts?.["security-check"]) ||
    Boolean(packageJson?.scripts?.security);

  const hasTestCoverage =
    depsText.includes("c8") || depsText.includes("nyc") || depsText.includes("istanbul") ||
    depsText.includes("pytest-cov") || depsText.includes("coverage") ||
    depsText.includes("jacoco") || depsText.includes("simplecov") || depsText.includes("lcov") ||
    has(".nycrc") || has(".nycrc.json") ||
    Boolean(packageJson?.jest?.collectCoverage) ||
    Boolean(packageJson?.c8) ||
    hasMatch((f) => /^jest\.config\.[^/]+$/.test(f));

  const hasIntegrationTests =
    hasGlob("tests/integration/") || hasGlob("test/integration/") ||
    hasGlob("integration-tests/") || hasGlob("integration/") ||
    hasMatch((f) => /integration[._-]test/i.test(f)) ||
    hasMatch((f) => /test[._-]integration/i.test(f));

  const hasE2eTests =
    depsText.includes("playwright") || depsText.includes("cypress") || depsText.includes("puppeteer") ||
    depsText.includes("selenium") || depsText.includes("webdriverio") ||
    hasGlob("e2e/") || hasGlob("playwright/") ||
    has("playwright.config.ts") || has("playwright.config.js") ||
    has("cypress.config.ts") || has("cypress.config.js") || has("cypress.json");

  const dockerfileText = (() => {
    const df = allFiles.find((f) => /^dockerfile(\..*)?$/i.test(f));
    return df ? safeReadText(path.join(resolvedTarget, df)) : "";
  })();

  const hasDockerfile =
    dockerfileText.length > 0 || has("docker-compose.yml") || has("docker-compose.yaml");

  const hasHealthCheck =
    dockerfileText.toLowerCase().includes("healthcheck") ||
    has("healthcheck.sh") || has("health-check.sh") ||
    hasMatch((f) => f === ".fly.toml" || f === "fly.toml") ||
    (() => {
      const workflowFiles = allFiles.filter(
        (f) => f.startsWith(".github/workflows/") && /\.ya?ml$/.test(f)
      );
      return workflowFiles.some((f) => {
        const txt = safeReadText(path.join(resolvedTarget, f)).toLowerCase();
        return txt.includes("/health") || txt.includes("healthcheck");
      });
    })();

  const hasFeatureFlags =
    depsText.includes("launchdarkly") || depsText.includes("unleash") || depsText.includes("flagsmith") ||
    depsText.includes("growthbook") || depsText.includes("flipt") || depsText.includes("openfeature") ||
    depsText.includes("@launchdarkly/") ||
    hasMatch((f) => f.includes("feature-flag") || f.includes("feature_flag"));

  const hasAdversarialTests = (() => {
    if (hasGlob("evals/adversarial") || hasGlob("adversarial/")) return true;
    if (hasMatch((f) => /adversarial|jailbreak|inject/i.test(f))) return true;
    const evalFiles = allFiles
      .filter((f) => EVAL_DIRS.some((d) => f.startsWith(d)) && f.endsWith(".json"))
      .slice(0, 10);
    for (const f of evalFiles) {
      const txt = safeReadText(path.join(resolvedTarget, f)).toLowerCase();
      if (txt.includes("adversarial") || txt.includes("jailbreak") || txt.includes("inject")) return true;
    }
    return false;
  })();

  const hasPromptTests =
    hasMatch((f) => f.includes("prompt") && /\.(test|spec)\.[^/]+$/.test(f)) ||
    hasMatch((f) => f.startsWith("evals/") && f.includes("prompt"));

  const hasSloDefinition =
    has("SLO.md") || has("slo.yaml") || has("slo.yml") ||
    hasMatch((f) => /^slo[._-]/i.test(path.basename(f)) && /\.(yaml|yml|json|md)$/.test(f)) ||
    hasMatch((f) => f.startsWith("docs/") && f.toLowerCase().includes("slo"));

  const hasAlertConfig =
    hasMatch((f) => /alertmanager/i.test(f)) ||
    depsText.includes("pagerduty") || depsText.includes("@pagerduty") || depsText.includes("opsgenie") ||
    hasMatch((f) => f.includes("alert") && /\.(yaml|yml|json)$/.test(f) && !f.includes("node_modules"));

  const hasApiDocs =
    has("openapi.yaml") || has("openapi.yml") || has("openapi.json") ||
    has("swagger.yaml") || has("swagger.yml") || has("swagger.json") ||
    hasGlob("docs/api/") ||
    depsText.includes("swagger-ui") || depsText.includes("swagger-jsdoc") ||
    hasMatch((f) => /openapi|swagger/i.test(f) && /\.(yaml|yml|json)$/.test(f));

  const hasAdrDir =
    hasGlob("docs/adr/") || hasGlob("ADR/") || hasGlob("adr/") ||
    hasMatch((f) => /\/adr\//i.test(f) || (f.startsWith("docs/") && /decision/i.test(f)));

  const hasCommitLintConfig =
    has(".commitlintrc") || has(".commitlintrc.json") || has(".commitlintrc.yaml") || has(".commitlintrc.yml") ||
    has("commitlint.config.js") || has("commitlint.config.ts") || has("commitlint.config.mjs") ||
    depsText.includes("@commitlint/");

  const hasSafetyRulesInInstructions = (() => {
    const CANDIDATE_FILES = [
      "AGENTS.md", ".github/copilot-instructions.md", ".cursorrules",
      "system_prompt.md", "SYSTEM_PROMPT.md", ".claude/NOTES.md",
    ];
    const SAFETY_KEYWORDS = [
      "never", "must not", "do not", "forbidden", "prohibited",
      "safety", "guardrail", "reject", "deny",
    ];
    for (const f of CANDIDATE_FILES) {
      if (!has(f)) continue;
      const txt = safeReadText(path.join(resolvedTarget, f)).toLowerCase();
      if (SAFETY_KEYWORDS.some((kw) => txt.includes(kw))) return true;
    }
    return false;
  })();

  const hasModelPinned = (() => {
    const CANDIDATE_FILES = [
      "AGENTS.md", ".github/copilot-instructions.md", ".cursorrules",
      "system_prompt.md", "SYSTEM_PROMPT.md", ".continue/config.json",
      ".aider.conf.yml", "promptfoo.yaml", "promptfooconfig.yaml",
    ];
    const MODEL_PATTERNS = [
      "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo", "claude-3", "claude-opus",
      "claude-sonnet", "claude-haiku", "gemini-1.5", "llama-3", "mistral-7b",
      "o1-preview", "o1-mini",
    ];
    for (const f of CANDIDATE_FILES) {
      if (!has(f)) continue;
      const txt = safeReadText(path.join(resolvedTarget, f)).toLowerCase();
      if (MODEL_PATTERNS.some((m) => txt.includes(m))) return true;
    }
    return false;
  })();

  const hasPromptVersioning =
    (hasPromptAssets || hasAgentSkillCatalog) &&
    trackedFiles.some((f) =>
      f.startsWith("prompts/") || f.startsWith(".github/prompts/") || f.startsWith("skills/")
    );

  const hasToolWhitelist = (() => {
    if (!hasAgentInstructions) return false;
    const CANDIDATE_FILES = [
      "AGENTS.md", ".github/copilot-instructions.md", ".cursorrules", "system_prompt.md",
    ];
    const TOOL_KEYWORDS = ["tool", "function call", "allowed", "permitted", "capabilities"];
    for (const f of CANDIDATE_FILES) {
      if (!has(f)) continue;
      const txt = safeReadText(path.join(resolvedTarget, f)).toLowerCase();
      if (TOOL_KEYWORDS.filter((kw) => txt.includes(kw)).length >= 2) return true;
    }
    return false;
  })();

  return {
    targetDir: resolvedTarget,
    scannedAt: new Date().toISOString(),
    totalFiles: allFiles.length,
    trackedFileCount: trackedFiles.length,
    // ecosystem
    isPython, isNode, isGo, isRust, isJava, isDotnet, isRuby,
    usesDotenv, hasAltSecretManagement,
    // safety
    envFiles, committedEnvFiles, gitignoreExists, gitignoreCoversEnv,
    gitignoreEnvNotApplicable, gitignoreEnvPasses,
    securityPolicyExists, hasSecretScanConfig, hasDependencyUpdateConfig, hasAgentInstructions,
    // reliability
    testSignal, cicdExists, hasTypeSafety, hasLockFile, hasLintConfig, hasPreCommitHooks,
    hasRetryLibrary,
    // evaluation
    hasEvalDir, evalCorpusFileCount, hasEvalConfig, hasBaseline, hasGoldenDatasets, hasEvalScript,
    // observability
    hasOtelDependency, hasStructuredLogging, hasMonitoringConfig, hasRunArtifacts,
    // governance
    readmeExists, licenseExists, hasChangelog, hasVersion,
    hasAiDocs, hasDecisionLog, hasContributing, hasCodeOwners,
    // agentic
    hasAgentSkillCatalog, hasPromptAssets, hasAgentOrchestration,
    // back-compat fields
    hasNotes, hasNextSession,
    evalCorpusExists: hasEvalDir,
    hasRetryDependency: hasRetryLibrary,
    // Phase 1 expansion signals
    hasCloudCredentialFiles, hasDependencyVulnCheck,
    hasTestCoverage, hasIntegrationTests, hasE2eTests,
    hasDockerfile, hasHealthCheck, hasFeatureFlags,
    hasAdversarialTests, hasPromptTests,
    hasSloDefinition, hasAlertConfig,
    hasApiDocs, hasAdrDir, hasCommitLintConfig,
    hasSafetyRulesInInstructions, hasModelPinned, hasPromptVersioning, hasToolWhitelist,
  };
}
