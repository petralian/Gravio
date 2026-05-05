# NEXT SESSION HANDOFF

Last updated: 2026-05-05
Owner session: Bootstrap session — relocated from Vouch

## Current Priority

Build the scanner daemon — a Node.js file watcher that scans a target project folder and produces a structured evidence JSON that the evaluator can consume directly, eliminating the need to manually author run JSON.

## What Changed This Session

- Moved app from `D:\VS Code Projects\Vouch\agent-scorecard-platform` to `D:\VS Code Projects\Agent Scorecard`
- Copied full Vouch governance stack: agents, skills, copilot-instructions.md
- Created quality corpus: baseline.json, workflow-corpus.json (14 workflows), agent-trace.schema.json, weights.json
- Created self-quality scripts: scorecard-gate.mjs, secret-scan.mjs, new-run.mjs
- Created test suite: evaluate.test.mjs (pure unit), server.test.mjs (integration)
- Updated package.json with full npm scripts: start, test, scorecard:check, scorecard:new-run, secret-scan, verify
- Created .claude/NOTES.md and .claude/NEXT_SESSION.md
- Created Obsidian continuity note at C:\Obsidian\obsidian\40_Projects (Personal)\Agent Scorecard\Kickoff.md

## Open Loops

- [ ] Scanner daemon not implemented. Owner: Next session. Design: file watcher on target dir → emits evidence JSON.
- [ ] server.test.mjs needs server.mjs to export its server instance. Needs 1-line fix.
- [ ] No GitHub Actions CI yet. Add `.github/workflows/quality.yml`.
- [ ] No deployment target. Consider Fly.io, Railway, or Vercel for hosted version.
- [ ] Agent definitions in `.github/agents/` still use Vouch-specific naming. Rename to scorecard-* variants.
- [ ] Explainability engine not yet built. Key differentiator — do this after scanner daemon.

## Risks / Constraints

- The app scores itself — that means a broken scoring system creates false confidence. Test suite must stay green.
- server.test.mjs currently imports server via side-effect which may cause PORT collision. Use a dedicated test port (13099 currently hardcoded).
- When the scanner daemon is built, it must NOT read .env files in the target project — only check that they are not committed.

## Next 1-3 Executable Steps

1. Fix server.mjs to export its server instance so server.test.mjs can close it cleanly.
2. Run `npm test` and confirm both test files pass cleanly.
3. Start scanner daemon design: define evidence schema, pick file patterns to scan, decide polling vs. chokidar.

## Verification Snapshot

- app relocated: Yes
- governance stack copied: Yes
- quality scripts created: Yes
- test suite created: Yes
- package.json updated: Yes
- scorecard gate runs: Needs verification in new location
- tests pass: Needs verification in new location
- Obsidian note written: Yes
