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
5. **Scanner daemon** (v1 implemented) — watches project folders, collects live evidence, removes need for manual JSON authoring
6. **Parallel agent coordination** (planned) — detects file-level conflicts, manages agent work queue

Current positioning is broader than coding agents only: Gravio evaluates whole-codebase quality for human+AI teams, with an added agentic-readiness dimension.

---

## Architecture

```
src/
  server.mjs               HTTP server (node:http) — serves UI + /api/evaluate
  core/
    evaluate.mjs           Evaluator engine — pure function, framework-agnostic
    scanner-daemon.mjs     Scanner Daemon v1 core (scan + evidence generation)

src/web/
  index.html               Single-page UI with guided onboarding, builder, sample loading
  styles.css               Dark UI with CSS variables
  app.js                   Browser JS — file import, builder, validation, evaluation

scripts/
  scorecard-gate.mjs       Self-quality gate (exits 0=pass, 1=fail)
  new-run.mjs              Scaffold new run stub + rotate latest→previous
  secret-scan.mjs          Context-aware secret scanner
  scanner-daemon.mjs       Scanner Daemon v1 CLI (one-time and watch mode)

tests/
  evaluate.test.mjs        Unit tests for evaluator engine (node:test)
  server.test.mjs          Integration tests for HTTP server
  scanner-daemon.test.mjs  Unit tests for scanner daemon behavior

agent-quality/
  baseline.json            Gate thresholds + regression limits
  runs/
    latest.json            Latest agent run evidence (scanner-updatable)
    previous.json          Previous run (auto-rotated by new-run.mjs)
  evals/
    workflow-corpus.json   14 workflows with descriptions + required evidence
  schemas/
    agent-trace.schema.json Required OpenTelemetry-style trace attributes
  scorecard/
    weights.json           Dimension weights + per-dimension score thresholds

.github/
  agents/                  Agent definitions (scorecard-test, scorecard-impl, etc.)
  skills/                  Skill definitions (session-bootstrap, etc.)
  copilot-instructions.md  Project-wide coding + governance rules
```

---

## Quality Dimensions

| Dimension | Weight | Minimum |
|---|---|---|
| Safety | 25% | 90 |
| Reliability | 20% | 85 |
| Evaluation | 15% | 83 |
| Observability | 10% | 80 |
| Governance | 15% | 85 |
| Agentic | 15% | 80 |

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
npm start                      # Start web UI at http://localhost:3000
npm test                       # Run evaluator + scanner tests
npm run scorecard:check        # Run quality gate (exits 1 if failing)
npm run scorecard:new-run      # Scaffold new run stub
npm run scorecard:scan         # One-time scanner run to generate latest.json
npm run scorecard:scan:watch   # Watch target folder and regenerate latest.json on change
npm run secret-scan            # Run secret scanner
npm run verify                 # secret-scan + tests + gate (full CI check)

# CLI authorize + encrypted publish flow
node gravio.mjs --authorize --target . --project my-project --server https://gravio.dev --api-key gv_xxx
node gravio.mjs --once --target .   # scan is blocked unless authorized; then writes encrypted latest.json and auto-publishes
node gravio.mjs --logout --target . # remove local .gravio/auth.json
```

---

## SQLite Schema

**users** — `id, email, password_hash, role ('user'|'admin'), plan ('free'|'pro'|'team'), is_active, created_at`
- `plan` column added via idempotent `ALTER TABLE` migration on startup (safe for existing DBs)
- `getSession` and `getApiKey` JOINs expose `u.plan` to all request handlers

**sessions** — `id, user_id, token_hash, expires_at`
**api_keys** — `id, user_id, key_hash, label, created_at`
**runs** — `id, project_id, user_id, ciphertext, published_at`

---

## Encrypted Run Envelope Contract

- `POST /api/publish` accepts `run` as either legacy plaintext run JSON or encrypted envelope JSON.
- Encrypted envelopes use `format: "gravio-run-v1"` and store only ciphertext plus key-derivation metadata.
- New CLI behavior publishes encrypted envelopes to cloud by default without writing local run artifacts.
- Dashboard decrypts envelope payload client-side (WebCrypto) using one of: API key mode, passphrase mode, or raw key mode.
- Server continues blind storage only (`runs.ciphertext`), with no server-side decrypt path.

## Free Tier Runtime Policy

- Free scans are always accepted and published to cloud.
- Cloud retention for free users is capped to latest 3 records (older records auto-pruned).
- `/api/runs/:projectId` returns generic rating-only payloads for free users (no detailed remediation/check data).
- `/api/runs/:projectId/history` returns project scan timelines and trend summary, with generic-only details on free tier.
- Pro/Team/admin users receive full run detail payloads.
- CLI scan flow is cloud-only (no local run JSON artifact persisted).

## Dashboard Interaction Model

- Dashboard default surface is no longer decrypt-first; users land on overview metrics (`last scan`, `projects`, `total scans`) plus project list and API key management.
- E2EE decrypt module is optional and shown only for Pro/Team/admin users.
- Project drill-down now shows:
  - full scan history list
  - trend summary and aggregate stats
  - recommendation list
  - multi-select scan deletion with inline two-step confirmation
- `POST /api/runs/delete` deletes selected scan IDs scoped to the authenticated user and project.

---

## Plan / Tier System

| Plan | Publish behavior | Admin-settable |
|---|---|---|
| free | always publish, retain latest 3 scans | yes |
| pro | always publish, unlimited retention | yes |
| team | always publish, unlimited retention | yes |

- `POST /api/admin/users/:id/plan` — admin-only endpoint to set any user's plan
- `/api/publish` accepts all scans; free users are auto-trimmed to latest 3 retained scans
- `/api/publish` appends run history rows (no longer overwrites one row per project)
- `/api/me` returns `plan` field so the frontend can gate features

---

## Planned Next Steps

1. **Scanner Daemon enhancements** — richer checks (git cleanliness, CI status, command execution hooks)
2. **Explainability Engine** — per-check explanations with What/Why/How/Effort/Impact
3. **Prompt Generator** — ready-to-run agent prompts per failed check
4. **Trend Dashboard** — score over time, regression highlights, improvement streaks
5. **Parallel Agent Coordination** — lock manager for multi-agent file access
6. **Token Efficiency Module** — detect repeated-failure loops, suggest minimal context packs
7. **Policy Packs** — configurable check sets: Solo Starter, Agency Team, Enterprise Secure

---

## Open Loops

- Scanner daemon v1 shipped; deeper evidence checks still pending
- No CI yet — GitHub Actions workflow to add
- No deployment target yet — local only
- Agent definitions in `.github/agents` still use Vouch naming and should be migrated
- Explainability engine not yet implemented

---

## Environment Variables

None required for local development.

For future cloud deployment:
| Var | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
