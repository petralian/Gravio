# Gravio — Session Bootstrap Prompt (Start / End / New Project)

Copy/paste this as your first message in any new Gravio chat.

---

You are continuing the Gravio project from this repository at D:/VS Code Projects/Gravio.

Apply these three protocols as mandatory checklists:

1) Start of Session (guided bootstrap)
2) End of Session (closure protocol)
3) Start of New Project (full scaffold) when and only when the user asks to initialize a brand-new repo

Start-of-session steps before coding:
1. Fill session context:
  - Feature/issue:
  - Why now:
  - Expected outcome:
  - Scope estimate: 1 file / 3-5 files / major refactor
2. Read continuity sources in this order:
  - Obsidian `Home.md`
  - Obsidian `Operations/Session Summaries.md`
  - Related feature and architecture notes
  - `.claude/NOTES.md`
  - `.claude/NEXT_SESSION.md`
3. Create/update today's session note at `Operations/Sessions/YYYY-MM-DD <Topic>.md` with:
  - goals checklist
  - current git state + blockers + last deployed commit
  - `## Obsidian Pre-Scan` findings
  - roadmap with ✅ / ⚠️ / 🔲 statuses
4. If request is ambiguous, ask 2-3 focused clarification questions before editing.
5. If changing 3+ files, present a file-by-file plan and wait for confirmation.

Execution standards:
- Read full relevant files before edits.
- Track work in a todo list and complete one item at a time.
- Keep scope tight; avoid unrelated refactors.
- Verification baseline after edits:
  - npm test
  - npm run scorecard:check
  - npm run secret-scan (for release-sensitive changes)

End-of-session closure gate (must pass all):
1. All todos resolved or explicitly carried forward.
2. `git status --short` clean (or user explicitly approves keeping changes uncommitted).
3. `npm test` passing.
4. Obsidian updates complete:
  - touched Feature notes updated
  - session note finalized (commit hash, suggested-not-implemented items, next session start)
  - summary appended to `Operations/Session Summaries.md`
5. Respond with the standard session footer block from `.github/copilot-instructions.md`.

Refusal triggers for declaring closure:
- Uncommitted changes exist and user has not decided commit/discard.
- Tests are failing.
- Obsidian MCP unavailable and retry not attempted at session end.

New-project trigger:
- If user asks to create a new project, execute the full scaffold flow including:
  - project identity capture
  - copied/adapted `.vscode/`, `.claude/`, and `copilot-instructions.md`
  - `.vscode/mcp.json` with both project vault + `00_Brain`
  - tooling verification + initial commit/tag
  - permanent memory files for user and repo scopes

Start by auditing what already exists, report gaps, then implement missing pieces end-to-end.

---

## Quick Use

- Open new chat from repository root.
- Paste this prompt unchanged.
- Replace only the objective-specific details when needed.
