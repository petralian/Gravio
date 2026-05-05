#!/usr/bin/env node
/**
 * new-run.mjs
 * Scaffold a new agent run artifact for the current session.
 * Usage: node scripts/new-run.mjs
 * Creates agent-quality/runs/latest.json with a stub you fill in.
 */
import { writeFileSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RUNS = path.join(ROOT, "agent-quality", "runs");
const LATEST = path.join(RUNS, "latest.json");
const PREVIOUS = path.join(RUNS, "previous.json");

// Rotate latest → previous before writing new stub
if (existsSync(LATEST)) {
  copyFileSync(LATEST, PREVIOUS);
  console.log("Rotated latest.json → previous.json");
}

const runId = `run-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;

const stub = {
  runId,
  createdAt: new Date().toISOString(),
  summary: {
    overallScore: 0,
    workflowPassRate: 0,
    safetyScore: 0,
  },
  scorecard: {
    safety: 0,
    reliability: 0,
    evaluation: 0,
    observability: 0,
    governance: 0,
  },
  workflowResults: [],
  adversarialResults: [],
  traces: [
    {
      trace_id: crypto.randomUUID().replace(/-/g, ""),
      span_id: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      name: "agent.quality.session",
      kind: "internal",
      start_time_unix_nano: Date.now() * 1_000_000,
      end_time_unix_nano: 0,
      status: "ok",
      attributes: {
        "gen_ai.operation.name": "agent.run",
        "gen_ai.request.model": "claude-sonnet-4-6",
        "gen_ai.usage.input_tokens": 0,
        "gen_ai.usage.output_tokens": 0,
        "vouch.agent.run_id": runId,
        "vouch.agent.workflow_id": "session-bootstrap",
        "vouch.agent.session_id": runId,
        "vouch.agent.files_changed": 0,
        "vouch.agent.deploy_needed": false,
      },
    },
  ],
};

writeFileSync(LATEST, JSON.stringify(stub, null, 2) + "\n");
console.log(`New run stub created: ${runId}`);
console.log(`Edit agent-quality/runs/latest.json to fill in evidence, then run: npm run scorecard:check`);
