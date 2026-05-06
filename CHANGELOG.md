# Changelog

All notable changes to this project will be documented in this file.

---

## [Unreleased]

### Added
- New conversion-focused sales page at `/why-gravio.html` explaining AI coding oversight risks, Gravio value props, external trust references, and FAQ schema for improved GEO/AIO discoverability.
- Interactive proof-metrics module on `/why-gravio.html` using Chart.js (open source) with source-linked risk, adoption, and business-impact datasets.
- `POST /api/keys/onboarding` — authenticated endpoint that mints a fresh user-bound CLI key (label "onboarding"), deleting any prior key with that label, so the onboarding page always has a real token to auto-fill.
- `GET /api/projects/list` for CLI relink discovery and project identity management.
- `POST /api/projects/rename` to rename project IDs per user.
- `POST /api/projects/merge` to combine one project into another selected destination.
- 7 new server tests covering onboarding key rotation plus project list/rename/merge flows.

### Changed
- Shared header and homepage hero now link directly to `/why-gravio.html` as an educational conversion path for new prospects.
- Onboarding is now a true 3-step flow: (1) download CLI, (2) run one smart command, (3) open dashboard.
- Onboarding no longer asks for manual project naming; the CLI now auto-generates and persists project identity.
- Step 2 now uses a single command: `node gravio.mjs --token <gv_...>`.
- CLI defaults to one-command run mode (`node gravio.mjs`) that auto-discovers setup/auth/link/scan/publish.
- CLI now persists project linkage in `.gravio/project.json` and supports recovery commands: `link`, `rename`, `merge`, and `doctor`.
- Dashboard Run Scans tab now includes inline project rename and merge controls.

- `GET /api/runs/:projectId/history` endpoint for project-level scan history with trend stats and recommendations.
- `POST /api/runs/delete` endpoint to remove selected scans for a project (used by inline delete confirmation flow in dashboard).
- Plan/tier system: `free`, `pro`, `team` tiers per user stored in the `users` table (`plan` column, idempotent `ALTER TABLE` migration on startup).
- `POST /api/admin/users/:id/plan` — admin-only endpoint to upgrade or downgrade any user's plan.
- Admin dashboard: new Plan column with inline `<select>` dropdown; free users show scan count as `used / 3`, paid users show bare count.
- `/api/me` now returns `plan` field so frontends can gate features by tier.
- Pro and Team plan users bypass the 3-project publish limit (only Free users are gated).
- CLI local authorization state at `.gravio/auth.json` via `node gravio.mjs --authorize ...` and revocation via `node gravio.mjs --logout`.
- Scanner now writes encrypted `agent-quality/runs/latest.json` envelopes (`format: gravio-run-v1`) instead of plaintext run JSON.
- Dashboard decryption mode for API keys, with browser-side WebCrypto decrypt for encrypted run envelopes.

### Changed
- CLI setup (node gravio.mjs --setup) now uses explicit numbered stages (preflight, install, finalize), explains why pip may uninstall/reinstall packages, and summarizes noisy pip output by default to reduce panic during dependency reconciliation.
- Server integration tests now use a dynamically allocated free port and request timeouts to avoid false failures from local port collisions.
- Dashboard default UX is now overview-first (last scan, projects, total scans, API key creation), with E2EE tools moved to an optional Pro/Team section.
- Runs storage changed from single upsert-per-project to append-only scan history rows, enabling per-project timelines and selective scan deletion.
- Scoring model expanded from 5 to 6 dimensions by adding `agentic` readiness (skills, prompts, orchestration, and human+AI collaboration signals).
- Branding/copy updated from AI-coding-agent-only wording to broader codebase quality positioning across human and AI workflows.
- Marketing copy now requires registration before cloud scoring and replaces misleading global `agentscored` install examples with real project commands.
- Public "Try the tool" CTAs replaced with registration-first messaging ("3 free scans") and onboarding links.
- CLI publish now requires `--api-key` and prints explicit login/dashboard guidance when missing or unauthorized.
- `/tool` and `POST /api/evaluate` now require authentication; unauthenticated users are redirected to login or receive 401.
- Free-plan cloud publish limit enforced at 3 scans for non-admin users.
- Dashboard layout fixed so "My projects" and "API keys" render inside the primary dashboard container with consistent spacing.
- Onboarding now uses an auth-aware unified header (user pill + sign-out when authenticated; sign-in CTA when unauthenticated).
- Onboarding hero CTA now adapts to session state, hiding "Create account or sign in" for logged-in users and showing "Open dashboard" instead.
- Marketing header now removes the separate onboarding menu item and routes "Start free" directly to guided onboarding.
- Onboarding flow is now register-first with in-page auth modal, project-first step ordering, and live command updates from the chosen project name.
- Onboarding copy now clarifies that commands must be run in a real project directory (not random folders) to avoid npm/scan command confusion.
- Canonical host redirects now keep browser sessions on `gravio.dev` (including redirect from `gravio-platform.fly.dev` and `www.gravio.dev`) to improve session continuity.
- CLI `--once` now auto-publishes when a local folder is authorized, reducing repeated `--project/--api-key` flags.
- CLI now blocks all scans until folder authorization exists (`--authorize`), and no longer requires a separate manual publish step.
- `/api/publish` and `/api/runs/:projectId` now support encrypted run envelopes end-to-end while keeping legacy plaintext run compatibility.
- Onboarding Step 4 now uses the authorize-once flow before scan/publish.
- Free tier publish policy changed: scans are always accepted, but only the latest 3 cloud records are retained.
- Free tier dashboard payloads now return generic rating summaries only; remediation details require Pro or Team.
- Scanner CLI is now cloud-only for scan output (no local `agent-quality/runs/latest.json` artifact is written).

## [0.4.0] — 2026-05-05

### Added (Phase 4 — User Auth, Persistence, Admin Panel, Fly.io)
- `src/core/db.mjs` — SQLite schema via better-sqlite3; tables: users, sessions, api_keys, runs; WAL mode + foreign keys
- `src/core/auth.mjs` — scrypt password hashing (N=16384), session token management, API key generation (`gv_` prefix), register/login helpers, timing-safe equal
- `src/server.mjs` — auth routes: POST /auth/register, POST /auth/login, POST /auth/logout, GET /api/me, POST /api/keys, GET /api/keys, DELETE /api/keys/:id, GET /api/runs/list, GET /api/admin/users, POST /api/admin/users/:id/(disable|enable|delete)
- `src/web/login.html` + `login.js` — login/register tab UI, auto-redirects admin → /admin, user → /dashboard
- `src/web/admin.html` + `admin.js` — admin panel with user management table, stat cards, recent runs; client-side auth guard
- `src/web/dashboard.html` — auth guard, My Projects list, API key management section added
- `src/web/dashboard.js` — auth IIFE guard, loadProjects(), loadApiKeys(), renderKeyList(), esc() XSS helper
- `src/web/styles.css` — body.auth-page and body.admin-page CSS namespaces; dashboard extras (user pill, project btns, key management)
- `Dockerfile` — node:20-alpine, python3/make/g++ for better-sqlite3 native build, non-root user gravio, /data volume
- `fly.toml` — gravio-platform app, region lax, 256mb shared CPU, gravio_data persistent volume at /data
- First registered user is automatically promoted to admin (or ADMIN_EMAIL env var)
- tests/server.test.mjs fully rewritten — 63 tests covering auth, API keys, publish/run (auth-gated), login/admin pages
- Deployed to https://gravio-platform.fly.dev

### Changed
- POST /api/publish now requires Bearer API key or session cookie (returns 401 if unauthenticated)
- GET /api/runs/:projectId now requires auth; scoped to requesting user (admin sees any)
- Runs stored in SQLite DB instead of in-memory Map
- npm test now runs 63 tests across 4 suites

## [0.3.0] — 2026-05-05

### Added (Phase 3 — Browser WebCrypto Dashboard)
- Browser WebCrypto dashboard at src/web/dashboard.html + src/web/dashboard.js
- Client-side AES-256-GCM decrypt (window.crypto.subtle) matching Node wire format exactly
- PBKDF2 passphrase key derivation in browser (210,000 iterations, SHA-256) via subtlecrypto
- Scorecard display: score banner, gate results list, dimension grid, raw JSON accordion
- Server: GET /dashboard route serving dashboard.html
- Dashboard CSS namespace body.dashboard added to styles.css

## [0.2.0] — 2026-05-04

### Added (Phase 2 — Zero-Knowledge E2EE Sync)
- Zero-knowledge E2EE crypto module at src/core/crypto-e2ee.mjs (AES-256-GCM, PBKDF2 key derivation)
- Server blind-store endpoints: POST /api/publish, GET /api/runs/:projectId (ciphertext never decrypted)
- Scanner CLI --publish, --project, --server, --key, --passphrase, --salt flags for encrypted cloud publish
- Scanner Daemon v1 MVP core at src/core/scanner-daemon.mjs
- Scanner CLI command at scripts/scanner-daemon.mjs
- New npm scripts: scorecard:scan (one-time) and scorecard:scan:watch (daemon mode)
- Scanner test suite at tests/scanner-daemon.test.mjs
- Crypto unit tests at tests/crypto-e2ee.test.mjs (17 tests)
- Server integration tests at tests/server.test.mjs now wired into npm test

### Changed
- npm test runs all 4 test suites
- GET / serves marketing homepage; evaluation tool accessible at /tool

## [0.1.0] — 2026-05-05

### Added
- Initial project bootstrap, relocated from Vouch Shopify repo
- HTTP server (`src/server.mjs`) serving single-page evaluation UI at `localhost:3000`
- Evaluator engine (`src/core/evaluate.mjs`) — weighted 5-dimension scoring with hard gate checks
- Web UI: guided onboarding, sample loaders, JSON builder, file import, validation, full results display
- Self-quality corpus: `agent-quality/` with baseline, weights, workflow corpus (14 workflows), trace schema
- Seed run artifact `agent-quality/runs/latest.json` with score 92.15 / all 14 workflows passing
- Quality scripts: `scorecard-gate.mjs`, `secret-scan.mjs`, `new-run.mjs`
- Test suite: `tests/evaluate.test.mjs` (unit), `tests/server.test.mjs` (integration)
- Governance stack: `.github/agents/` (5 agents), `.github/skills/` (4 skills), `copilot-instructions.md`
- Project notes: `.claude/NOTES.md`, `.claude/NEXT_SESSION.md`
- Obsidian continuity note at `C:\Obsidian\obsidian\40_Projects (Personal)\Agent Scorecard\Kickoff.md`
