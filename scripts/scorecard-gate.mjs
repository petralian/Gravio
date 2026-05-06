#!/usr/bin/env node
/**
 * scorecard-gate.mjs
 * Self-quality gate for the Agent Scorecard Platform.
 * Run: node scripts/scorecard-gate.mjs
 * Exits 0 = PASS, exits 1 = FAIL.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function load(rel) {
  return JSON.parse(readFileSync(path.join(ROOT, rel), "utf8"));
}

const run = load("agent-quality/runs/latest.json");
const baseline = load("agent-quality/baseline.json");
const weights = load("agent-quality/scorecard/weights.json").weights;
const corpus = load("agent-quality/evals/workflow-corpus.json");
const shipReadyMode = process.argv.includes("--ship-ready") || process.env.SHIP_READY === "1";

let pass = true;
const failures = [];

// 1. Compute weighted score
const scorecard = run.scorecard ?? {};
let overallScore = 0;
for (const [dim, w] of Object.entries(weights)) {
  overallScore += (scorecard[dim] ?? 0) * w;
}
overallScore = parseFloat(overallScore.toFixed(2));

console.log(`\nAgent Scorecard Platform — Quality Gate`);
console.log(`────────────────────────────────────────`);
console.log(`Run: ${run.runId}`);
console.log(`Score: ${overallScore}`);
console.log(``);

// 2. Gate: minimum overall score
if (overallScore < baseline.minimumOverallScore) {
  failures.push(`Score ${overallScore} < minimum ${baseline.minimumOverallScore}`);
  pass = false;
}

// 3. Gate: workflow pass rate
const wfResults = run.workflowResults ?? [];
const wfPassed = wfResults.filter((w) => w.status === "pass").length;
const wfRate = wfResults.length > 0 ? wfPassed / wfResults.length : 0;
if (wfRate < baseline.minimumWorkflowPassRate) {
  failures.push(`Workflow pass rate ${(wfRate * 100).toFixed(1)}% < minimum ${baseline.minimumWorkflowPassRate * 100}%`);
  pass = false;
}

// 4. Gate: minimum safety score
const safetyScore = scorecard.safety ?? 0;
if (safetyScore < baseline.minimumSafetyScore) {
  failures.push(`Safety score ${safetyScore} < minimum ${baseline.minimumSafetyScore}`);
  pass = false;
}

// 5. Gate: critical adversarial failures
const advResults = run.adversarialResults ?? [];
const critFailures = advResults.filter((a) => a.status === "fail").length;
if (critFailures > baseline.maximumCriticalAdversarialFailures) {
  failures.push(`${critFailures} critical adversarial failure(s) found (max: ${baseline.maximumCriticalAdversarialFailures})`);
  pass = false;
}

// 6. Validate required workflows present
for (const wf of corpus.workflows) {
  const result = wfResults.find((r) => r.id === wf.id);
  if (!result) {
    const msg = `Workflow '${wf.id}' missing from run results`;
    if (wf.critical) {
      failures.push(`[CRITICAL] ${msg}`);
      pass = false;
    } else {
      console.warn(`  WARN: ${msg}`);
    }
  } else if (result.status === "fail" && wf.critical) {
    failures.push(`[CRITICAL] Workflow '${wf.id}' failed`);
    pass = false;
  }
}

// 7. Validate trace attributes
const traces = run.traces ?? [];
const requiredAttrs = [
  "gen_ai.operation.name",
  "gen_ai.request.model",
  "vouch.agent.run_id",
  "vouch.agent.workflow_id",
  "vouch.agent.session_id",
  "vouch.agent.files_changed",
  "vouch.agent.deploy_needed",
];
for (const trace of traces) {
  for (const attr of requiredAttrs) {
    if (trace.attributes?.[attr] === undefined) {
      failures.push(`Trace '${trace.span_id}' missing attribute: ${attr}`);
      pass = false;
    }
  }
}

// 8. Ship-ready gate: billing security env vars
const requiredBillingEnv = [
  "LEMON_API_KEY",
  "LEMON_STORE_ID",
  "LEMON_TEAM_VARIANT_ID",
  "LEMON_WEBHOOK_SECRET",
];
const missingBillingEnv = requiredBillingEnv.filter((name) => !String(process.env[name] ?? "").trim());
if (shipReadyMode && missingBillingEnv.length > 0) {
  failures.push(`Ship-ready billing gate failed: missing env ${missingBillingEnv.join(", ")}`);
  pass = false;
}

// Print gate results
console.log(`Gates:`);
console.log(`  Score ${overallScore} >= ${baseline.minimumOverallScore}: ${overallScore >= baseline.minimumOverallScore ? "PASS" : "FAIL"}`);
console.log(`  Workflow pass rate ${(wfRate * 100).toFixed(1)}% >= ${baseline.minimumWorkflowPassRate * 100}%: ${wfRate >= baseline.minimumWorkflowPassRate ? "PASS" : "FAIL"}`);
console.log(`  Safety ${safetyScore} >= ${baseline.minimumSafetyScore}: ${safetyScore >= baseline.minimumSafetyScore ? "PASS" : "FAIL"}`);
console.log(`  Critical adversarial failures ${critFailures} <= ${baseline.maximumCriticalAdversarialFailures}: ${critFailures <= baseline.maximumCriticalAdversarialFailures ? "PASS" : "FAIL"}`);
console.log(`  Ship-ready billing env (${shipReadyMode ? "ENFORCED" : "informational"}): ${missingBillingEnv.length === 0 ? "PASS" : `MISSING ${missingBillingEnv.join(", ")}`}`);
console.log(``);

if (failures.length > 0) {
  console.error(`FAILED (${failures.length} issue(s)):`);
  for (const f of failures) {
    console.error(`  ✗ ${f}`);
  }
  process.exit(1);
} else {
  console.log(`PASSED — all ${wfPassed} workflows, score ${overallScore}, safety ${safetyScore}`);
  process.exit(0);
}
