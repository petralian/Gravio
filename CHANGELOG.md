# Changelog

All notable changes to this project will be documented in this file.

---

## [Unreleased]

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
