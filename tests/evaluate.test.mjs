/**
 * tests/evaluate.test.mjs
 * Unit tests for the core evaluator engine.
 * Run: node --test tests/evaluate.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from "../src/core/evaluate.mjs";

const GOOD_RUN = {
  runId: "test-good",
  scorecard: { safety: 95, reliability: 90, evaluation: 90, observability: 89, governance: 95 },
  workflowResults: [
    { id: "session-bootstrap", status: "pass" },
    { id: "verification-suite", status: "pass" },
    { id: "trace-capture", status: "pass" },
    { id: "secret-scan", status: "pass" },
    { id: "deploy-lock-gate", status: "pass" },
  ],
  adversarialResults: Array.from({ length: 10 }, (_, i) => ({
    id: `llm${String(i + 1).padStart(2, "0")}`,
    status: "pass",
  })),
};

const FAILING_RUN = {
  runId: "test-fail",
  scorecard: { safety: 70, reliability: 60, evaluation: 55, observability: 50, governance: 65 },
  workflowResults: [{ id: "session-bootstrap", status: "fail" }],
  adversarialResults: [{ id: "llm01", status: "fail" }],
};

describe("evaluate — good run", () => {
  const result = evaluate(GOOD_RUN);

  it("computes a score above minimum threshold", () => {
    assert.ok(result.score >= DEFAULT_THRESHOLDS.minimumOverallScore, `Expected score >= ${DEFAULT_THRESHOLDS.minimumOverallScore}, got ${result.score}`);
  });

  it("passes all gates", () => {
    assert.strictEqual(result.passed, true);
    for (const gate of result.gates) {
      assert.strictEqual(gate.passed, true, `Gate '${gate.id}' should pass`);
    }
  });

  it("returns correct workflow pass rate", () => {
    assert.strictEqual(result.workflowPassRate, 100);
  });

  it("returns zero critical failures", () => {
    assert.strictEqual(result.criticalFailures, 0);
  });

  it("returns safety score directly from scorecard", () => {
    assert.strictEqual(result.safetyScore, 95);
  });

  it("produces five dimension entries", () => {
    const dims = Object.keys(result.dimensions);
    assert.deepStrictEqual(dims.sort(), ["evaluation", "governance", "observability", "reliability", "safety"].sort());
  });

  it("weighted sum matches reported score", () => {
    const computed = Object.values(result.dimensions).reduce((s, d) => s + d.weighted, 0);
    assert.strictEqual(parseFloat(computed.toFixed(2)), result.score);
  });
});

describe("evaluate — failing run", () => {
  const result = evaluate(FAILING_RUN);

  it("score is below minimum threshold", () => {
    assert.ok(result.score < DEFAULT_THRESHOLDS.minimumOverallScore, `Expected score < ${DEFAULT_THRESHOLDS.minimumOverallScore}, got ${result.score}`);
  });

  it("overall gate fails", () => {
    assert.strictEqual(result.passed, false);
  });

  it("safety gate fails", () => {
    const safetyGate = result.gates.find((g) => g.id === "safety-score");
    assert.ok(safetyGate, "safety gate not present");
    assert.strictEqual(safetyGate.passed, false);
  });

  it("critical adversarial failures detected", () => {
    assert.strictEqual(result.criticalFailures, 1);
    const advGate = result.gates.find((g) => g.id === "no-critical-adversarial-failures");
    assert.strictEqual(advGate.passed, false);
  });
});

describe("evaluate — regression gate", () => {
  it("passes when score improved from previous", () => {
    const result = evaluate(GOOD_RUN, { previous: { summary: { overallScore: 88 } } });
    const gate = result.gates.find((g) => g.id === "no-regression");
    assert.ok(gate, "regression gate missing");
    assert.strictEqual(gate.passed, true);
  });

  it("fails when score drops more than allowed", () => {
    const result = evaluate(FAILING_RUN, { previous: { summary: { overallScore: 90 } } });
    const gate = result.gates.find((g) => g.id === "no-regression");
    assert.ok(gate, "regression gate missing");
    assert.strictEqual(gate.passed, false);
  });
});

describe("evaluate — custom weights and thresholds", () => {
  it("respects custom minimum threshold", () => {
    const result = evaluate(GOOD_RUN, { thresholds: { ...DEFAULT_THRESHOLDS, minimumOverallScore: 99 } });
    const gate = result.gates.find((g) => g.id === "overall-score");
    assert.strictEqual(gate.passed, false);
  });

  it("respects custom weights", () => {
    const allSafetyWeights = { safety: 1.0, reliability: 0, evaluation: 0, observability: 0, governance: 0 };
    const result = evaluate(GOOD_RUN, { weights: allSafetyWeights });
    assert.strictEqual(result.score, 95);
  });
});
