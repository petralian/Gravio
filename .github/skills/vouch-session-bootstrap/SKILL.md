---
name: vouch-session-bootstrap
description: Load Vouch continuity context at session start, recover open loops, and produce an execution-ready kickoff summary.
---

# Vouch Session Bootstrap

Use this skill at the start of any non-trivial task to ensure continuity and reduce repeated mistakes.

## Trigger Conditions
- New session starts and task is more than a one-file edit.
- User asks to continue prior work.
- User asks for planning across multiple files, deploys, or integrations.

## Workflow
1. Read .claude/NOTES.md and extract:
- latest session outcomes
- unresolved items
- architecture constraints relevant to the task area

2. Read .claude/NEXT_SESSION.md and extract:
- current top priority
- blockers and owner
- exact next 1-3 executable steps

3. Read repo memory files under /memories/repo/:
- index.md
- open-loops.md
- known-gotchas.md

4. If user explicitly requests deploy in this session:
- check scripts/pre-deploy-check.ps1 requirements in .github/copilot-instructions.md
- do not deploy until lock workflow is acknowledged

5. Output a concise kickoff summary:
- current objective
- known constraints
- risks
- immediate next action

## Output Template
- Objective:
- Continuity context:
- Risks to avoid:
- Next action now:

## Rules
- Do not edit files during bootstrap.
- If notes and memory conflict, treat live code + latest notes as source of truth and flag conflict.
- Keep kickoff summary under 12 lines unless user asks for detail.
