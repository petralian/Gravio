# Changelog

All notable changes to this project will be documented in this file.

---

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
