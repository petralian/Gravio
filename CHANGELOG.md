# Changelog

All notable changes to this project will be documented in this file.

---

## [Unreleased]

### Added
- Scanner Daemon v1 MVP core at src/core/scanner-daemon.mjs
- Scanner CLI command at scripts/scanner-daemon.mjs
- New npm scripts: scorecard:scan (one-time) and scorecard:scan:watch (daemon mode)
- Scanner test suite at tests/scanner-daemon.test.mjs
- gravio.dev marketing website at src/web/index.html (hero, pricing, install, zero-knowledge callout)
- Evaluation tool moved to src/web/tool.html with dedicated /tool route
- Complete design system at src/web/styles.css (neon palette, terminal tokens, marketing + tool namespaces, responsive)
- Server routes: GET /tool (serves tool.html), GET /health (returns {"status":"ok"})
- Phase 2 — Zero-knowledge E2EE crypto module at src/core/crypto-e2ee.mjs (AES-256-GCM, PBKDF2 key derivation)
- Phase 2 — Server blind-store endpoints: POST /api/publish, GET /api/runs/:projectId (ciphertext never decrypted)
- Phase 2 — Scanner CLI --publish, --project, --server, --key, --passphrase, --salt flags for encrypted cloud publish
- Phase 3 — Browser WebCrypto dashboard at src/web/dashboard.html + src/web/dashboard.js
- Phase 3 — Client-side AES-256-GCM decrypt (window.crypto.subtle) matching Node wire format exactly
- Phase 3 — PBKDF2 passphrase key derivation in browser (210,000 iterations, SHA-256) via subtlecrypto
- Phase 3 — Scorecard display: score banner, gate results list, dimension grid, raw JSON accordion
- Phase 3 — Server: GET /dashboard route serving dashboard.html
- Phase 3 — Dashboard CSS namespace body.dashboard added to styles.css
- Phase 2 — Crypto unit tests at tests/crypto-e2ee.test.mjs (17 tests)
- Phase 2 — Server integration tests at tests/server.test.mjs now wired into npm test

### Changed
- npm test now runs all 4 test suites (47 tests total)
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
