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
  why-gravio.html          Conversion-focused explainer page for AI coding risk and Gravio positioning
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

**users** — `id, email, password_hash, auth_provider, auth_subject, role ('user'|'admin'), plan ('free'|'pro'|'team'), is_active, created_at`
- `plan` column added via idempotent `ALTER TABLE` migration on startup (safe for existing DBs)
- `auth_provider` + `auth_subject` map SSO identities to existing accounts and are unique as a pair when present.
- `getSession` and `getApiKey` JOINs expose `u.plan` to all request handlers

**sessions** — `id, user_id, token_hash, expires_at`
**api_keys** — `id, user_id, key_hash, label, created_at`
**runs** — `id, project_id, user_id, ciphertext, published_at`
**webhook_events** — `id, provider, event_key, event_name, object_id, payload, processed_at`
- Unique `(provider, event_key)` prevents duplicate webhook side-effects.

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
- `/api/runs/:projectId/history` returns project scan timelines, trend summary, and structured recommendations (`version: 2`) including action plan, dimension roadmap, and ready-to-ship checklist (free tier remains generic-only guidance).
- Pro/Team/admin users receive full run detail payloads.
- CLI scan flow is cloud-only (no local run JSON artifact persisted).

## Dashboard Interaction Model

- Dashboard is a **two-view SPA** (`dashboard.html` + `dashboard.js`):
  - **View 1 — Projects home**: card grid of all user projects with score, trend badge, rating badge, scan count, relative last-scan time. Supports search and sort (recent / score asc/desc / name).
  - **View 2 — Project workspace**: breadcrumb back nav + hero header (project name, score, rating, trend) + four-tab panel: Overview, Scans, Recommendations, Commands.
- API keys and E2EE decrypt tool are **no longer on the dashboard**; they live at `/settings` (`settings.html` + `settings.js`).
- E2EE decrypt module shown only for Pro/Team/admin users; lives under Settings > Advanced.
- Project drill-down tabs:
  - **Overview** — stat chips (total scans, best, avg) + latest summary + recent 5 scans mini-table
  - **Scans** — full paginated scan table with multi-select delete (inline two-step confirmation)
  - **Recommendations** — latest-scan remediation workspace with quick wins, priority action cards, per-dimension target roadmap, and ready-to-ship checklist
- URL param `?project=<id>` still works — jumps directly into project workspace on load.
- Browser back/forward (popstate) returns to projects home.

---

## Plan / Tier System

| Plan | Publish behavior | Admin-settable |
|---|---|---|
| free | always publish, retain latest 3 scans | yes |
| pro | always publish, unlimited retention | yes |
| team | always publish, unlimited retention | yes |

- `POST /api/admin/users/:id/plan` — admin-only endpoint to set any user's plan
- `POST /api/scan-evaluate` — auth-gated; accepts `{ scan }` (raw signals from CLI), returns a full run artifact JSON (server evaluates using scoring weights/corpus). Used by CLI after local filesystem scan.
- `/api/publish` accepts all scans; free users are auto-trimmed to latest 3 retained scans
- `/api/publish` appends run history rows (no longer overwrites one row per project)
- `/api/me` returns `plan` field so the frontend can gate features

## Authentication Routes

- `POST /auth/register` — email/password account creation with strong password policy enforcement.
- `POST /auth/login` — email/password sign-in.
- `POST /auth/logout` — session logout.
- `GET /auth/sso/providers` — returns enabled SSO providers for UI capability detection.
- `GET /auth/sso/google/start` — starts Google OAuth sign-in (PKCE + CSRF state cookie).
- `GET /auth/sso/google/callback` — completes Google OAuth sign-in, links/creates user, sets session cookie.

## Billing Lifecycle (Lemon Squeezy)

- Team checkout is created server-side via `POST /api/billing/team-checkout` using Lemon API custom pricing by seats.
- Webhook endpoint: `POST /api/webhooks/lemonsqueezy` with HMAC verification using `LEMON_WEBHOOK_SECRET` and `X-Signature` header.
- Webhook idempotency key uses `X-Event-Id` / `X-Webhook-Id` when present, else `event_name + object_id + sha256(rawBody)` and is persisted in `webhook_events`.
- Lifecycle events now sync into `users` table billing fields: provider, customer/subscription IDs, status, seats, renews_at, cancelled flag, and portal URL.
- `GET /api/billing/status` exposes the authenticated user's billing snapshot for Settings UI.
- Authenticated mutation endpoints:
  - `POST /api/billing/cancel`
  - `POST /api/billing/resume`
  - `POST /api/billing/seats`
- Billing mutation routes enforce ownership by retrieving the Lemon subscription first and matching authenticated user email or stored Lemon customer ID before mutating.
- `GET /api/billing/invoices` fetches subscription invoices (up to 12, newest first) and payment method info in parallel from Lemon API. Returns `{ paymentMethod: { brand, lastFour, processor, updateUrl }, invoices: [...] }`. Returns `{ invoices: [], paymentMethod: null }` if no subscription ID exists in DB.
- Settings (`/settings`) now includes a Billing section with plan badge, status pill, seats adjuster (team only), cancel/resume two-step actions, payment method display, and invoice history table.
- Phase 4 billing status banners: `db-billing-banner` on both `/dashboard` and `/settings` for `past_due`, `unpaid`, `expired` states. Dashboard loads banner non-blocking after init; settings banner rendered in `renderBillingCard()`.
- Phase 5 admin billing diagnostics: `GET /api/admin/billing/diagnostics` (admin-only) returns plan distribution summary, drift alerts (paid plan but missing or expired subscription), and last 100 webhook events. Admin panel shows all three as tables.
- Phase 6 billing email nudges: Three lifecycle emails sent fire-and-forget from the webhook handler after DB state is persisted:
  - `subscription_payment_failed` → `sendPaymentFailedEmail(to, updatePaymentUrl)` — card + CTA
  - `subscription_cancelled` → `sendSubscriptionCancelledEmail(to, endsAt)` — grace period end date + reactivate CTA
  - `subscription_expired` → `sendSubscriptionExpiredEmail(to)` — renew CTA
  - All use `sendBillingEmail()` in `src/core/auth.mjs`; fallback to `console.log` in dev (no `RESEND_API_KEY`).
  - Env: `RESEND_API_KEY` (Fly secret), `EMAIL_FROM` (optional, default `Gravio <noreply@gravio.dev>`).

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

## Marketing Route Notes

- Public conversion page: `/why-gravio.html` (server static fallback under `src/web/`).
- Public trust-contract page: `/security` (serves `src/web/security.html`).
- Public CLI trust manifest endpoint: `/cli/manifest.json` (generated by `scripts/build-cli.mjs` into `src/web/cli/manifest.json`).
- Page intent: convert high-intent prospects by pairing concise business outcomes with external risk references and Gravio-specific remediation positioning.
- GEO/AIO optimization on page: explicit H1/H2 intent, external authority citations, concise FAQ answers, and `FAQPage` JSON-LD.
- Interactive evidence panel uses Chart.js (CDN, open source) with three user-selectable datasets (risk, adoption, business impact) and direct links to source reports.

---

## Open Loops

- Scanner daemon v1 shipped; deeper evidence checks still pending
- No CI yet — GitHub Actions workflow to add
- No deployment target yet — local only
- Agent definitions in `.github/agents` still use Vouch naming and should be migrated
- Explainability engine not yet implemented

---

## Environment Variables

None required for local development unless testing billing webhooks.

For cloud deployment:
| Var | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `LEMON_API_KEY` | Lemon Squeezy API key (server-side checkout creation) |
| `LEMON_STORE_ID` | Lemon store ID used for checkout creation |
| `LEMON_TEAM_VARIANT_ID` | Lemon Team variant ID used for dynamic seat pricing |
| `LEMON_WEBHOOK_SECRET` | HMAC secret for validating Lemon webhook signatures |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth client ID for SSO |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth client secret for SSO token exchange |
| `GOOGLE_OAUTH_REDIRECT_URI` | Redirect URI registered in Google console (callback endpoint) |
