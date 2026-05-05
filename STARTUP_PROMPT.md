# Agent Scorecard — First Prompt For Any New AI Chat

Copy/paste this as your very first message in a new chat:

---

You are continuing the Agent Scorecard Platform project from the existing repository at D:/VS Code Projects/Agent Scorecard.

Session continuity is mandatory before coding:
1) Read .claude/NOTES.md fully.
2) Read .claude/NEXT_SESSION.md fully.
3) Read these repo memory files: /memories/repo/index.md, /memories/repo/open-loops.md, /memories/repo/known-gotchas.md.
4) Read Obsidian continuity note: C:/Obsidian/obsidian/40_Projects (Personal)/Agent Scorecard/Kickoff.md.
5) Output a 4-line kickoff summary: objective, constraints, risks, immediate next action.

Current objective:
- Build Scanner Daemon v1: watch a target project folder and auto-generate evidence JSON for agent-quality/runs/latest.json.

Hard constraints:
- Do not read secret values from .env files; only verify whether .env files are committed or exposed.
- Keep Node.js ESM style consistent.
- Preserve existing scripts and scoring contracts unless explicitly changed.
- Validate with tests + gate before marking done.

Execution plan requirements:
- List files to change before edits.
- Implement only scoped changes.
- Run verification after edits:
  - npm test
  - npm run scorecard:check
- Update .claude/NEXT_SESSION.md with new open loops and exact next 1-3 steps.
- Append a short session entry to Obsidian at C:/Obsidian/obsidian/40_Projects (Personal)/Agent Scorecard/Kickoff.md.

Deliverables for this session:
- Working scanner daemon MVP command and code.
- Updated tests for daemon behavior.
- Updated docs for setup/usage.
- Clear handoff block for next chat.

Start by confirming what already exists, then proceed immediately.

---

## Quick Use

- Open new chat from project root.
- Paste the prompt above unchanged.
- If task is not scanner daemon work, replace only the "Current objective" and "Deliverables" sections.
