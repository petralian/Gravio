# NEXT SESSION HANDOFF

Last updated: 2026-05-05
Owner session: Phase 2 — Zero-knowledge E2EE crypto + cloud endpoints

## Current Priority

Build Phase 3: client-side dashboard (decrypt + render in browser), user auth, cross-platform binary packaging.

## What Changed This Session

### Phase 1 — Marketing website (prior session) ✅
- `src/web/index.html` — gravio.dev marketing site
- `src/web/tool.html` — evaluation tool at /tool
- `src/web/styles.css` — complete design system (neon palette, dual-surface namespace)
- `src/server.mjs` — /tool and /health routes

### Phase 2 — Zero-knowledge E2EE (this session) ✅
- `src/core/crypto-e2ee.mjs` — AES-256-GCM module: `generateKey`, `generateSalt`, `deriveKey` (PBKDF2 210k iter), `encrypt`, `decrypt`
- `src/server.mjs` — `POST /api/publish` (blind store), `GET /api/runs/:projectId` (blind retrieve). Server never decrypts.
- `scripts/scanner-daemon.mjs` — `--publish`, `--project`, `--server`, `--key`, `--passphrase`, `--salt` flags; auto-generates + prints key if none provided
- `tests/crypto-e2ee.test.mjs` — 17 unit tests for all crypto ops
- `tests/server.test.mjs` — now wired into `npm test`; 4 publish/read tests added; Windows ESM fix applied
- Total test suite: 47 tests, all passing

## Open Loops

- [ ] Phase 3: `src/web/dashboard.html` + `src/web/dashboard.js` — client-side WebCrypto decrypt + scorecard render
- [ ] Phase 3: User auth + project management (token or passphrase gated)
- [ ] Phase 3: Binary packaging for macOS / Windows / Linux (`pkg` or `caxa`)
- [ ] Phase 3: `npm publish` as `agentscored` global package
- [ ] Server run store is in-memory only — restarts lose all data. Phase 3 should add file-backed or SQLite persistence.
- [ ] Scanner daemon: replace some inferred workflow statuses with measured signals
- [ ] CI workflow `.github/workflows/quality.yml` not yet added
- [ ] Agent files still use Vouch naming — rename to scorecard-* variants

## Risks / Constraints

- In-memory run store loses data on server restart — documented, acceptable for Phase 2 MVP.
- Key management UX: user must save their key. Auto-print on generation is a workaround; Phase 3 should add proper key store.
- The app scores itself — test suite must stay green.
- Scanner daemon must not read `.env` content.

## Next 1-3 Executable Steps

1. Create `src/web/dashboard.html` — minimal single-page app: input for project ID + key, fetch `/api/runs/:projectId`, decrypt in-browser with WebCrypto, render scorecard.
2. Create `src/web/dashboard.js` — browser-side AES-256-GCM decrypt using `window.crypto.subtle` (same wire format as server).
3. Add `GET /dashboard` route to server.mjs + add WebCrypto decrypt helpers verified against Node crypto test vectors.

## Verification Snapshot

- Phase 2 E2EE module: Yes
- Server publish/read endpoints: Yes
- Scanner --publish CLI flags: Yes
- Tests: 47/47 passing
- Scorecard gate: PASS (score 100)
