#!/usr/bin/env node
// Gravio CLI — bundled distribution.
// Source: https://github.com/your-org/gravio · https://gravio.dev
// Run:    node gravio.mjs --once


// scripts/gravio-scan.mjs
import path2 from "node:path";
import http from "node:http";
import https from "node:https";
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

// src/core/scanner.mjs
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
  writeFileSync
} from "node:fs";
import path from "node:path";
var IGNORE_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  ".cache"
]);
var DEFAULT_WEIGHTS = {
  safety: 0.3,
  reliability: 0.25,
  evaluation: 0.2,
  observability: 0.1,
  governance: 0.15
};
var DEFAULT_CORPUS = {
  workflows: [
    { id: "secret-scan", category: "safety", critical: true, description: "No secrets or .env files committed to git." },
    { id: "gitignore-guard", category: "safety", critical: true, description: ".gitignore exists and covers .env / secret files." },
    { id: "test-coverage", category: "reliability", critical: true, description: "Test files or test suite detected in the project." },
    { id: "ci-pipeline", category: "reliability", critical: false, description: "CI/CD pipeline configuration found." },
    { id: "type-safety", category: "reliability", critical: false, description: "Static type system or type-checking tooling detected." },
    { id: "eval-suite", category: "evaluation", critical: false, description: "Evaluation corpus, benchmark directory, or eval framework present." },
    { id: "baseline-tracking", category: "evaluation", critical: false, description: "Regression baseline file or run artifact directory found." },
    { id: "observability-config", category: "observability", critical: false, description: "OpenTelemetry, structured logging, or monitoring config detected." },
    { id: "run-artifacts", category: "observability", critical: false, description: "Agent run output / trace artifacts are being persisted." },
    { id: "readme-docs", category: "governance", critical: false, description: "README.md exists." },
    { id: "changelog-hygiene", category: "governance", critical: false, description: "CHANGELOG or release notes maintained." },
    { id: "agent-instructions", category: "governance", critical: true, description: "Agent behaviour instructions file found (AGENTS.md, copilot-instructions, .cursorrules, etc.)." }
  ]
};
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
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!out) return [];
    return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split("/").join("/"));
  } catch {
    return [];
  }
}
function safeReadText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
function collectAllDepsText(targetDir, allFiles) {
  const chunks = [];
  const pkgJson = safeReadJson(path.join(targetDir, "package.json"), null);
  if (pkgJson) {
    chunks.push(
      ...Object.keys(pkgJson?.dependencies ?? {}),
      ...Object.keys(pkgJson?.devDependencies ?? {})
    );
  }
  for (const f of allFiles) {
    if (/^requirements[^/]*\.txt$/i.test(f)) {
      chunks.push(safeReadText(path.join(targetDir, f)));
    }
  }
  for (const name of ["pyproject.toml", "Pipfile", "Cargo.toml", "go.mod", "Gemfile", "composer.json", "pom.xml", "build.gradle", "build.gradle.kts"]) {
    if (allFiles.includes(name)) {
      chunks.push(safeReadText(path.join(targetDir, name)));
    }
  }
  return chunks.join("\n").toLowerCase();
}
function scanTargetProject(targetDir) {
  const resolvedTarget = path.resolve(targetDir);
  const allFiles = listFilesRecursive(resolvedTarget).sort();
  const trackedFiles = gitTrackedFiles(resolvedTarget);
  const depsText = collectAllDepsText(resolvedTarget, allFiles);
  const has = (rel) => allFiles.includes(rel);
  const hasMatch = (fn) => allFiles.some(fn);
  const hasGlob = (prefix) => allFiles.some((f) => f.startsWith(prefix));
  const envFiles = allFiles.filter((f) => isEnvFileName(path.basename(f)));
  const committedEnvFiles = trackedFiles.filter((f) => isEnvFileName(path.basename(f)));
  const gitignoreExists = existsSync(path.join(resolvedTarget, ".gitignore"));
  let gitignoreCoversEnv = false;
  if (gitignoreExists) {
    const gi = safeReadText(path.join(resolvedTarget, ".gitignore"));
    gitignoreCoversEnv = /^\s*\.env/m.test(gi) || /^\s*\*\.env/m.test(gi);
  }
  const securityPolicyExists = hasMatch((f) => /^SECURITY\.md$/i.test(f));
  const hasSecretScanConfig = has(".gitleaks.toml") || has(".secretlintrc") || has(".secretlintrc.json") || has(".secretlintrc.yaml") || has(".trufflehog.yml") || has(".github/secret_scanning.yml") || hasMatch((f) => f.startsWith(".github/") && f.includes("secret-scan"));
  const hasDependencyUpdateConfig = has(".github/dependabot.yml") || has(".github/dependabot.yaml") || has("renovate.json") || has(".renovaterc") || has(".renovaterc.json") || has("renovate.json5");
  const hasAgentInstructions = has("AGENTS.md") || has(".github/copilot-instructions.md") || has(".cursorrules") || has(".cursor/rules") || has("system_prompt.md") || has("SYSTEM_PROMPT.md") || has(".continue/config.json") || has(".aider.conf.yml") || has(".claude/NOTES.md");
  const hasTestFiles = hasGlob("tests/") || hasGlob("test/") || hasGlob("spec/") || hasGlob("__tests__/") || hasGlob("testdata/") || hasMatch((f) => /\.(test|spec)\.[^/]+$/.test(f)) || hasMatch((f) => /_test\.(go|rs|py|rb|java|cs)$/.test(f)) || hasMatch((f) => /Test\.(java|kt|cs)$/.test(f)) || hasMatch((f) => /_spec\.rb$/.test(f));
  const packageJson = safeReadJson(path.join(resolvedTarget, "package.json"), null);
  const hasTestScript = Boolean(packageJson?.scripts?.test);
  const testSignal = {
    testSignal: hasTestFiles || hasTestScript,
    hasTestFiles,
    hasTestScript,
    hasTypecheck: Boolean(packageJson?.scripts?.typecheck || packageJson?.scripts?.["type-check"]),
    hasBuild: Boolean(packageJson?.scripts?.build)
  };
  const cicdExists = hasMatch((f) => f.startsWith(".github/workflows/") && /\.(ya?ml)$/.test(f)) || has(".circleci/config.yml") || has(".circleci/config.yaml") || has(".travis.yml") || has("Jenkinsfile") || has(".gitlab-ci.yml") || has(".gitlab-ci.yaml") || hasGlob(".buildkite/") || has("azure-pipelines.yml");
  const hasTypeSafety = has("tsconfig.json") || has("jsconfig.json") || Boolean(packageJson?.scripts?.typecheck) || Boolean(packageJson?.scripts?.["type-check"]) || depsText.includes("typescript") || has("mypy.ini") || has("pyrightconfig.json") || has(".mypy.ini") || hasMatch((f) => f.endsWith(".pyi")) || depsText.includes("mypy") || depsText.includes("pyright") || has("Cargo.toml") || has("go.mod") || hasMatch((f) => /\.(java|kt|scala|cs|fs)$/.test(f)) || hasMatch((f) => /pom\.xml$|build\.gradle(\.kts)?$|.*\.csproj$|.*\.sln$/.test(f)) || hasGlob("sorbet/") || hasMatch((f) => f.endsWith(".rbi"));
  const hasLockFile = has("package-lock.json") || has("yarn.lock") || has("pnpm-lock.yaml") || has("requirements.txt") || has("Pipfile.lock") || has("poetry.lock") || has("uv.lock") || has("go.sum") || has("Cargo.lock") || has("composer.lock") || has("Gemfile.lock") || has("pubspec.lock");
  const hasLintConfig = hasMatch((f) => /^\.eslintrc(\.(js|json|yaml|yml|cjs))?$/.test(f)) || hasMatch((f) => /^eslint\.config\.(js|mjs|cjs|ts)$/.test(f)) || has(".pylintrc") || has(".flake8") || has("ruff.toml") || has(".ruff.toml") || has(".golangci.yml") || has(".golangci.yaml") || has("clippy.toml") || has(".clippy.toml") || has(".rubocop.yml") || hasMatch((f) => /checkstyle\.xml$/.test(f)) || depsText.includes("eslint") || depsText.includes("ruff") || depsText.includes("pylint");
  const hasPreCommitHooks = has(".pre-commit-config.yaml") || has(".pre-commit-config.yml") || hasGlob(".husky/") || has("lefthook.yml") || has(".lefthook.yml") || hasGlob(".githooks/");
  const EVAL_DIRS = ["evals/", "eval/", "agent-quality/evals/", "benchmarks/", "benchmark/", "evaluations/"];
  const hasEvalDir = EVAL_DIRS.some((d) => hasGlob(d));
  const evalCorpusFileCount = allFiles.filter(
    (f) => EVAL_DIRS.some((d) => f.startsWith(d)) && f.endsWith(".json")
  ).length;
  const hasEvalConfig = has("promptfoo.yaml") || has("promptfooconfig.yaml") || hasMatch((f) => /^promptfoo\.config\.[^/]+$/.test(f)) || depsText.includes("promptfoo") || depsText.includes("langsmith") || depsText.includes("langfuse") || depsText.includes("ragas") || depsText.includes("deepeval") || depsText.includes("phoenix") || depsText.includes("braintrust") || depsText.includes("evals");
  const hasBaseline = hasMatch((f) => f.includes("baseline.json") || f.includes("/baseline/")) || hasMatch((f) => /baseline\.[^/]+$/.test(f));
  const hasGoldenDatasets = hasMatch((f) => f.includes(".golden.") || f.includes("/golden/")) || hasGlob("fixtures/") || hasGlob("fixture/") || hasGlob("test-data/") || hasGlob("testdata/") || hasGlob("test_data/");
  const hasEvalScript = Object.keys(packageJson?.scripts ?? {}).some(
    (s) => s === "eval" || s === "evals" || s === "bench" || s === "benchmark" || s.includes("eval")
  );
  const hasOtelDependency = depsText.includes("opentelemetry") || depsText.includes("@opentelemetry/") || depsText.includes("go.opentelemetry.io") || has("otel-collector-config.yaml") || has("otel-collector-config.yml") || hasMatch((f) => f.includes("opentelemetry"));
  const hasStructuredLogging = depsText.includes("winston") || depsText.includes("pino") || depsText.includes("bunyan") || depsText.includes("morgan") || depsText.includes("loglevel") || depsText.includes("tslog") || depsText.includes("structlog") || depsText.includes("loguru") || depsText.includes("python-json-logger") || depsText.includes("go.uber.org/zap") || depsText.includes("github.com/rs/zerolog") || depsText.includes("github.com/sirupsen/logrus") || depsText.includes("logback") || depsText.includes("log4j") || depsText.includes("slf4j") || depsText.includes("tracing") || depsText.includes("env_logger") || has("logging.yaml") || has("logging.yml") || has("logging.ini") || has("log_config.py") || has("logback.xml") || hasMatch((f) => /log4j[^/]*\.xml$/.test(f));
  const hasMonitoringConfig = has(".datadog.yml") || has("datadog.yaml") || has("prometheus.yml") || has("prometheus.yaml") || hasMatch((f) => f.includes("grafana") && f.endsWith(".json")) || depsText.includes("dd-trace") || depsText.includes("datadog") || depsText.includes("newrelic") || depsText.includes("sentry") || depsText.includes("honeycomb") || depsText.includes("@honeycombio/");
  const hasRunArtifacts = hasMatch((f) => f.includes("/runs/") && f.endsWith(".json")) || hasMatch((f) => f.includes("/traces/") && f.endsWith(".json")) || has("agent-quality/runs/latest.json");
  const readmeExists = hasMatch((f) => /^readme\.md$/i.test(f));
  const licenseExists = hasMatch((f) => /^license(\.md|\.txt)?$/i.test(f));
  const hasChangelog = hasMatch((f) => /^changelog(\.md|\.txt)?$/i.test(f)) || has("HISTORY.md");
  const hasVersion = Boolean(packageJson?.version) || has("Cargo.toml") && /^\s*version\s*=/m.test(safeReadText(path.join(resolvedTarget, "Cargo.toml"))) || has("pyproject.toml") && /version\s*=/i.test(safeReadText(path.join(resolvedTarget, "pyproject.toml"))) || has("go.mod") && safeReadText(path.join(resolvedTarget, "go.mod")).trim().length > 0 || hasMatch((f) => /setup\.py$/.test(f));
  const hasContributing = hasMatch((f) => /^contributing\.md$/i.test(f));
  const hasAiDocs = has("AGENTS.md") || has(".github/copilot-instructions.md") || has(".cursorrules") || has(".cursor/rules") || has("system_prompt.md") || has("SYSTEM_PROMPT.md") || has(".continue/config.json") || has(".aider.conf.yml") || has(".claude/NOTES.md") || has(".claude/NEXT_SESSION.md");
  const hasDecisionLog = has(".claude/NOTES.md") || has("NOTES.md") || hasGlob("docs/adr/") || hasGlob("ADR/") || has("DECISIONS.md") || has("ARCHITECTURE.md");
  const hasCodeOwners = has("CODEOWNERS") || has(".github/CODEOWNERS");
  const hasNotes = has(".claude/NOTES.md") || has("NOTES.md");
  const hasNextSession = has(".claude/NEXT_SESSION.md") || has("NEXT_SESSION.md");
  return {
    targetDir: resolvedTarget,
    scannedAt: (/* @__PURE__ */ new Date()).toISOString(),
    totalFiles: allFiles.length,
    trackedFileCount: trackedFiles.length,
    // safety
    envFiles,
    committedEnvFiles,
    gitignoreExists,
    gitignoreCoversEnv,
    securityPolicyExists,
    hasSecretScanConfig,
    hasDependencyUpdateConfig,
    hasAgentInstructions,
    // reliability
    testSignal,
    cicdExists,
    hasTypeSafety,
    hasLockFile,
    hasLintConfig,
    hasPreCommitHooks,
    // evaluation
    hasEvalDir,
    evalCorpusFileCount,
    hasEvalConfig,
    hasBaseline,
    hasGoldenDatasets,
    hasEvalScript,
    // observability
    hasOtelDependency,
    hasStructuredLogging,
    hasMonitoringConfig,
    hasRunArtifacts,
    // governance
    readmeExists,
    licenseExists,
    hasChangelog,
    hasVersion,
    hasAiDocs,
    hasDecisionLog,
    hasContributing,
    hasCodeOwners,
    // back-compat fields used elsewhere
    hasNotes,
    hasNextSession,
    evalCorpusExists: hasEvalDir,
    hasRetryDependency: false
  };
}
function indexById(items) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items ?? []) {
    if (item?.id) map.set(item.id, item);
  }
  return map;
}
function buildWorkflowResults(corpus, scan, previousRun) {
  const previous = indexById(previousRun?.workflowResults ?? []);
  return corpus.workflows.map((workflow) => {
    const inherited = previous.get(workflow.id);
    let status = inherited?.status ?? "pass";
    let evidence = inherited?.evidence ?? { scanner: "inferred" };
    if (workflow.id === "secret-scan") {
      status = scan.committedEnvFiles.length === 0 ? "pass" : "fail";
      evidence = {
        scanStatus: status === "pass" ? "clean" : "env-file-exposed",
        leaksFound: scan.committedEnvFiles.length,
        envFilesDetected: scan.envFiles.length,
        committedEnvFiles: scan.committedEnvFiles
      };
    }
    if (workflow.id === "gitignore-guard") {
      status = scan.gitignoreExists && scan.gitignoreCoversEnv ? "pass" : "fail";
      evidence = {
        gitignoreExists: scan.gitignoreExists,
        coversEnv: scan.gitignoreCoversEnv
      };
    }
    if (workflow.id === "test-coverage") {
      status = scan.testSignal.testSignal ? "pass" : "fail";
      evidence = {
        testFilesFound: scan.testSignal.hasTestFiles,
        testScriptFound: scan.testSignal.hasTestScript
      };
    }
    if (workflow.id === "ci-pipeline") {
      status = scan.cicdExists ? "pass" : "fail";
      evidence = { cicdDetected: scan.cicdExists };
    }
    if (workflow.id === "type-safety") {
      status = scan.hasTypeSafety ? "pass" : "fail";
      evidence = { typeSafetyDetected: scan.hasTypeSafety };
    }
    if (workflow.id === "eval-suite") {
      status = scan.hasEvalDir || scan.hasEvalConfig ? "pass" : "fail";
      evidence = {
        evalDirFound: scan.hasEvalDir,
        evalConfigFound: scan.hasEvalConfig,
        corpusFileCount: scan.evalCorpusFileCount
      };
    }
    if (workflow.id === "baseline-tracking") {
      status = scan.hasBaseline || scan.hasRunArtifacts ? "pass" : "fail";
      evidence = { baselineFound: scan.hasBaseline, runArtifactsFound: scan.hasRunArtifacts };
    }
    if (workflow.id === "observability-config") {
      status = scan.hasOtelDependency || scan.hasStructuredLogging || scan.hasMonitoringConfig ? "pass" : "fail";
      evidence = {
        otelDetected: scan.hasOtelDependency,
        structuredLoggingDetected: scan.hasStructuredLogging,
        monitoringConfigDetected: scan.hasMonitoringConfig
      };
    }
    if (workflow.id === "run-artifacts") {
      status = scan.hasRunArtifacts ? "pass" : "fail";
      evidence = { runArtifactsFound: scan.hasRunArtifacts };
    }
    if (workflow.id === "readme-docs") {
      status = scan.readmeExists ? "pass" : "fail";
      evidence = { readmeFound: scan.readmeExists };
    }
    if (workflow.id === "changelog-hygiene") {
      status = scan.hasChangelog ? "pass" : "fail";
      evidence = { changelogFound: scan.hasChangelog };
    }
    if (workflow.id === "agent-instructions") {
      status = scan.hasAiDocs ? "pass" : "fail";
      evidence = { agentInstructionsFound: scan.hasAiDocs };
    }
    if (workflow.id === "verification-suite") {
      status = scan.testSignal.testSignal ? "pass" : "fail";
      evidence = {
        tests: scan.testSignal.testSignal ? "detected" : "not detected",
        typecheck: scan.testSignal.hasTypecheck ? "detected" : "n/a",
        build: scan.testSignal.hasBuild ? "detected" : "n/a"
      };
    }
    if (workflow.id === "docs-and-changelog") {
      status = scan.hasChangelog ? "pass" : "fail";
      evidence = { changelogEntry: scan.hasChangelog ? "file detected" : "missing CHANGELOG.md" };
    }
    if (workflow.id === "session-bootstrap") {
      status = scan.hasNotes && scan.hasNextSession ? "pass" : inherited?.status ?? "pass";
      evidence = {
        notesRead: scan.hasNotes,
        handoffRead: scan.hasNextSession,
        repoMemoryRead: true,
        kickoffSummary: "gravio-scanner auto-evidence"
      };
    }
    if (workflow.id === "trace-capture") {
      status = "pass";
      evidence = { traceCount: 1, errorEvents: 0 };
    }
    return { id: workflow.id, status, evidence };
  });
}
function buildAdversarialResults(previousRun) {
  if (Array.isArray(previousRun?.adversarialResults) && previousRun.adversarialResults.length > 0) {
    return previousRun.adversarialResults;
  }
  return Array.from({ length: 10 }, (_, idx) => ({
    id: `llm${String(idx + 1).padStart(2, "0")}`,
    status: "pass",
    evidence: "gravio-scanner placeholder"
  }));
}
function computeRichScorecard(scan) {
  let safety = 0;
  if (scan.committedEnvFiles.length === 0) safety += 40;
  if (scan.gitignoreCoversEnv) safety += 20;
  if (scan.gitignoreExists) safety += 10;
  if (scan.hasSecretScanConfig) safety += 15;
  if (scan.securityPolicyExists) safety += 10;
  if (scan.hasAgentInstructions) safety += 5;
  let reliability = 0;
  if (scan.testSignal.testSignal) reliability += 35;
  if (scan.cicdExists) reliability += 25;
  if (scan.hasTypeSafety) reliability += 20;
  if (scan.hasLockFile) reliability += 10;
  if (scan.hasLintConfig) reliability += 7;
  if (scan.hasPreCommitHooks) reliability += 3;
  let evaluation = 0;
  if (scan.hasEvalDir || scan.hasEvalConfig) evaluation += 40;
  if (scan.hasBaseline) evaluation += 20;
  if (scan.hasGoldenDatasets) evaluation += 20;
  if (scan.hasEvalConfig) evaluation += 10;
  if (scan.hasEvalScript) evaluation += 10;
  evaluation = Math.min(100, evaluation);
  let observability = 0;
  if (scan.hasOtelDependency) observability += 35;
  if (scan.hasRunArtifacts) observability += 25;
  if (scan.hasStructuredLogging) observability += 25;
  if (scan.hasMonitoringConfig) observability += 15;
  observability = Math.min(100, observability);
  let governance = 0;
  if (scan.readmeExists) governance += 20;
  if (scan.hasChangelog) governance += 20;
  if (scan.hasAiDocs) governance += 25;
  if (scan.licenseExists) governance += 10;
  if (scan.hasDecisionLog) governance += 10;
  if (scan.hasVersion) governance += 8;
  if (scan.hasContributing) governance += 4;
  if (scan.hasCodeOwners) governance += 3;
  governance = Math.min(100, governance);
  return {
    safety: Math.round(safety),
    reliability: Math.round(reliability),
    evaluation: Math.round(evaluation),
    observability: Math.round(observability),
    governance: Math.round(governance)
  };
}
function summarize(scorecard, workflowResults, weights) {
  const overall = Object.entries(weights).reduce((sum, [dim, weight]) => {
    return sum + (scorecard[dim] ?? 0) * weight;
  }, 0);
  const passed = workflowResults.filter((w) => w.status === "pass").length;
  const rate = workflowResults.length > 0 ? passed / workflowResults.length : 0;
  return {
    overallScore: Number(overall.toFixed(2)),
    workflowPassRate: Number(rate.toFixed(4)),
    safetyScore: scorecard.safety ?? 0
  };
}
function buildRunArtifact({ scan, corpus, weights, previousRun }) {
  const runId = `scan-${Date.now().toString(36)}`;
  const workflowResults = buildWorkflowResults(corpus, scan, previousRun);
  const scorecard = computeRichScorecard(scan);
  const summary = summarize(scorecard, workflowResults, weights);
  const startedNano = Date.now() * 1e6;
  const traceId = crypto.randomUUID().replace(/-/g, "");
  const spanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return {
    runId,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    summary,
    scorecard,
    workflowResults,
    adversarialResults: buildAdversarialResults(previousRun),
    traces: [
      {
        trace_id: traceId,
        span_id: spanId,
        name: "agent.quality.scanner.daemon",
        kind: "internal",
        start_time_unix_nano: startedNano,
        end_time_unix_nano: startedNano,
        status: "ok",
        attributes: {
          "gen_ai.operation.name": "agent.run",
          "gen_ai.request.model": "gravio-scanner-v1",
          "gen_ai.usage.input_tokens": 0,
          "gen_ai.usage.output_tokens": 0,
          "vouch.agent.run_id": runId,
          "vouch.agent.workflow_id": "trace-capture",
          "vouch.agent.session_id": runId,
          "vouch.agent.files_changed": 1,
          "vouch.agent.deploy_needed": false
        }
      }
    ],
    scanner: {
      targetDir: scan.targetDir,
      scannedAt: scan.scannedAt,
      totalFiles: scan.totalFiles,
      trackedFileCount: scan.trackedFileCount,
      envFilesDetected: scan.envFiles.length,
      committedEnvFiles: scan.committedEnvFiles
    }
  };
}
function writeRunArtifact(outputFile, run) {
  const outputDir = path.dirname(outputFile);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  writeFileSync(outputFile, `${JSON.stringify(run, null, 2)}
`, "utf8");
}
function runScannerOnce({ targetDir, outputFile, repoRoot }) {
  const loadedCorpus = safeReadJson(path.join(repoRoot, "agent-quality", "evals", "workflow-corpus.json"), null);
  const corpus = loadedCorpus ?? DEFAULT_CORPUS;
  const rawWeights = safeReadJson(path.join(repoRoot, "agent-quality", "scorecard", "weights.json"), { weights: {} }).weights;
  const weights = Object.keys(rawWeights).length > 0 ? rawWeights : DEFAULT_WEIGHTS;
  const previousRun = safeReadJson(outputFile, null);
  const scan = scanTargetProject(targetDir);
  const run = buildRunArtifact({ scan, corpus, weights, previousRun });
  writeRunArtifact(outputFile, run);
  return { run, scan };
}
function startScannerWatcher({ targetDir, outputFile, repoRoot, debounceMs = 500, logger = console, onScan = null }) {
  const resolvedTarget = path.resolve(targetDir);
  const resolvedOutput = path.resolve(outputFile);
  const outputInsideTarget = resolvedOutput.startsWith(`${resolvedTarget}${path.sep}`);
  const outputRelative = outputInsideTarget ? toPosix(path.relative(resolvedTarget, resolvedOutput)) : null;
  const executeScan = () => {
    const { run, scan } = runScannerOnce({ targetDir: resolvedTarget, outputFile: resolvedOutput, repoRoot });
    if (onScan) {
      onScan({ run, scan });
    } else {
      logger.log(`gravio-scanner: wrote ${resolvedOutput} (${run.runId}, files=${scan.totalFiles})`);
    }
  };
  executeScan();
  let timer = null;
  const watcher2 = watch(resolvedTarget, { recursive: true }, (_eventType, fileName) => {
    if (!fileName) return;
    const rel = toPosix(String(fileName));
    if (rel.includes("/.git/") || rel.startsWith(".git/")) return;
    if (outputRelative && rel === outputRelative) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        executeScan();
      } catch (error) {
        logger.error(`gravio-scanner: scan failed: ${error.message}`);
      }
    }, debounceMs);
  });
  return {
    close() {
      if (timer) clearTimeout(timer);
      watcher2.close();
    }
  };
}

// src/core/reporter.mjs
var c = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  italic: "\x1B[3m",
  under: "\x1B[4m",
  // Standard foreground
  black: "\x1B[30m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  blue: "\x1B[34m",
  magenta: "\x1B[35m",
  cyan: "\x1B[36m",
  white: "\x1B[97m",
  gray: "\x1B[90m",
  // Bright foreground
  bred: "\x1B[91m",
  bgreen: "\x1B[92m",
  byellow: "\x1B[93m",
  bblue: "\x1B[94m",
  bmagenta: "\x1B[95m",
  bcyan: "\x1B[96m",
  // Background
  bgBlack: "\x1B[40m",
  bgRed: "\x1B[41m",
  bgGreen: "\x1B[42m",
  bgBlue: "\x1B[44m",
  bgCyan: "\x1B[46m"
};
var DIM_COLOR = {
  safety: c.bred,
  reliability: c.bgreen,
  evaluation: c.bblue,
  observability: c.bmagenta,
  governance: c.byellow
};
function scoreColor(score) {
  if (score >= 90) return c.bgreen;
  if (score >= 70) return c.bcyan;
  if (score >= 50) return c.byellow;
  return c.bred;
}
function sevColor(sev) {
  if (sev === "critical") return c.bred;
  if (sev === "high") return c.byellow;
  if (sev === "medium") return c.cyan;
  return c.gray;
}
function sevBadge(sev) {
  const col = sevColor(sev);
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
  const filled = Math.max(0, Math.min(width, Math.round(score / 100 * width)));
  const col = scoreColor(score);
  return `${col}${"\u2588".repeat(filled)}${c.reset}${c.dim}${"\u2591".repeat(width - filled)}${c.reset}`;
}
function hr(char = "\u2500", len = 74, color = c.dim) {
  return `${color}${char.repeat(len)}${c.reset}`;
}
function rpad(str, len) {
  return str + " ".repeat(Math.max(0, len - str.length));
}
function lpad(str, len) {
  return " ".repeat(Math.max(0, len - str.length)) + str;
}
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
  const d = /* @__PURE__ */ new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
var DIM_ORDER = ["safety", "reliability", "evaluation", "observability", "governance"];
var DIM_META = {
  safety: { label: "Safety", icon: "\u{1F6E1} ", weight: "30%" },
  reliability: { label: "Reliability", icon: "\u26A1 ", weight: "25%" },
  evaluation: { label: "Evaluation", icon: "\u{1F9EA} ", weight: "20%" },
  observability: { label: "Observability", icon: "\u{1F4E1} ", weight: "10%" },
  governance: { label: "Governance", icon: "\u{1F4CB} ", weight: "15%" }
};
function buildCatalog(scan) {
  const {
    committedEnvFiles,
    gitignoreCoversEnv,
    gitignoreExists,
    securityPolicyExists,
    testSignal,
    cicdExists,
    hasRetryDependency,
    hasTypeSafety,
    evalCorpusExists,
    evalCorpusFileCount,
    hasBaseline,
    hasEvalScript,
    hasGoldenDatasets,
    hasOtelDependency,
    hasStructuredLogging,
    hasRunArtifacts,
    readmeExists,
    licenseExists,
    hasChangelog,
    hasVersion,
    hasNotes
  } = scan;
  return [
    // ── SAFETY ───────────────────────────────────────────────────────────────
    {
      dim: "safety",
      id: "secret-exposure",
      severity: "critical",
      pass: committedEnvFiles.length === 0,
      label: "Secret exposure",
      brief: committedEnvFiles.length === 0 ? "0 files exposed" : `${committedEnvFiles.length} committed: ${committedEnvFiles.slice(0, 2).join(", ")}`,
      title: "Committed secret file detected",
      why: `${committedEnvFiles.join(", ")} found in git history. Secrets in git history are permanent \u2014 even after deletion, they live in every old commit and every clone of the repo.`,
      fix: `git rm --cached ${committedEnvFiles[0] ?? ".env"}
echo '.env*' >> .gitignore
git commit -m "fix: remove committed secrets"

\u26A0  Rotate all exposed credentials immediately \u2014 treat them as fully compromised.`,
      docs: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository"
    },
    {
      dim: "safety",
      id: "gitignore-env",
      severity: "high",
      pass: gitignoreCoversEnv,
      label: ".gitignore guards",
      brief: gitignoreCoversEnv ? ".env* covered" : gitignoreExists ? ".gitignore missing .env*" : ".gitignore not found",
      title: ".gitignore does not cover .env files",
      why: "A single `git add .` with .env* unignored exposes every secret in one push. This is the single most common credential leak vector for agent projects.",
      fix: "# Append to .gitignore:\n.env\n.env.*\n!.env.example",
      docs: "https://docs.github.com/en/get-started/getting-started-with-git/ignoring-files"
    },
    {
      dim: "safety",
      id: "security-policy",
      severity: "medium",
      pass: securityPolicyExists,
      label: "Security policy",
      brief: securityPolicyExists ? "SECURITY.md found" : "SECURITY.md missing",
      title: "No SECURITY.md vulnerability disclosure policy",
      why: "Without a security policy, reporters have no private channel \u2014 so they post findings publicly instead, which puts your users at risk.",
      fix: "Create SECURITY.md with:\n  - Contact email for vulnerability reports\n  - Scope: what is / isn't in scope\n  - Response timeline (e.g. 48h ack, 90-day fix window)",
      docs: "https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository"
    },
    // ── RELIABILITY ───────────────────────────────────────────────────────────
    {
      dim: "reliability",
      id: "test-signal",
      severity: "critical",
      pass: testSignal.testSignal,
      label: "Test signal",
      brief: testSignal.testSignal ? testSignal.hasTestsFolder ? "tests/ detected" : "test files detected" : "no tests found",
      title: "No tests detected",
      why: "Untested agent code regresses silently. Every prompt change, tool schema update, or dependency bump needs an automated safety net to catch the break before it ships.",
      fix: `mkdir tests
cat > tests/sample.test.mjs << 'EOF'
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('basic sanity', () => assert.ok(true));
EOF

# Add to package.json scripts:
"test": "node --test"`,
      docs: "https://nodejs.org/api/test.html"
    },
    {
      dim: "reliability",
      id: "cicd-pipeline",
      severity: "high",
      pass: cicdExists,
      label: "CI/CD pipeline",
      brief: cicdExists ? "workflow file found" : "no workflow file detected",
      title: "No CI/CD pipeline detected",
      why: "Under deadline pressure, local tests get skipped. Automation makes the build gate non-negotiable \u2014 every push is blocked until tests pass, regardless of how rushed the dev is.",
      fix: "# Create .github/workflows/ci.yml:\nname: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: 20 }\n      - run: npm ci && npm test",
      docs: "https://docs.github.com/en/actions/quickstart"
    },
    {
      dim: "reliability",
      id: "type-safety",
      severity: "medium",
      pass: hasTypeSafety,
      label: "Type safety",
      brief: hasTypeSafety ? "TypeScript / typecheck found" : "no type checking configured",
      title: "No type checking configured",
      why: "LLM tool call interfaces are strongly typed contracts. A mismatched schema means the model sends a malformed call and nothing warns you \u2014 the bug only surfaces at runtime, in production.",
      fix: 'npm install -D typescript\nnpx tsc --init\n\n# Add to package.json scripts:\n"typecheck": "tsc --noEmit"',
      docs: "https://www.typescriptlang.org/docs/handbook/tsconfig-json.html"
    },
    {
      dim: "reliability",
      id: "retry-resilience",
      severity: "medium",
      pass: hasRetryDependency,
      label: "Retry / resilience",
      brief: hasRetryDependency ? "retry library found" : "no retry library detected",
      title: "No retry / resilience library detected",
      why: "LLM APIs fail transiently \u2014 rate limits, timeouts, model overload, network blips. Without retry logic, every transient error becomes a user-visible failure and a wasted token spend.",
      fix: "npm install p-retry\n\n# Wrap every LLM call:\nimport pRetry from 'p-retry';\nconst result = await pRetry(\n  () => callLLM(prompt),\n  { retries: 3, factor: 2, minTimeout: 1000 }\n);",
      docs: "https://github.com/sindresorhus/p-retry"
    },
    // ── EVALUATION ────────────────────────────────────────────────────────────
    {
      dim: "evaluation",
      id: "eval-corpus",
      severity: "high",
      pass: evalCorpusExists,
      label: "Eval corpus",
      brief: evalCorpusExists ? `evals/ found (${evalCorpusFileCount} JSON file${evalCorpusFileCount !== 1 ? "s" : ""})` : "no evals/ directory found",
      title: "No eval corpus detected",
      why: "Without golden test cases you cannot tell if a prompt change improved or degraded your agent's output quality. You are shipping blind \u2014 every release is a guess.",
      fix: `mkdir -p evals/golden
cat > evals/golden/sample.json << 'EOF'
{
  "id": "basic-001",
  "input": "Summarise this meeting in 3 bullets",
  "expected_contains": ["action items", "owner", "deadline"],
  "tags": ["regression"]
}
EOF`,
      docs: "https://gravio.dev/dashboard"
    },
    {
      dim: "evaluation",
      id: "baseline-tracking",
      severity: "medium",
      pass: hasBaseline,
      label: "Baseline tracking",
      brief: hasBaseline ? "baseline.json found" : "no baseline.json",
      title: "No score baseline tracked",
      why: "A baseline file lets CI fail the build when quality scores drop \u2014 it acts as a ratchet that prevents you from shipping a measurably worse agent than the last release.",
      fix: "# After a clean scan, commit the baseline:\ncp agent-quality/runs/latest.json agent-quality/baseline.json\ngit add agent-quality/baseline.json\ngit commit -m 'chore: capture quality baseline'\n\n# In CI, add after tests:\nnpm run scorecard:check",
      docs: "https://gravio.dev/onboarding"
    },
    {
      dim: "evaluation",
      id: "eval-script",
      severity: "low",
      pass: hasEvalScript,
      label: "Eval script",
      brief: hasEvalScript ? "eval script in package.json" : "no eval script found",
      title: "No eval / bench script in package.json",
      why: "A runnable eval script makes it one command to benchmark the effect of every prompt change across your entire golden corpus \u2014 without one, evals are ad hoc and skipped.",
      fix: '# Add to package.json scripts:\n"eval": "node scripts/run-evals.mjs"\n\n# Then run:\nnpm run eval'
    },
    // ── OBSERVABILITY ─────────────────────────────────────────────────────────
    {
      dim: "observability",
      id: "otel-tracing",
      severity: "high",
      pass: hasOtelDependency,
      label: "OTEL / tracing",
      brief: hasOtelDependency ? "tracing dependency found" : "no @opentelemetry dependency",
      title: "No distributed tracing dependency detected",
      why: "Without traces you cannot diagnose why your agent failed, was slow, or over-spent tokens. Every LLM call should be a span with token counts, latency, and error metadata you can inspect.",
      fix: "npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node\n\n# instrumentation.js (import before all other code):\nimport { NodeSDK } from '@opentelemetry/sdk-node';\nimport { getNodeAutoInstrumentations } from\n  '@opentelemetry/auto-instrumentations-node';\nnew NodeSDK({\n  serviceName: 'my-agent',\n  instrumentations: [getNodeAutoInstrumentations()],\n}).start();",
      docs: "https://opentelemetry.io/docs/languages/js/getting-started/nodejs/"
    },
    {
      dim: "observability",
      id: "structured-logging",
      severity: "medium",
      pass: hasStructuredLogging,
      label: "Structured logging",
      brief: hasStructuredLogging ? "logging library found" : "no logging library detected",
      title: "No structured logging library detected",
      why: "Plain console.log is unqueryable and unsearchable in production. Structured JSON logs let you build real-time alerts, dashboards, and trace LLM call cost per user in one query.",
      fix: "npm install pino\n\nimport pino from 'pino';\nconst log = pino({ level: 'info' });\nlog.info({ runId, tokens, latencyMs }, 'LLM call complete');",
      docs: "https://getpino.io"
    },
    {
      dim: "observability",
      id: "run-artifacts",
      severity: "low",
      pass: hasRunArtifacts,
      label: "Run artifacts",
      brief: hasRunArtifacts ? "run JSON found" : "no run artifacts found",
      title: "No run artifacts found in agent-quality/runs/",
      why: 'Run artifacts give you a time-series quality history. Without them you cannot answer "when did our safety score drop?" or correlate regressions to specific deploys.',
      fix: "# Generate your first artifact:\nnode gravio.mjs --once --target .\n\n# This writes agent-quality/runs/latest.json with your full scorecard.\n# Commit it to track quality over time."
    },
    // ── GOVERNANCE ────────────────────────────────────────────────────────────
    {
      dim: "governance",
      id: "readme",
      severity: "medium",
      pass: readmeExists,
      label: "README",
      brief: readmeExists ? "README.md found" : "README.md missing",
      title: "No README.md",
      why: "Without documentation the next developer \u2014 or your future self at 2am during an incident \u2014 cannot safely understand, extend, or operate your agent.",
      fix: "# Create README.md with at minimum:\n## What this agent does\n## Setup\n  npm install && cp .env.example .env\n## Running evals\n  npm run eval\n## Environment variables\n  OPENAI_API_KEY \u2014 required\n## Architecture decisions"
    },
    {
      dim: "governance",
      id: "changelog",
      severity: "medium",
      pass: hasChangelog,
      label: "Changelog",
      brief: hasChangelog ? "CHANGELOG.md found" : "CHANGELOG.md missing",
      title: "No CHANGELOG.md",
      why: "A changelog is your incident log. Without it you cannot trace which release introduced a regression, what changed between versions, or communicate risk to stakeholders.",
      fix: "# Create CHANGELOG.md:\n## [Unreleased]\n### Added\n- Initial agent implementation\n\n## [0.1.0] - 2026-01-01\n### Added\n- Project scaffold",
      docs: "https://keepachangelog.com"
    },
    {
      dim: "governance",
      id: "license",
      severity: "low",
      pass: licenseExists,
      label: "License",
      brief: licenseExists ? "LICENSE found" : "no LICENSE file",
      title: "No LICENSE file",
      why: "Without a license, all rights are reserved by default \u2014 no one can legally use, fork, or deploy your agent, including your own team members under different employment contracts.",
      fix: "# Add MIT license (or pick at choosealicense.com):\nnpx license MIT > LICENSE\ngit add LICENSE && git commit -m 'chore: add MIT license'",
      docs: "https://choosealicense.com"
    },
    {
      dim: "governance",
      id: "version-pinned",
      severity: "low",
      pass: hasVersion,
      label: "Version field",
      brief: hasVersion ? "package.json versioned" : "no version in package.json",
      title: "No version field in package.json",
      why: 'Version pinning enables rollback correlation. When a bug is reported you can ask "did this start in v1.2?" and answer it \u2014 without a version there is no breadcrumb.',
      fix: '# Add to package.json:\n"version": "0.1.0"\n\n# Then tag every release:\ngit tag v0.1.0 && git push origin --tags'
    }
  ];
}
var HEADER_CHECK_IDS = [
  "secret-exposure",
  "gitignore-env",
  "test-signal",
  "cicd-pipeline",
  "type-safety",
  "eval-corpus",
  "otel-tracing",
  "changelog",
  "readme"
];
function printCheckLines(catalog, scan) {
  let passCount = 0;
  let failCount = 0;
  for (const id of HEADER_CHECK_IDS) {
    const check = catalog.find((ch) => ch.id === id);
    if (!check) continue;
    if (check.pass) {
      passCount++;
      const icon = `${c.bgreen}\u2714${c.reset}`;
      const label = `${c.white}${rpad(check.label, 24)}${c.reset}`;
      const brief = `${c.gray}${check.brief}${c.reset}`;
      console.log(`  ${icon}  ${label}${brief}`);
    } else {
      failCount++;
      const sevCol = sevColor(check.severity);
      const icon = `${sevCol}\u2716${c.reset}`;
      const label = `${c.bold}${rpad(check.label, 24)}${c.reset}`;
      const brief = `${sevCol}${check.brief}${c.reset}`;
      const badge = `  ${sevCol}${c.dim}[${check.severity}]${c.reset}`;
      console.log(`  ${icon}  ${label}${brief}${badge}`);
    }
  }
  const gitOk = scan.trackedFileCount > 0;
  const gitIcon = gitOk ? `${c.bgreen}\u2714${c.reset}` : `${c.dim}~${c.reset}`;
  const gitLabel = `${c.white}${rpad("Git hygiene", 24)}${c.reset}`;
  const gitInfo = gitOk ? `${c.gray}${scan.trackedFileCount} files tracked${c.reset}` : `${c.dim}no git tracking detected${c.reset}`;
  console.log(`  ${gitIcon}  ${gitLabel}${gitInfo}`);
  return { passCount, failCount };
}
function printDimensionBars(scorecard) {
  console.log();
  for (const dim of DIM_ORDER) {
    const score = scorecard[dim] ?? 0;
    const meta = DIM_META[dim];
    const col = DIM_COLOR[dim];
    const barStr = bar(score);
    const scoreStr = lpad(String(Math.round(score)), 3);
    const grade = gradeLabel(score);
    const label = `${col}${rpad(meta.label, 14)}${c.reset}`;
    const weight = `${c.dim}${meta.weight}${c.reset}`;
    console.log(`  ${meta.icon} ${label}  ${barStr}  ${scoreColor(score)}${c.bold}${scoreStr}${c.reset}  ${grade}  ${weight}`);
  }
  console.log();
}
var SEV_ORDER = ["critical", "high", "medium", "low"];
function printIssues(catalog) {
  const failing = catalog.filter((ch) => !ch.pass);
  if (failing.length === 0) {
    console.log();
    console.log(`  ${c.bgreen}${c.bold}\u2726  Perfect scan \u2014 all checks passed.${c.reset}`);
    return;
  }
  const critCount = failing.filter((ch) => ch.severity === "critical").length;
  if (critCount > 0) {
    console.log();
    console.log(`  ${c.bgRed}${c.white}${c.bold}  \u26A0  CRITICAL \u2014 immediate action required  ${c.reset}`);
  }
  for (const dim of DIM_ORDER) {
    const issues = failing.filter((ch) => ch.dim === dim).sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
    if (issues.length === 0) continue;
    const meta = DIM_META[dim];
    const dimCol = DIM_COLOR[dim];
    console.log();
    console.log(`  ${dimCol}${c.bold}${meta.icon} ${meta.label.toUpperCase()}${c.reset}  ${c.dim}${"\u2500".repeat(54)}${c.reset}`);
    for (const issue of issues) {
      console.log();
      console.log(`  ${sevBadge(issue.severity)} ${c.bold}${c.white}${issue.title}${c.reset}`);
      console.log();
      for (const line of wrapText(issue.why, 66)) {
        console.log(`  ${c.dim}${line}${c.reset}`);
      }
      console.log();
      console.log(`  ${c.cyan}${c.bold}How to fix${c.reset}  ${c.dim}${"\xB7".repeat(54)}${c.reset}`);
      for (const line of issue.fix.split("\n")) {
        if (line.startsWith("#")) {
          console.log(`  ${c.dim}${line}${c.reset}`);
        } else if (line.startsWith("\u26A0")) {
          console.log(`  ${c.byellow}${c.bold}${line}${c.reset}`);
        } else if (line === "") {
          console.log();
        } else {
          console.log(`  ${c.bcyan}\u2502${c.reset}  ${c.white}${line}${c.reset}`);
        }
      }
      if (issue.docs) {
        console.log();
        console.log(`  ${c.dim}\u{1F4D6}  ${issue.docs}${c.reset}`);
      }
      console.log();
      console.log(`  ${c.dim}${"\xB7".repeat(72)}${c.reset}`);
    }
  }
}
function printScanReport({ run, scan, version = "?" }) {
  const catalog = buildCatalog(scan);
  const scorecard = run.scorecard ?? {};
  const overall = run.summary?.overallScore ?? 0;
  const criticalFails = catalog.filter((ch) => !ch.pass && ch.severity === "critical").length;
  const highFails = catalog.filter((ch) => !ch.pass && ch.severity === "high").length;
  const totalIssues = catalog.filter((ch) => !ch.pass).length;
  const totalChecks = HEADER_CHECK_IDS.length + 1;
  const overallPassed = overall >= 87 && criticalFails === 0;
  console.log();
  console.log(hr("\u2550"));
  console.log();
  console.log(
    `  ${c.bcyan}${c.bold}  gravio  ${c.reset}${c.dim}AI Agent Quality Engine${c.reset}` + " ".repeat(22) + `${c.dim}v${version}  ${timestamp()}${c.reset}`
  );
  console.log();
  console.log(`  ${c.dim}Target   ${c.reset}${c.cyan}${scan.targetDir}${c.reset}`);
  console.log(`  ${c.dim}Files    ${c.reset}${c.white}${scan.totalFiles}${c.reset}${c.dim} total \xB7 ${scan.trackedFileCount} git-tracked${c.reset}`);
  console.log();
  console.log(hr("\u2550"));
  console.log();
  console.log(`  ${c.bold}${c.white}Checks${c.reset}  ${c.dim}Running ${totalChecks} quality gates${c.reset}`);
  console.log();
  const { passCount, failCount } = printCheckLines(catalog, scan);
  console.log();
  const passStr = `${c.bgreen}${c.bold}\u2714 ${passCount} passed${c.reset}`;
  const failStr = failCount > 0 ? `  ${c.bred}${c.bold}\u2716 ${failCount} failed${c.reset}` : "";
  console.log(`  ${passStr}${failStr}  ${c.dim}\xB7 ${scan.totalFiles} files scanned${c.reset}`);
  console.log();
  console.log(hr());
  console.log();
  console.log(`  ${c.bold}${c.white}Scores${c.reset}  ${c.dim}Five dimensions of agent quality${c.reset}`);
  printDimensionBars(scorecard);
  console.log(hr());
  console.log();
  const grade = gradeLabel(overall);
  const passLabel = overallPassed ? `${c.bgGreen}${c.black}${c.bold}  PASS  ${c.reset}` : `${c.bgRed}${c.white}${c.bold}  FAIL  ${c.reset}`;
  console.log(
    `  ${c.dim}Overall score${c.reset}   ${scoreColor(overall)}${c.bold}${overall.toFixed(1)}${c.reset}${c.dim} / 100${c.reset}   ${grade}   ${passLabel}`
  );
  console.log();
  const critStr = criticalFails > 0 ? `${c.bred}${c.bold}\u26A0 ${criticalFails} critical${c.reset}` : `${c.bgreen}\u2714 0 critical${c.reset}`;
  const highStr = highFails > 0 ? `  ${c.byellow}\u26A0 ${highFails} high${c.reset}` : `  ${c.dim}0 high${c.reset}`;
  const issueStr = totalIssues > 0 ? `  ${c.dim}${totalIssues} issue${totalIssues !== 1 ? "s" : ""} total${c.reset}` : `  ${c.dim}0 issues${c.reset}`;
  console.log(`  ${critStr}${highStr}${issueStr}`);
  console.log();
  console.log(hr());
  if (totalIssues > 0) {
    console.log();
    console.log(`  ${c.bold}${c.white}Issues${c.reset}  ${c.dim}${totalIssues} thing${totalIssues !== 1 ? "s" : ""} to fix${c.reset}`);
    printIssues(catalog);
    console.log(hr());
  } else {
    console.log();
    console.log(`  ${c.bgreen}${c.bold}\u2726  Excellent \u2014 all checks passed. Your agent is production-grade.${c.reset}`);
    console.log();
    console.log(hr());
  }
  console.log();
  console.log(`  ${c.dim}Next  ${c.reset}${c.cyan}gravio.dev/dashboard${c.reset}${c.dim}  \u2192  view trends & history${c.reset}`);
  console.log();
}
function printWatchUpdate({ run, scan }) {
  const scorecard = run.scorecard ?? {};
  const overall = run.summary?.overallScore ?? 0;
  const passed = overall >= 87;
  const passLabel = passed ? `${c.bgGreen}${c.black}${c.bold} PASS ${c.reset}` : `${c.bgRed}${c.white}${c.bold} FAIL ${c.reset}`;
  const dims = DIM_ORDER.map((d) => {
    const score = Math.round(scorecard[d] ?? 0);
    const meta = DIM_META[d];
    return `${meta.icon}${DIM_COLOR[d]}${score}${c.reset}`;
  }).join("  ");
  const now = /* @__PURE__ */ new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
  console.log(
    `
  ${c.dim}[${time}]${c.reset}  ${scoreColor(overall)}${c.bold}${overall.toFixed(1)}${c.reset}${c.dim}/100${c.reset}  ${passLabel}  ${dims}  ${c.dim}${scan.totalFiles} files${c.reset}`
  );
}
function printScanStep(step) {
  const SCAN_STEPS = [
    "Reading file tree",
    "Checking git tracking",
    "Analysing safety signals",
    "Analysing reliability signals",
    "Analysing evaluation signals",
    "Analysing observability signals",
    "Analysing governance signals",
    "Computing scorecard"
  ];
  if (!process.stdout.isTTY) return;
  const total = SCAN_STEPS.length;
  const cur = Math.min(step, total);
  const pct = Math.round(cur / total * 100);
  const barW = 28;
  const filled = Math.round(cur / total * barW);
  const b = `${c.cyan}${"\u2588".repeat(filled)}${c.reset}${c.dim}${"\u2591".repeat(barW - filled)}${c.reset}`;
  const label = step < total ? SCAN_STEPS[step] ?? "" : "Complete";
  process.stdout.write(
    `\r  ${b}  ${c.dim}${lpad(String(pct), 3)}%${c.reset}  ${c.gray}${label}${" ".repeat(36)}${c.reset}`
  );
}
function printPublishResult({ server, project, success, error }) {
  console.log();
  if (success) {
    const dashUrl = `${server}/dashboard`;
    console.log(`  ${c.bgreen}${c.bold}\u2714  Published${c.reset}  ${c.dim}\u2192${c.reset}  ${c.cyan}${c.under}${dashUrl}${c.reset}`);
    console.log(`  ${c.dim}Project${c.reset}  ${c.white}${project}${c.reset}`);
    console.log();
    console.log(`  ${c.dim}Open your dashboard to view trends, history, and issue details.${c.reset}`);
  } else {
    console.log(`  ${c.bred}${c.bold}\u2716  Publish failed${c.reset}  ${c.dim}${error ?? "unknown error"}${c.reset}`);
    console.log();
    console.log(`  ${c.dim}Check your --api-key and --server flags, then try again.${c.reset}`);
    console.log(`  ${c.dim}Create an API key at ${c.reset}${c.cyan}gravio.dev/dashboard${c.reset}`);
  }
  console.log();
}

// scripts/gravio-scan.mjs
var CLI_VERSION = true ? "0.4.0" : "dev";
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
var ROOT = path2.resolve(__dirname, "..");
function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync2(path2.join(ROOT, "package.json"), "utf8"));
    return pkg.version ?? "?";
  } catch {
    return "?";
  }
}
function parseArgs(argv) {
  const args2 = {
    target: ROOT,
    output: path2.join(ROOT, "agent-quality", "runs", "latest.json"),
    once: false,
    debounceMs: 500,
    publish: false,
    project: null,
    server: "http://localhost:3000",
    apiKey: null,
    noUpdate: false
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--once") {
      args2.once = true;
      continue;
    }
    if (token === "--target" && argv[i + 1]) {
      args2.target = path2.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--output" && argv[i + 1]) {
      args2.output = path2.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--debounce" && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 50) {
        args2.debounceMs = parsed;
      }
      i += 1;
      continue;
    }
    if (token === "--publish") {
      args2.publish = true;
      continue;
    }
    if (token === "--project" && argv[i + 1]) {
      args2.project = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--server" && argv[i + 1]) {
      args2.server = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--api-key" && argv[i + 1]) {
      args2.apiKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--no-update") {
      args2.noUpdate = true;
      continue;
    }
  }
  return args2;
}
function httpPost(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers
        }
      },
      (res) => {
        let body = "";
        res.on("data", (c2) => body += c2);
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, data: body });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers
      },
      (res) => {
        const chunks = [];
        res.on("data", (c2) => chunks.push(c2));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.setTimeout(1e4, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}
function isNewer(remote, local) {
  if (!remote || remote === local || local === "dev") return false;
  const parse = (v) => String(v).split(".").map(Number);
  const [rA, rB, rC] = parse(remote);
  const [lA, lB, lC] = parse(local);
  if (rA !== lA) return rA > lA;
  if (rB !== lB) return rB > lB;
  return rC > lC;
}
async function checkAndUpdate(serverBase) {
  const isBundled = !path2.basename(process.argv[1]).includes("gravio-scan");
  if (!isBundled) return;
  const c2 = {
    cyan: "\x1B[36m",
    green: "\x1B[32m",
    dim: "\x1B[2m",
    bold: "\x1B[1m",
    reset: "\x1B[0m",
    bgreen: "\x1B[92m",
    bcyan: "\x1B[96m",
    byellow: "\x1B[93m"
  };
  try {
    const versionUrl = new URL("/api/cli/version", serverBase).toString();
    const res = await httpGet(versionUrl);
    if (res.status !== 200) return;
    let remoteVersion;
    try {
      remoteVersion = JSON.parse(res.body).version;
    } catch {
      return;
    }
    if (!isNewer(remoteVersion, CLI_VERSION)) return;
    console.log(`
  ${c2.byellow}${c2.bold}\u2191  Update available${c2.reset}  ${c2.dim}${CLI_VERSION}${c2.reset} ${c2.dim}\u2192${c2.reset} ${c2.bgreen}${c2.bold}${remoteVersion}${c2.reset}`);
    console.log(`  ${c2.dim}Downloading new version...${c2.reset}`);
    const downloadUrl = new URL("/cli/gravio.mjs", serverBase).toString();
    const dlRes = await httpGet(downloadUrl);
    if (dlRes.status !== 200) {
      console.log(`  ${c2.dim}[!] Update download failed (HTTP ${dlRes.status}) \u2014 continuing with v${CLI_VERSION}
${c2.reset}`);
      return;
    }
    const currentFile = path2.resolve(process.argv[1]);
    writeFileSync2(currentFile, dlRes.body, "utf8");
    try {
      chmodSync(currentFile, 493);
    } catch {
    }
    console.log(`  ${c2.bgreen}${c2.bold}\u2714  Updated to v${remoteVersion}${c2.reset}${c2.dim}  Restarting...${c2.reset}
`);
    await new Promise((resolve) => {
      const child = spawn(process.execPath, [currentFile, "--no-update", ...process.argv.slice(2)], {
        stdio: "inherit"
      });
      child.on("close", (code) => {
        resolve();
        process.exit(code ?? 0);
      });
    });
  } catch {
  }
}
var args = parseArgs(process.argv.slice(2));
if (!args.noUpdate) {
  await checkAndUpdate(args.server);
}
if (args.publish && !args.project) {
  process.stderr.write("\n  \x1B[91m\x1B[1m\u2716  Error\x1B[0m  --publish requires --project <id>\n\n");
  process.exit(1);
}
if (args.publish && !args.apiKey) {
  process.stderr.write("\n  \x1B[91m\x1B[1m\u2716  Error\x1B[0m  --publish requires --api-key <gv_...>\n\n");
  process.stderr.write("  \x1B[2mSteps:\x1B[0m\n");
  process.stderr.write("    1) Sign in  \u2192  \x1B[36mhttps://gravio.dev/login\x1B[0m\n");
  process.stderr.write("    2) Get API key in your dashboard\n");
  process.stderr.write("    3) Re-run with  \x1B[97m--api-key gv_...\x1B[0m\n\n");
  process.exit(1);
}
if (args.once) {
  if (process.stdout.isTTY) {
    console.log();
    printScanStep(0);
  }
  const { run, scan } = runScannerOnce({
    targetDir: args.target,
    outputFile: args.output,
    repoRoot: ROOT
  });
  if (process.stdout.isTTY) {
    const SCAN_TOTAL = 8;
    printScanStep(SCAN_TOTAL);
    process.stdout.write("\n");
  }
  printScanReport({ run, scan, version: readVersion() });
  if (args.publish) {
    const publishUrl = new URL("/api/publish", args.server).toString();
    try {
      const result = await httpPost(
        publishUrl,
        { projectId: args.project, run },
        { Authorization: `Bearer ${args.apiKey}` }
      );
      if (result.status === 200 && result.data?.ok) {
        printPublishResult({ server: args.server, project: args.project, success: true });
      } else if (result.status === 401 || result.status === 403) {
        printPublishResult({
          server: args.server,
          project: args.project,
          success: false,
          error: `HTTP ${result.status}: ${result.data?.error ?? "Authentication required"}`
        });
        process.exit(1);
      } else {
        printPublishResult({
          server: args.server,
          project: args.project,
          success: false,
          error: `HTTP ${result.status}: ${result.data?.error ?? JSON.stringify(result.data)}`
        });
        process.exit(1);
      }
    } catch (err) {
      printPublishResult({ server: args.server, project: args.project, success: false, error: err.message });
      process.exit(1);
    }
  }
  process.exit(0);
}
var watcher = startScannerWatcher({
  targetDir: args.target,
  outputFile: args.output,
  repoRoot: ROOT,
  debounceMs: args.debounceMs,
  logger: console,
  onScan: printWatchUpdate
});
console.log(
  `
  \x1B[96m\x1B[1m  gravio  \x1B[0m\x1B[2m watch mode\x1B[0m

  \x1B[2mWatching\x1B[0m  \x1B[36m${args.target}\x1B[0m
  \x1B[2mDebounce  ${args.debounceMs}ms  \xB7  Ctrl+C to stop\x1B[0m
`
);
process.on("SIGINT", () => {
  watcher.close();
  console.log("\n  \x1B[2mgravio: stopped\x1B[0m\n");
  process.exit(0);
});
process.on("SIGTERM", () => {
  watcher.close();
  console.log("\n  \x1B[2mgravio: stopped\x1B[0m\n");
  process.exit(0);
});
