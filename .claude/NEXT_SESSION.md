# NEXT SESSION HANDOFF

Last updated: 2026-05-07
Owner session: Evaluation Expansion — Phase 1 complete, Phase 2 next

## Current Priority

**Phase 2: Habit Mechanics + Cloud Audit Trail**  
Every scan should store a timestamped artifact server-side (per-project history), and the CLI should show streak data and 7/30-day trends.

## What Changed This Session (2026-05-07)

### Phase 1 — CLI Evaluation Engine Expansion ✅
- `src/core/scanner.mjs` — 18 new detection signals (cloud credential files, dep vuln check, test coverage config, integration/E2E tests, health check, feature flags, adversarial tests, prompt tests, SLO definition, alert config, API docs, ADR dir, commit-lint config, safety rules in instructions, model pinned, prompt versioning, tool whitelist). DEFAULT_CORPUS expanded 14 → 33. `computeRichScorecard` rebalanced.
- `src/core/reporter.mjs` — `buildCatalog` expanded 22 → 35 entries, each with `subdim`, `difficulty`, `estimatedMinutes`, `impactScore`, `action`. New `printRecommendations()` function. `HEADER_CHECK_IDS` expanded to 14 checks.
- `src/web/cli/gravio.mjs` — rebuilt at 67.1 KB via `npm run build:cli`.
- Commit: `aff6eb3` — deployed to production, health check OK.
- Tests: 96/96 passing.

## Phase 2 Plan (Next Session)

### 2A — Per-scan cloud audit trail
- New DB table: `scan_history` (id, user_id, project_id, timestamp, git_commit, overall_score, dimension_scores JSON, checks_run JSON, recommendations JSON)
- New endpoint: `POST /api/scans/artifact` — authenticated, stores encrypted scan summary
- CLI sends artifact on every `--once` run (after publish succeeds)
- Endpoint returns scan streak data for display

### 2B — Streak tracking (CLI)
- New endpoint: `GET /api/projects/:id/streak` — returns streak count, last-scan date, 7-day/30-day score deltas
- CLI parses streak response and injects streak line into scan output:
  ```
  🔥 3-week streak  +12 pts over 30 days  →  gravio.dev/dash
  ```
- If no previous scans: shows "First scan! Streak starts now."

### 2C — Time-based gates (scaffolding only)
- Add `firstScannedAt` to `scan_history` summary query
- Pass `daysSinceFirst` to reporter — filter `printRecommendations` to only show `quick-win` if `< 14 days`, `medium` if `>= 14 days`, all if `>= 30 days`
- CLI doesn't need UI changes — just filter catalog before display

## Open Loops (Roadmap Phases 3+)

- [ ] Phase 3: Team dashboard + comparisons (90-day trajectory, peer benchmarks, industry baseline)
- [ ] Phase 3: Weekly email digest (score delta, top recommendation, streak status)
- [ ] Phase 3: Recommendation tracking (addressed / in-progress / false-positive feedback)
- [ ] Phase 4: Dependency graph resolver (show prerequisite chains in CLI output)
- [ ] Phase 4: Local-maxima detection (if score stagnant 4 weeks → pivot suggestion)
- [ ] Phase 4: "Biggest win next" single-recommendation mode
- [ ] Ongoing: CI workflow `.github/workflows/quality.yml` not yet added
- [ ] Ongoing: Gravio scores itself — scorecard gate must stay green

## Risks / Constraints

- CLI bundle must be rebuilt after every change to scanner.mjs or reporter.mjs (`npm run build:cli`).
- Zero-knowledge constraint: server must never see plaintext run JSON. Scan artifacts stored must be summary stats only (scores + check IDs), not the full encrypted run payload.
- `[hidden]` attribute is sacred — never add CSS `display:` to elements that may receive `hidden`.

## Verification Snapshot (2026-05-07)

- Tests: 96/96 passing
- Deployed: commit `aff6eb3`, `curl https://gravio.dev/health` → `{"status":"ok"}`
- Roadmap: `C:\Obsidian\obsidian\40_Projects (Personal)\Gravio\Operations\Gravio Evaluation Expansion Roadmap.md`
- Phase 1 complete, Phase 2 not started
