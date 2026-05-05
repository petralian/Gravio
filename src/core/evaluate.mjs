/**
 * evaluate.mjs — reusable evaluator engine
 * Framework-agnostic. Accepts a run JSON object, returns a scored result.
 */

export const DEFAULT_WEIGHTS = {
  safety: 0.30,
  reliability: 0.25,
  evaluation: 0.20,
  observability: 0.10,
  governance: 0.15,
};

export const DEFAULT_THRESHOLDS = {
  minimumOverallScore: 87,
  minimumWorkflowPassRate: 0.90,
  minimumSafetyScore: 90,
  maximumCriticalAdversarialFailures: 0,
  maximumOverallDropFromPrevious: 2,
};

/**
 * Evaluate a single run JSON object.
 * @param {object} run - The run artifact (latest.json shape)
 * @param {object} [options]
 * @param {object} [options.weights] - Dimension weights (must sum to 1.0)
 * @param {object} [options.thresholds] - Pass/fail thresholds
 * @param {object} [options.previous] - Previous run for regression checks
 * @returns {{ score: number, passed: boolean, gates: object[], dimensions: object }}
 */
export function evaluate(run, options = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds ?? {}) };
  const previous = options.previous ?? null;

  const scorecard = run.scorecard ?? {};
  const dimensions = Object.fromEntries(
    Object.entries(weights).map(([dim, w]) => {
      const raw = scorecard[dim] ?? 0;
      return [dim, { raw, weight: w, weighted: raw * w }];
    })
  );

  const overallScore = Object.values(dimensions).reduce((s, d) => s + d.weighted, 0);

  const workflowResults = run.workflowResults ?? [];
  const passedWorkflows = workflowResults.filter((w) => w.status === "pass").length;
  const workflowPassRate = workflowResults.length > 0
    ? passedWorkflows / workflowResults.length
    : 0;

  const adversarialResults = run.adversarialResults ?? [];
  const criticalFailures = adversarialResults.filter((a) => a.status === "fail").length;

  const safetyScore = scorecard.safety ?? 0;

  // Gate evaluations
  const gates = [
    {
      id: "overall-score",
      label: "Overall score ≥ " + thresholds.minimumOverallScore,
      passed: overallScore >= thresholds.minimumOverallScore,
      actual: overallScore.toFixed(2),
      required: thresholds.minimumOverallScore,
    },
    {
      id: "workflow-pass-rate",
      label: "Workflow pass rate ≥ " + (thresholds.minimumWorkflowPassRate * 100) + "%",
      passed: workflowPassRate >= thresholds.minimumWorkflowPassRate,
      actual: (workflowPassRate * 100).toFixed(1) + "%",
      required: (thresholds.minimumWorkflowPassRate * 100) + "%",
    },
    {
      id: "safety-score",
      label: "Safety score ≥ " + thresholds.minimumSafetyScore,
      passed: safetyScore >= thresholds.minimumSafetyScore,
      actual: safetyScore,
      required: thresholds.minimumSafetyScore,
    },
    {
      id: "no-critical-adversarial-failures",
      label: "Critical adversarial failures = 0",
      passed: criticalFailures <= thresholds.maximumCriticalAdversarialFailures,
      actual: criticalFailures,
      required: thresholds.maximumCriticalAdversarialFailures,
    },
  ];

  // Regression gate (if previous provided)
  if (previous) {
    const prevScore = previous.summary?.overallScore ?? 0;
    const drop = prevScore - overallScore;
    gates.push({
      id: "no-regression",
      label: "Score drop ≤ " + thresholds.maximumOverallDropFromPrevious + " from previous",
      passed: drop <= thresholds.maximumOverallDropFromPrevious,
      actual: drop.toFixed(2) + " drop",
      required: "≤ " + thresholds.maximumOverallDropFromPrevious,
    });
  }

  const passed = gates.every((g) => g.passed);

  return {
    runId: run.runId ?? "unknown",
    score: parseFloat(overallScore.toFixed(2)),
    passed,
    gates,
    dimensions,
    workflowPassRate: parseFloat((workflowPassRate * 100).toFixed(1)),
    criticalFailures,
    safetyScore,
  };
}
