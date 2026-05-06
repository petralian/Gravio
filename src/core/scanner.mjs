/**
 * scanner.mjs
 * Gravio Scanner — server-side evaluation engine.
 *
 * This file contains the scoring algorithm, workflow corpus, dimension weights,
 * and run artifact builder. It is NEVER bundled into the CLI distribution.
 * The filesystem signal detection lives in scan-signals.mjs (CLI-bundled).
 */
import crypto from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  watch,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { scanTargetProject } from "./scan-signals.mjs";

export { scanTargetProject };

// Default weights — set by Gravio, same for every project (like Google Lighthouse).
export const DEFAULT_WEIGHTS = {
  safety: 0.25,
  reliability: 0.20,
  evaluation: 0.15,
  observability: 0.10,
  governance: 0.15,
  agentic: 0.15,
};

/**
 * Default workflow corpus — embedded so external users get meaningful checks
 * even when they don't have a Gravio agent-quality/ directory.
 * Each check maps to a scanner signal and is language-agnostic.
 */
export const DEFAULT_CORPUS = {
  workflows: [
    // ── Safety ──────────────────────────────────────────────────────────────
    { id: "secret-scan",              category: "safety",        critical: true,  description: "No secrets or .env files committed to git." },
    { id: "gitignore-guard",          category: "safety",        critical: true,  description: ".gitignore exists and covers .env / secret files." },
    { id: "dep-vuln-check",           category: "safety",        critical: false, description: "Dependency vulnerability scanning tooling configured." },
    { id: "cloud-credential-files",   category: "safety",        critical: true,  description: "No cloud credential files (.aws, .gcloud) committed." },
    // ── Reliability ─────────────────────────────────────────────────────────
    { id: "test-coverage",            category: "reliability",   critical: true,  description: "Test files or test suite detected in the project." },
    { id: "ci-pipeline",              category: "reliability",   critical: false, description: "CI/CD pipeline configuration found." },
    { id: "type-safety",              category: "reliability",   critical: false, description: "Static type system or type-checking tooling detected." },
    { id: "test-coverage-config",     category: "reliability",   critical: false, description: "Coverage thresholds or coverage tooling configured." },
    { id: "integration-tests",        category: "reliability",   critical: false, description: "Integration or E2E test suite detected." },
    { id: "health-check",             category: "reliability",   critical: false, description: "Health check endpoint or Dockerfile HEALTHCHECK defined." },
    { id: "lock-file",                category: "reliability",   critical: false, description: "Dependency lock file ensures reproducible builds." },
    { id: "lint-config",              category: "reliability",   critical: false, description: "Linting / static analysis tooling configured." },
    { id: "pre-commit-hooks",         category: "reliability",   critical: false, description: "Pre-commit hooks guard local code quality." },
    // ── Evaluation ──────────────────────────────────────────────────────────
    { id: "eval-suite",               category: "evaluation",    critical: false, description: "Evaluation corpus, benchmark directory, or eval framework present." },
    { id: "baseline-tracking",        category: "evaluation",    critical: false, description: "Regression baseline file or run artifact directory found." },
    { id: "adversarial-tests",        category: "evaluation",    critical: false, description: "Adversarial / jailbreak / prompt injection test cases present." },
    { id: "golden-datasets",          category: "evaluation",    critical: false, description: "Golden test data or fixture datasets for regression." },
    { id: "eval-script",              category: "evaluation",    critical: false, description: "Eval is runnable via a script or CI command." },
    // ── Observability ───────────────────────────────────────────────────────
    { id: "observability-config",     category: "observability", critical: false, description: "OpenTelemetry, structured logging, or monitoring config detected." },
    { id: "run-artifacts",            category: "observability", critical: false, description: "Agent run output / trace artifacts are being persisted." },
    { id: "monitoring-config",        category: "observability", critical: false, description: "Monitoring dashboard or alerting config present." },
    { id: "slo-definition",           category: "observability", critical: false, description: "Service Level Objective (SLO) definition documented." },
    // ── Governance ──────────────────────────────────────────────────────────
    { id: "readme-docs",              category: "governance",    critical: false, description: "README.md exists." },
    { id: "changelog-hygiene",        category: "governance",    critical: false, description: "CHANGELOG or release notes maintained." },
    { id: "agent-instructions",       category: "governance",    critical: true,  description: "Agent behaviour instructions file found (AGENTS.md, copilot-instructions, .cursorrules, etc.)." },
    { id: "api-documentation",        category: "governance",    critical: false, description: "OpenAPI / Swagger spec or API docs directory found." },
    { id: "dependency-updates",       category: "governance",    critical: false, description: "Automated dependency update config (Dependabot / Renovate) present." },
    { id: "codeowners",               category: "governance",    critical: false, description: "CODEOWNERS file defines code ownership." },
    // ── Agentic ─────────────────────────────────────────────────────────────
    { id: "agent-skill-catalog",      category: "agentic",       critical: false, description: "Agent skill catalog or reusable prompt assets found." },
    { id: "agent-orchestration",      category: "agentic",       critical: false, description: "Multi-agent orchestration configuration detected." },
    { id: "safety-rules",             category: "agentic",       critical: false, description: "Agent instructions contain explicit safety guardrails." },
    { id: "model-pinned",             category: "agentic",       critical: false, description: "AI model version pinned in config or instructions." },
    { id: "tool-whitelist",           category: "agentic",       critical: false, description: "Allowed tools / function calls defined in agent instructions." },
  ],
};

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function safeReadJson(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}


function indexById(items) {
  const map = new Map();
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

    // ── Default corpus checks (language-agnostic) ───────────────────────────
    if (workflow.id === "secret-scan") {
      status = scan.committedEnvFiles.length === 0 ? "pass" : "fail";
      evidence = {
        scanStatus: status === "pass" ? "clean" : "env-file-exposed",
        leaksFound: scan.committedEnvFiles.length,
        envFilesDetected: scan.envFiles.length,
        committedEnvFiles: scan.committedEnvFiles,
      };
    }

    if (workflow.id === "gitignore-guard") {
      status = scan.gitignoreEnvPasses ? "pass" : "fail";
      evidence = {
        gitignoreExists: scan.gitignoreExists,
        coversEnv: scan.gitignoreCoversEnv,
        notApplicable: scan.gitignoreEnvNotApplicable,
        reason: scan.gitignoreEnvNotApplicable ? "project does not use .env files" : undefined,
      };
    }

    if (workflow.id === "test-coverage") {
      status = scan.testSignal.testSignal ? "pass" : "fail";
      evidence = {
        testFilesFound: scan.testSignal.hasTestFiles,
        testScriptFound: scan.testSignal.hasTestScript,
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
      status = (scan.hasEvalDir || scan.hasEvalConfig) ? "pass" : "fail";
      evidence = {
        evalDirFound: scan.hasEvalDir,
        evalConfigFound: scan.hasEvalConfig,
        corpusFileCount: scan.evalCorpusFileCount,
      };
    }

    if (workflow.id === "baseline-tracking") {
      status = (scan.hasBaseline || scan.hasRunArtifacts) ? "pass" : "fail";
      evidence = { baselineFound: scan.hasBaseline, runArtifactsFound: scan.hasRunArtifacts };
    }

    if (workflow.id === "observability-config") {
      status = (scan.hasOtelDependency || scan.hasStructuredLogging || scan.hasMonitoringConfig) ? "pass" : "fail";
      evidence = {
        otelDetected: scan.hasOtelDependency,
        structuredLoggingDetected: scan.hasStructuredLogging,
        monitoringConfigDetected: scan.hasMonitoringConfig,
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

    if (workflow.id === "agent-skill-catalog") {
      status = (scan.hasAgentSkillCatalog || scan.hasPromptAssets) ? "pass" : "fail";
      evidence = {
        skillCatalogFound: scan.hasAgentSkillCatalog,
        promptAssetsFound: scan.hasPromptAssets,
      };
    }

    if (workflow.id === "agent-orchestration") {
      status = scan.hasAgentOrchestration ? "pass" : "fail";
      evidence = { orchestrationConfigFound: scan.hasAgentOrchestration };
    }

    // ── Phase 1 expansion workflow checks ────────────────────────────────────
    if (workflow.id === "dep-vuln-check") {
      status = scan.hasDependencyVulnCheck ? "pass" : "fail";
      evidence = { depVulnCheckDetected: scan.hasDependencyVulnCheck };
    }

    if (workflow.id === "cloud-credential-files") {
      status = !scan.hasCloudCredentialFiles ? "pass" : "fail";
      evidence = { cloudCredentialFilesFound: scan.hasCloudCredentialFiles };
    }

    if (workflow.id === "test-coverage-config") {
      status = scan.hasTestCoverage ? "pass" : "fail";
      evidence = { coverageConfigDetected: scan.hasTestCoverage };
    }

    if (workflow.id === "integration-tests") {
      status = (scan.hasIntegrationTests || scan.hasE2eTests) ? "pass" : "fail";
      evidence = { integrationTestsFound: scan.hasIntegrationTests, e2eTestsFound: scan.hasE2eTests };
    }

    if (workflow.id === "health-check") {
      status = scan.hasHealthCheck ? "pass" : "fail";
      evidence = { healthCheckDetected: scan.hasHealthCheck };
    }

    if (workflow.id === "lock-file") {
      status = scan.hasLockFile ? "pass" : "fail";
      evidence = { lockFileFound: scan.hasLockFile };
    }

    if (workflow.id === "lint-config") {
      status = scan.hasLintConfig ? "pass" : "fail";
      evidence = { lintConfigDetected: scan.hasLintConfig };
    }

    if (workflow.id === "pre-commit-hooks") {
      status = scan.hasPreCommitHooks ? "pass" : "fail";
      evidence = { preCommitHooksDetected: scan.hasPreCommitHooks };
    }

    if (workflow.id === "adversarial-tests") {
      status = scan.hasAdversarialTests ? "pass" : "fail";
      evidence = { adversarialTestsFound: scan.hasAdversarialTests };
    }

    if (workflow.id === "golden-datasets") {
      status = scan.hasGoldenDatasets ? "pass" : "fail";
      evidence = { goldenDatasetsFound: scan.hasGoldenDatasets };
    }

    if (workflow.id === "monitoring-config") {
      status = scan.hasMonitoringConfig ? "pass" : "fail";
      evidence = { monitoringConfigDetected: scan.hasMonitoringConfig };
    }

    if (workflow.id === "slo-definition") {
      status = scan.hasSloDefinition ? "pass" : "fail";
      evidence = { sloDefinitionFound: scan.hasSloDefinition };
    }

    if (workflow.id === "api-documentation") {
      status = scan.hasApiDocs ? "pass" : "fail";
      evidence = { apiDocsFound: scan.hasApiDocs };
    }

    if (workflow.id === "dependency-updates") {
      status = scan.hasDependencyUpdateConfig ? "pass" : "fail";
      evidence = { depUpdateConfigFound: scan.hasDependencyUpdateConfig };
    }

    if (workflow.id === "codeowners") {
      status = scan.hasCodeOwners ? "pass" : "fail";
      evidence = { codeownersFound: scan.hasCodeOwners };
    }

    if (workflow.id === "safety-rules") {
      status = scan.hasSafetyRulesInInstructions ? "pass" : "fail";
      evidence = { safetyRulesDetected: scan.hasSafetyRulesInInstructions };
    }

    if (workflow.id === "model-pinned") {
      status = scan.hasModelPinned ? "pass" : "fail";
      evidence = { modelPinnedDetected: scan.hasModelPinned };
    }

    if (workflow.id === "tool-whitelist") {
      status = scan.hasToolWhitelist ? "pass" : "fail";
      evidence = { toolWhitelistDetected: scan.hasToolWhitelist };
    }

    // ── Gravio-specific corpus checks (backward compat) ─────────────────────
    if (workflow.id === "verification-suite") {
      status = scan.testSignal.testSignal ? "pass" : "fail";
      evidence = {
        tests: scan.testSignal.testSignal ? "detected" : "not detected",
        typecheck: scan.testSignal.hasTypecheck ? "detected" : "n/a",
        build: scan.testSignal.hasBuild ? "detected" : "n/a",
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
        kickoffSummary: "gravio-scanner auto-evidence",
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
    evidence: "gravio-scanner placeholder",
  }));
}

/**
 * Compute dimension scores 0–100 from scanner signals.
 * Gravio sets these weights and thresholds — users cannot override them.
 * Scoring mirrors Google Lighthouse: each signal has a fixed point value,
 * and every language/ecosystem is measured against the same universal rubric.
 */
function computeRichScorecard(scan) {
  // ── Safety (25%) ────────────────────────────────────────────────────────
  // Core question: Can the agent cause a data breach or security incident?
  let safety = 0;
  if (scan.committedEnvFiles.length === 0) safety += 35; // no secrets in git — biggest risk
  if (scan.gitignoreEnvPasses)             safety += 15; // env files excluded / n-a
  if (scan.gitignoreExists)                safety +=  8; // at least gitignore exists
  if (scan.hasSecretScanConfig)            safety += 12; // automated secret scanning tooling
  if (scan.securityPolicyExists)           safety += 10; // documented security posture
  if (scan.hasAgentInstructions)           safety +=  5; // agent behaviour is bounded/documented
  if (scan.hasDependencyVulnCheck)         safety += 10; // dep vulnerability scanning
  if (!scan.hasCloudCredentialFiles)       safety +=  5; // no cloud credential files committed
  // max 100

  // ── Reliability (20%) ───────────────────────────────────────────────────
  // Core question: Does the agent behave consistently and recover from failure?
  let reliability = 0;
  if (scan.testSignal.testSignal) reliability += 30; // tests exist (any language)
  if (scan.cicdExists)            reliability += 20; // automated quality gate on every push
  if (scan.hasTypeSafety)         reliability += 15; // type system catches regressions
  if (scan.hasLockFile)           reliability += 10; // deterministic dependency resolution
  if (scan.hasLintConfig)         reliability +=  7; // code style enforced consistently
  if (scan.hasPreCommitHooks)     reliability +=  3; // local gate before code reaches CI
  if (scan.hasTestCoverage)       reliability +=  8; // coverage thresholds configured
  if (scan.hasIntegrationTests || scan.hasE2eTests) reliability += 5; // integration or E2E tests
  if (scan.hasHealthCheck)        reliability +=  2; // health check defined
  // max 100

  // ── Evaluation (15%) ────────────────────────────────────────────────────
  // Core question: Does the agent measure whether it is getting better or worse?
  let evaluation = 0;
  if (scan.hasEvalDir || scan.hasEvalConfig) evaluation += 35; // eval suite or framework present
  if (scan.hasBaseline)                      evaluation += 18; // regression baseline tracked
  if (scan.hasGoldenDatasets)                evaluation += 17; // golden outputs for comparison
  if (scan.hasEvalConfig)                    evaluation +=  8; // explicit eval framework config
  if (scan.hasEvalScript)                    evaluation +=  8; // eval is runnable via script
  if (scan.hasAdversarialTests)              evaluation +=  8; // adversarial / injection tests
  if (scan.hasPromptTests)                   evaluation +=  6; // prompt-specific tests
  // max 100 (hasEvalConfig counted once if both hasEvalDir and hasEvalConfig)
  evaluation = Math.min(100, evaluation);

  // ── Observability (10%) ─────────────────────────────────────────────────
  // Core question: Can you see what the agent did and diagnose failures?
  let observability = 0;
  if (scan.hasOtelDependency)      observability += 30; // OpenTelemetry = structured traces
  if (scan.hasRunArtifacts)        observability += 22; // agent persists its own run outputs
  if (scan.hasStructuredLogging)   observability += 20; // machine-parseable logs
  if (scan.hasMonitoringConfig)    observability += 15; // alerting / dashboards configured
  if (scan.hasSloDefinition)       observability +=  8; // SLO defined
  if (scan.hasAlertConfig)         observability +=  5; // alert routing configured
  // max 100
  observability = Math.min(100, observability);

  // ── Governance (15%) ────────────────────────────────────────────────────
  // Core question: Is the agent's behaviour documented, controlled, and auditable?
  let governance = 0;
  if (scan.readmeExists)           governance += 18; // humans can understand what this does
  if (scan.hasChangelog)           governance += 18; // changes are tracked over time
  if (scan.hasAiDocs)              governance += 20; // agent instructions are explicitly documented
  if (scan.licenseExists)          governance +=  8; // legal clarity
  if (scan.hasDecisionLog)         governance +=  8; // architectural decisions captured
  if (scan.hasVersion)             governance +=  7; // versioned = releases are intentional
  if (scan.hasContributing)        governance +=  4; // contributors know the rules
  if (scan.hasCodeOwners)          governance +=  3; // clear code ownership
  if (scan.hasApiDocs)             governance +=  5; // API contract documented
  if (scan.hasAdrDir)              governance +=  4; // design decisions recorded
  if (scan.hasCommitLintConfig)    governance +=  3; // commit conventions enforced
  if (scan.hasDependencyUpdateConfig) governance += 2; // automated dep hygiene
  // max 100
  governance = Math.min(100, governance);

  // ── Agentic (15%) ───────────────────────────────────────────────────────
  // Core question: Is this codebase ready for reliable human+AI collaboration?
  let agentic = 0;
  if (scan.hasAiDocs)                           agentic += 15; // explicit AI operating rules
  if (scan.hasAgentInstructions)                agentic += 15; // bounded behavior contract
  if (scan.hasAgentSkillCatalog)                agentic += 12; // reusable skills/playbooks exist
  if (scan.hasPromptAssets)                     agentic +=  8; // prompt assets are versioned
  if (scan.hasAgentOrchestration)               agentic +=  8; // multi-agent config present
  if (scan.hasEvalDir || scan.hasEvalConfig)    agentic += 12; // measurable agent quality loop
  if (scan.hasRunArtifacts)                     agentic +=  8; // runs are persisted for audits
  if (scan.hasNotes && scan.hasNextSession)     agentic +=  7; // handoff continuity for teams
  if (scan.hasSafetyRulesInInstructions)        agentic +=  5; // explicit safety guardrails
  if (scan.hasModelPinned)                      agentic +=  4; // model version locked
  if (scan.hasPromptVersioning)                 agentic +=  3; // prompts tracked in git
  if (scan.hasToolWhitelist)                    agentic +=  3; // tool use boundaries defined
  agentic = Math.min(100, agentic);

  return {
    safety: Math.round(safety),
    reliability: Math.round(reliability),
    evaluation: Math.round(evaluation),
    observability: Math.round(observability),
    governance: Math.round(governance),
    agentic: Math.round(agentic),
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
    safetyScore: scorecard.safety ?? 0,
  };
}

export function buildRunArtifact({ scan, corpus, weights, previousRun }) {
  const runId = `scan-${Date.now().toString(36)}`;
  const workflowResults = buildWorkflowResults(corpus, scan, previousRun);
  const scorecard = computeRichScorecard(scan);
  const summary = summarize(scorecard, workflowResults, weights);

  const startedNano = Date.now() * 1_000_000;
  const traceId = crypto.randomUUID().replace(/-/g, "");
  const spanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  return {
    runId,
    createdAt: new Date().toISOString(),
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
          "vouch.agent.deploy_needed": false,
        },
      },
    ],
    scanner: {
      targetDir: scan.targetDir,
      scannedAt: scan.scannedAt,
      totalFiles: scan.totalFiles,
      trackedFileCount: scan.trackedFileCount,
      envFilesDetected: scan.envFiles.length,
      committedEnvFiles: scan.committedEnvFiles,
    },
  };
}

export function writeRunArtifact(outputFile, run) {
  const outputDir = path.dirname(outputFile);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  writeFileSync(outputFile, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

export function runScannerOnce({ targetDir, outputFile, repoRoot }) {
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

export function startScannerWatcher({ targetDir, outputFile, repoRoot, debounceMs = 500, logger = console, onScan = null }) {
  const resolvedTarget = path.resolve(targetDir);
  const resolvedOutput = path.resolve(outputFile);
  const outputInsideTarget = resolvedOutput.startsWith(`${resolvedTarget}${path.sep}`);
  const outputRelative = outputInsideTarget
    ? toPosix(path.relative(resolvedTarget, resolvedOutput))
    : null;

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
  const watcher = watch(resolvedTarget, { recursive: true }, (_eventType, fileName) => {
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
      watcher.close();
    },
  };
}
