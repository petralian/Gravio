# Copilot Instructions

> Auto-loaded into every chat session. Two parts:
> **Part A** is project-specific (Gravio).
> **Part B** is a reusable, project-agnostic engineering ruleset — copy verbatim into any new project.

---

# PART A — Gravio (this project)

## Session Continuity Bootstrap (Mandatory)

At the start of every non-trivial session, read universal rules **before** project vault notes:

1. **Brain first** — read via the `obsidian-brain` MCP server:
   - `00_Brain/AI Agent Methodology.md` — note taxonomy, session loop, anti-patterns
   - `00_Brain/Conventions/Deploy Playbook.md` — session-end footer template
   - **Path safety (mandatory):** for `mcp_obsidian-brai_*` reads, always pass absolute paths rooted at `C:\Obsidian\obsidian\00_Brain\...`.
   - Never pass relative `00_Brain/...` paths to `mcp_obsidian-brai_*`; relative paths may be resolved against the workspace and trigger access-denied errors.
2. Then follow the Session Memory Loop below.

If the `obsidian-brain` server isn't responding: Command Palette → **MCP: Reset Cached Tools**.

### Manual Prompt Integration (Mandatory)

The following Brain manual prompts are now part of the default operating model for Gravio sessions:

- `00_Brain/Manual Prompts/Start of Session.md`
- `00_Brain/Manual Prompts/End of Session.md`
- `00_Brain/Manual Prompts/Start of New Project.md`

Apply them as executable checklists, not reference notes:

1. **Start-of-session enforcement:**
   - Fill session context (`feature/issue`, `why now`, `expected outcome`, scope size).
   - Read project context notes first (`Home.md`, `Operations/Session Summaries.md`, related `Features/*`, related `Architecture/*`).
   - Record pre-scan findings under `## Obsidian Pre-Scan` in the current session note before implementation.
   - If the request is ambiguous, ask focused scope questions before edits.
2. **End-of-session enforcement:**
   - Validate todo completion status.
   - Run `git status --short`; if uncommitted changes exist, do not close the session as complete.
   - Run `npm test`; if tests fail, do not close the session as complete.
   - Update touched Feature notes, finalize session note, and append session summary.
3. **New-project enforcement:**
   - For any new-repo scaffolding request, execute the full `Start of New Project` sequence including MCP wiring for both project vault and Brain (`.vscode/mcp.json` with both servers).
   - Preserve Part B of these instructions verbatim when cloning instruction baselines to new projects.
   - Ensure permanent memory artifacts are created for the new project (`/memories/<Project>.md` and `/memories/repo/<Project>.md`).

---

## TOP RULE: Session Memory Loop (Obsidian)

Every chat session **must** follow this loop — no exceptions:

1. **Session start:** Call `mcp_gravio-obsidi_obsidian_write` to create (or overwrite) a session note at `Operations/Sessions/YYYY-MM-DD <Topic>.md`. The note must contain:
   - Session goals as checkboxes
   - Current state: uncommitted files, blockers, last deployed commit
   - Active phase roadmap with ✅ / ⚠️ / 🔲 status markers
   - Manual steps the user must perform (never omit these)
   - Key decisions and notes
   - **Obsidian scan results** — list of related notes read and what was found (see rule 1a below)
   - **Relational links** — `[[WikiLinks]]` to every feature, design, and prior session note touched (see rule 1b below)

1a. **Before implementing any new feature:** Read `Operations/Session Summaries.md` and any topically related notes in the vault (e.g. `Design/UX Guidelines.md`, phase roadmap notes, prior session notes on the same topic). List in the session note:
   - Which notes were read
   - Any prior decisions, constraints, or completed work that affects this feature
   - Any contradictions or dependencies found
   This scan result must appear under a `## Obsidian Pre-Scan` heading in the session note. Never skip this — prior notes may contain design decisions, phase contracts, or manual steps that invalidate a naive implementation.

1b. **Vault knowledge graph — relational linking rules:**

   **Vault structure:**
   - `Features/<FeatureName>.md` — one note per major feature (Billing, Auth, Dashboard, Scanner, CLI, E2EE). Lives permanently, updated each session that touches it.
   - `Design/UX Guidelines.md` — UI/UX patterns. Read before any front-end work.
   - `Operations/Sessions/YYYY-MM-DD <Topic>.md` — per-session notes.
   - `Operations/Session Summaries.md` — running log, one line per session.

   **Linking rules (use `[[WikiLink]]` syntax throughout):**
   - Every session note must open with a `## Related Notes` section listing `[[WikiLinks]]` to every Feature and Design note it touches.
   - Every Feature note must contain a `## Sessions` section listing `[[WikiLinks]]` back to every session that changed it.
   - Every Feature note must contain a `## Related Features` section listing `[[WikiLinks]]` to features it depends on or that depend on it.
   - When a new feature touches an existing feature's code (e.g. Billing reads Auth user state), add a cross-link in both Feature notes.

   **When to update Feature notes:**
   - Session start: read every Feature note that will be touched; add session link to its `## Sessions` section.
   - New feature request: check if a Feature note exists; create one if not, using the template below.
   - After implementation: update the Feature note's status, decisions, and phase tracking.
   - After git commit: add the commit hash to the Feature note's `## Commits` section.
   - After deploy: mark the Feature note's current deployed phase.

   **Feature note template:**
   ```markdown
   # Feature: <Name>
   **Status:** 🔲 Planned | ⚠️ In Progress | ✅ Live
   **Owner files:** `src/...`
   **Related features:** [[Feature A]] · [[Feature B]]

   ## Phases
   ### ✅ Phase N — <title> (commit abc1234)
   - bullet points of what was done

   ### 🔲 Phase N+1 — <title>
   - bullet points planned

   ## Decisions
   - key architectural decisions

   ## Sessions
   [[YYYY-MM-DD Session Title]] · [[...]]

   ## Commits
   - `abc1234` — description
   ```

2. **During the session — after every suggestion or implementation:**
   - Mark completed items ✅ in the session note via `mcp_gravio-obsidi_obsidian_write` (full overwrite keeps it clean) or `mcp_gravio-obsidi_obsidian_append` for additions.
   - Add any new todos, blockers, or dependencies immediately — do not wait until end.
   - If you suggest something that was not implemented yet, mark it 🔲 with "SUGGESTED" tag.
   - Update the relevant Feature note(s) with the change.

3. **After every git commit or deploy:**
   - Add the commit hash + description to the Feature note's `## Commits` section.
   - Mark the deployed phase as ✅ in the Feature note.
   - Update the session note with the commit hash.

4. **Session end:** Update the session note and all touched Feature notes one final time. Append a one-line summary to `Operations/Session Summaries.md`.

**Vault path for session notes:** `Operations/Sessions/`
**Vault path for feature notes:** `Features/`
**Vault path for architecture notes:** `Architecture/` — `Tech Stack.md`, `Database Schema.md`, `API Routes.md`, `Security Model.md`
**Master methodology note:** `Meta/AI Agent Methodology.md` — read this at session start if unsure about the system.
**Never skip this loop.** If the Obsidian MCP tool is unavailable, log a warning and continue, but retry at session end.

---

## Project Identity

- **App:** Gravio — AI Agent Quality Engine (scan, score, encrypted publish, decrypt-in-browser dashboard)
- **Stack:** Node.js 20+ ESM · `node:http` (no framework) · Vanilla JS web UI · `better-sqlite3` · `node:test`
- **Repo:** `D:\VS Code Projects\Agent Scorecard`
- **Domain:** `https://gravio.dev` (Fly.io app `gravio-platform`)
- **Origin:** Extracted from Vouch on 2026-05-05; standalone since.

## Key Paths

| Concern | Path |
|---|---|
| HTTP server / all routes | `src/server.mjs` |
| Evaluator core | `src/core/evaluate.mjs` |
| E2EE crypto | `src/core/crypto-e2ee.mjs` |
| Web pages (static) | `src/web/*.html` |
| Shared header/footer partials | `src/web/partials/*.html` |
| Site chrome loader (header/footer/auth) | `src/web/site-chrome.js` |
| Scanner daemon | `scripts/scanner-daemon.mjs` |
| Tests | `tests/*.test.mjs` |
| Long-form decisions / route map | `.claude/NOTES.md` |
| Session handoff | `.claude/NEXT_SESSION.md` |

## Web architecture (important)

- Every page (`index.html`, `onboarding.html`, `dashboard.html`, `tool.html`) includes:
  - `<div data-site-header></div>` and `<div data-site-footer></div>` placeholders
  - `<script src="site-chrome.js"></script>` **before** any page-specific script
- Header/footer markup lives only in `src/web/partials/header.html` and `partials/footer.html`. Edit there once → applies everywhere.
- Auth state in the header is driven by `data-auth-only` and `data-anon-only` attributes; `site-chrome.js` toggles them via the global `[hidden] { display: none !important }` rule. **Never** add CSS that overrides `[hidden]`.
- `site-chrome.js` exposes `window.siteChrome.refresh()` for pages that change auth state (e.g. the onboarding modal calls it after sign-in).
- `login.html` is a standalone shell (no shared header) by design — it's the auth surface itself.

## Deploy — Fly.io

```bash
flyctl deploy --app gravio-platform
```

After every deploy:
```powershell
git push origin main
curl https://gravio.dev/health     # must return {"status":"ok"}
```

If `package.json` `version` was bumped:
```powershell
git tag v$(node -p "require('./package.json').version")
git push origin --tags
```

> **Always run `flyctl deploy` in `mode='sync'` with `timeout=300000`.** Async mode loses output if polling stops.

## Test commands

```powershell
npm test                  # full suite (must be 0 failures before deploy)
npm run secret-scan       # check for accidentally-committed secrets
npm run scorecard:check   # gate own scorecard
npm run verify            # all of the above
```

Baseline: **70 tests, 0 failures**. A deploy with red tests is forbidden.

Session closure gate: if `git status --short` is not clean or `npm test` is failing, do not mark session closed.

## Update triggers — `.claude/NOTES.md`

Update NOTES.md when:
- A new HTTP route is added or an existing one's purpose changes
- A new env var is required (or default changes)
- A new SQLite table or column is added
- A new web page is added under `src/web/`
- A bug reveals a non-obvious architectural constraint
- A crypto contract or wire format changes (anything in `crypto-e2ee.mjs` or the `/api/publish` shape)

## Gravio-specific code rules

1. **Server-served partials:** `src/server.mjs` falls back to serving any file under `WEB_DIR`, so `partials/*.html` and `site-chrome.js` "just work" — do not add explicit routes for them. **Do not** move partials outside `src/web/`.
2. **Auth gates** are enforced in `src/server.mjs` for `/tool`, `/api/evaluate`, `/api/publish`. New protected routes must replicate the same `requireSession(req)` pattern, not invent a new one.
3. **Zero-knowledge contract:** the server must never see plaintext run JSON. Any new endpoint that accepts run data must accept ciphertext only. If you're tempted to add server-side decrypt for "analytics", stop and ask first.
4. **Canonical host redirect:** GET requests on `gravio-platform.fly.dev` or `www.gravio.dev` 308 to `gravio.dev`. Don't bypass this when adding routes; if a new route should be exempt (e.g. `/.well-known/...`), add it to the exemption list in the redirect block.
5. **No build step.** Web JS is served raw. Don't introduce bundling, JSX, or TS without explicit user approval.
6. **`[hidden]` is sacred.** Never write CSS that sets `display:` on a selector that might also receive the `hidden` attribute. The global `[hidden] { display: none !important }` rule at the top of `styles.css` exists because three separate visual bugs were caused by `.m-btn { display: inline-flex }` and `.ob-auth-modal-wrap { display: grid }` overriding the attribute. Use the attribute, not class toggles, for visibility.
7. **CLI bundle is committed, not built at deploy time.** Users download `https://gravio.dev/cli/gravio.mjs` — a single self-contained file produced by `npm run build:cli` (esbuild). Whenever you change `scripts/scanner-daemon.mjs`, `src/core/scanner-daemon.mjs`, or `src/core/crypto-e2ee.mjs`, you **must** also run `npm run build:cli` and commit the regenerated `src/web/cli/gravio.mjs` in the same commit. The Dockerfile uses `npm ci --omit=dev`, so esbuild is unavailable in the container — never rely on rebuilding at deploy time.

## Gravio UI/UX Hard Rules

Full rationale and pattern reference: `Design/UX Guidelines.md` in the Obsidian vault.

**Before writing any new front-end page or component, read `Design/UX Guidelines.md` first.**

### Navigation
8. **SPA views use show/hide, not navigation.** In-page transitions between major sections must use `showView(name)` toggling the `hidden` attribute — never `location.href` or `<a>` links pointing to the same page.
9. **URL must reflect detail state.** Navigating into a detail view must call `history.pushState/replaceState` (e.g. `?project=id`). `popstate` must restore the correct view. URL param must auto-navigate on page load.

### Collections & Detail
10. **Cards, not lists.** Any collection of user-owned items (projects, runs, scans) renders as a card grid (`.db-projects-grid` + `.db-proj-card`), not a `<ul>/<li>` list.
11. **Workspace anatomy is fixed.** Every detail view must have: (a) back nav bar, (b) hero header with name + score + rating badge + trend badge, (c) tab bar + tab panels. Do not omit any of these three layers.
12. **Tabs use `hidden`, not `display:none`.** Tab panel visibility is controlled with the `hidden` attribute only — never a CSS class that sets `display`.

### Visual Language
13. **Reuse badge helpers.** Score color → `scoreColorClass(score)`. Rating badge class → `ratingBadgeClass(rating)`. Trend badge HTML → `trendBadgeHtml(direction, delta)`. Do not invent new color/badge logic.
14. **Relative timestamps as primary label.** Always use `formatDateRelative(ts)` for visible time labels. Full datetime goes in the `title` attribute only.
15. **Every list has an empty state.** No blank areas — use `.db-empty-state` with title + sub-text whenever a collection is empty or a search returns 0 results.
16. **Search + sort on any sizeable list.** Any list that could exceed 5 items must have a `.db-search-input` (real-time client-side filter) and `.db-sort-select` (recent / score / name). No server round-trips per keystroke.

### Separation of Concerns
17. **Settings stay in `/settings`.** API keys, plan info, account credentials, and E2EE tools must never appear on the dashboard. Link to `/settings` from the dashboard header.

### Feedback & Errors
18. **No silent no-ops.** Every action that can fail must show an inline error via `showError(el, msg)` adjacent to the trigger. Never use `alert()` or `console.error` only.
19. **In-flight state.** Disable the triggering button and change its label to "Loading…" during any fetch. Re-enable in `finally`.

---

# PART B — Standardized Engineering Rules (project-agnostic)

> Copy this entire section verbatim into any new project's copilot-instructions.md.
> Replace nothing — these rules apply everywhere.

## Session End Protocol

At the end of **every** response that involved code changes, file edits, or deploys, append:

```
---
**Changes made:** <one-line summary>
**Files changed:** <comma-separated list>
**Deploy needed:** <Yes/No> — <why> — <done ✓ / pending>
**Rollback tag:** <`vX.Y.Z` if tagged, else `None`>
**Notes updated:** <Yes / No / N/A>
**Obsidian:** <read ✓ / written ✓ / path — OR "skipped: <reason>"> — proof the memory loop ran
**Git commit:** <short hash + message, or `N/A`>
**Self-improvements:** <`None` OR exact file path + line(s) where the rule was written>
**Next session priority:** <highest open item or `None`>
**Test plan:** <how the change was verified, or `N/A`>
```

The `Obsidian` line is **mandatory** on every footer — never `N/A`. It proves the memory loop ran: note was read at session start, updated after each change, and will be closed at session end. If the MCP tool is unavailable, write `skipped: MCP unavailable` and retry at session end.

Skip this block only for purely conversational answers (no files touched).

## Self-Improvement Protocol

After every non-trivial session, ask:
1. *Did I learn anything that should be a permanent rule?* → write it into this file (Part A or Part B as appropriate) and cite the file path + line in the Session End footer.
2. *Did I repeat a mistake?* → write the rule that prevents the **category**, not just the instance.
3. *Did I debug something for >5 minutes or get it wrong on the first try?* → a rule or memory would have prevented it. Write it.

The footer's `Self-improvements` field must contain a verifiable file citation (e.g. `.github/copilot-instructions.md:L142`) or the literal word `None`. Vague prose like "Lesson recorded" is unacceptable.

## Code Discipline

1. **Read before writing.** Always read the full relevant file before editing.
2. **One change at a time.** Don't refactor adjacent code while fixing a bug.
3. **Don't gold-plate.** Implement exactly what was asked. No extra abstractions, no unrequested "improvements".
4. **No dead code.** If you replace a function/route, delete the old one in the same commit.
5. **Avoid unnecessary files.** Prefer editing existing files. Don't create docs unless asked.
6. **Pin dependencies.** Use exact versions for any package that ships breaking changes between minors. Use `npm ci` (not `npm install`) in CI.
7. **Verify assumptions before coding.** If unsure about a third-party API behaviour, fetch the docs first — never iterate on stale memory.

## Pre-Implementation Checklist

Before writing a single line of code:
- [ ] **Obsidian pre-scan:** Read `Operations/Session Summaries.md` and any topically related vault notes. Record findings under `## Obsidian Pre-Scan` in the session note. Never skip.
- [ ] Read the relevant existing file(s) fully — not just snippets.
- [ ] **For 3+ file changes:** state a plan first, list every file + reason, flag destructive steps, wait for user confirmation.
- [ ] If extending a multi-item system: read **all existing items** of the same kind, list their behavioural contract, replicate 1:1.
- [ ] If touching UI/CSS: identify the existing pattern in sibling files. Reuse, don't reinvent.
- [ ] If touching a third-party integration: fetch the current docs (don't trust memory).

## Post-Implementation Checklist

Before declaring done:
- [ ] Run the full test suite — must be 0 failures.
- [ ] If TypeScript: `tsc --noEmit` error count must not increase.
- [ ] If buildable: `npm run build` must exit 0.
- [ ] Update long-form notes (`.claude/NOTES.md` or equivalent) for any architectural change.
- [ ] Update `CHANGELOG.md` (if the project has one) under `[Unreleased]`.
- [ ] If deployed: run a health-check curl and confirm 200/expected response.
- [ ] If version bumped: tag the commit and push the tag.
- [ ] Append the Session End Protocol footer.

## Visual Consistency — UI/CSS

Before writing any front-end CSS or component:
1. **Read sibling component files first.** Find the existing pattern. Do not invent.
2. **Reuse design tokens.** If the project has a token table (CSS custom properties, theme file), use those exact values.
3. **Same component → same class.** A modal looks like every other modal. A card uses the same surface treatment as every other card.
4. **`[hidden]` always wins.** Never write CSS with `display:` on a selector that may also receive the `hidden` HTML attribute. Add a global `[hidden] { display: none !important }` rule once per project.
5. **Mentally place the element on a real page.** If anything looks like a footnote next to body text, fix it.

## UX Guidelines

For every interactive component, answer all five before shipping:
1. **Discoverability** — can a user tell at a glance the element is interactive and what it does?
2. **Multi-vs-single selection** — default to multi-select for lists where bulk action is plausible.
3. **Inline validation feedback** — never silent no-ops. If a button can't fire, show why immediately adjacent.
4. **Button labels reflect state** — e.g. "Withdraw selected (3)" not "Withdraw selected"; "Submitting…" while in-flight.
5. **Required steps come first** — checkboxes/inputs that gate an action sit *above* the action button, not below.

## Destructive Action Rule

Any button that deletes, removes, disconnects, withdraws, or performs an irreversible action **must** use two-step inline confirmation: first click reveals "Are you sure? Yes / Cancel"; second click fires the action. Never fire on first click. Inline expansion only — do not use modals for confirmation (they hide context).

## Safety Gate Audit

Whenever you implement a mechanism whose purpose is to *prevent* something bad (lock, guard, validation, rate limit, permission gate), run all six checks before declaring it done:

1. **Error path bypass** — can a crash skip the gate entirely? Failure must be BLOCK, not PASS.
2. **Permanent lock / no recovery** — what if the holder crashes? Auto-recovery (e.g. age-based stale detection) required.
3. **Input validation on required fields** — placeholders must be rejected, not silently accepted.
4. **Correct state assumption** — name the variable being checked; verify it actually reflects the runtime state.
5. **Blast radius** — list every other file/agent/doc that depends on this mechanism. Update them all.
6. **Hostile self-review** — re-read looking for: skipped steps, copy-pasted placeholders, doc/code drift.

If any check is skipped, the task is not done.

## Tool Routing Safety

Before any file edit, classify the path:
- Workspace/repo paths → workspace edit tools (`replace_string_in_file`, `create_file`, `read_file`).
- External tool paths (Obsidian, MCP, etc.) → that tool's native API only.

If a tool reports `Access denied — path outside allowed directories`, stop that tool family immediately and switch to the correct one. When uncertain, list allowed directories first.

## Communication

- Be brief. Target 1–3 sentences for simple answers. Expand only for complex work or when requested.
- Skip framing ("Here's the answer:", "I will now…").
- Confirm completed file operations briefly; don't restate everything you did.
- No emojis unless explicitly requested.
- File references in Markdown must be linkified: `[path/file.ts](path/file.ts#L10)` — never wrapped in backticks.

## Git Commit Convention

```
<type>(<scope>): <short description>

Types: feat | fix | style | refactor | chore | docs | test
Scope: short module name

Examples:
  feat(web): add modular header/footer + fix [hidden]-attr override
  fix(server): correct canonical-host redirect path
  chore(deps): pin better-sqlite3 to 12.9.0
```

## Multi-Session Safety

If multiple Copilot sessions can run concurrently against the same deploy target:
- Pull before deploy: `git fetch origin && git log HEAD..origin/main` — if remote has new commits, stop and rebase first.
- After deploy: `git push origin main` immediately. Never let local lead remote.
- For destructive ops (DB migrations, force-push), require explicit user confirmation regardless of policy.
