# Agent Scorecard Platform — Session Notes

_Created: 2026-05-05. Update this file when key architectural or process decisions are made._

---

## Project Identity

- **App:** Agent Scorecard Platform — AI agent quality scoring, explainability, and improvement engine
- **Stack:** Node.js 20+ (ESM) · Vanilla JS web UI · node:http server · node:test suite
- **Location:** `D:\VS Code Projects\Agent Scorecard`
- **Origin:** Extracted from Vouch Shopify project on 2026-05-05

---

## Product Vision

The Agent Scorecard Platform evaluates whether an AI coding agent is operating safely, reliably, and efficiently. It goes beyond a score to provide:

1. **Evidence-grounded scoring** — every dimension score backed by real workflow evidence
2. **Gate outcomes** — hard pass/fail gates that block unsafe behavior regardless of weighted score
3. **Explainability** — for every failed check: what happened, why it matters, how to fix it
4. **Periodic re-assessment** — trend tracking across sessions to prevent decay
5. **Scanner daemon** (planned) — watches project folders, collects live evidence, removes need for manual JSON authoring
6. **Parallel agent coordination** (planned) — detects file-level conflicts, manages agent work queue

---

## Architecture

```
src/
  server.mjs          HTTP server (node:http) — serves UI + /api/evaluate
  core/
    evaluate.mjs      Evaluator engine — pure function, framework-agnostic

src/web/
  index.html          Single-page UI with guided onboarding, builder, sample loading
  styles.css          Dark UI with CSS variables
  app.js              Browser JS — file import, builder, validation, evaluation

scripts/
  scorecard-gate.mjs  Self-quality gate (exits 0=pass, 1=fail)
  new-run.mjs         Scaffold new run stub + rotate latest→previous
  secret-scan.mjs     Context-aware secret scanner

tests/
  evaluate.test.mjs   Unit tests for evaluator engine (node:test)
  server.test.mjs     Integration tests for HTTP server

agent-quality/
  baseline.json       Gate thresholds + regression limits
  runs/
    latest.json       Latest agent run evidence (filled by agent each session)
    previous.json     Previous run (auto-rotated by new-run.mjs)
  evals/
    workflow-corpus.json  14 workflows with descriptions + required evidence
  schemas/
    agent-trace.schema.json  Required OpenTelemetry-style trace attributes
  scorecard/
    weights.json      Dimension weights + per-dimension score thresholds

.github/
  agents/             Agent definitions (scorecard-test, scorecard-impl, etc.)
  skills/             Skill definitions (session-bootstrap, etc.)
  copilot-instructions.md  Project-wide coding + governance rules
```

---

## Quality Dimensions

| Dimension | Weight | Minimum |
|---|---|---|
| Safety | 30% | 90 |
| Reliability | 25% | 85 |
| Evaluation | 20% | 83 |
| Observability | 10% | 80 |
| Governance | 15% | 85 |

---

## Hard Gates (any single failure = FAIL regardless of weighted score)

| Gate | Threshold |
|---|---|
| Overall score | ≥ 87 |
| Workflow pass rate | ≥ 90% |
| Safety score | ≥ 90 |
| Critical adversarial failures | 0 |
| Score regression | ≤ 2 drop from previous |

---

## Key Commands

```bash
npm start             # Start web UI at http://localhost:3000
npm test              # Run full test suite
npm run scorecard:check   # Run quality gate (exits 1 if failing)
npm run scorecard:new-run # Scaffold new run stub
npm run secret-scan   # Run secret scanner
npm run verify        # secret-scan + tests + gate (full CI check)
```

---

## Planned Next Steps

1. **Scanner Daemon** — Node.js file watcher that scans project folders and emits live JSON evidence
2. **Explainability Engine** — Per-check explanations with What/Why/How/Effort/Impact
3. **Prompt Generator** — Ready-to-run agent prompts per failed check
4. **Trend Dashboard** — Score over time, regression highlights, improvement streaks
5. **Parallel Agent Coordination** — Lock manager for multi-agent file access
6. **Token Efficiency Module** — Detect repeated-failure loops, suggest minimal context packs
7. **Policy Packs** — Configurable check sets: Solo Starter, Agency Team, Enterprise Secure

---

## Open Loops

- Scanner daemon not yet implemented
- Tests require `server.mjs` to export the server object (currently no export — test uses dynamic import side-effect)
- No CI yet — GitHub Actions workflow to add
- No deployment target yet — local only

---

## Environment Variables

None required for local development.

For future cloud deployment:
| Var | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
