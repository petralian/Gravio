# Vouch — Copilot Workspace Instructions

> Auto-loaded into every chat session. Keep this concise and actionable.
> See `.claude/NOTES.md` for full architecture reference, DB models, route map, and session log.

---

## Project Identity

- **App:** Vouch — Shopify embedded social commerce suite
- **Stack:** React Router 7 · Polaris WC (CDN) · Prisma 7 (SQLite · better-sqlite3 adapter) · Shopify App Bridge
- **Versions:** Vite 8.0.8 · React 19.1.0 · React Router 7.14.1 · TypeScript 6.0.2
- **Store:** `vouch-4577.myshopify.com`
- **Server:** `https://vouch-77sh.fly.dev` (Fly.io, app `vouch-77sh`)
- **API version:** `2026-04`

---

## Session Continuity Bootstrap (Mandatory)

At the start of every non-trivial session, run the bootstrap workflow before writing code:

1. Read `.claude/NOTES.md` (latest decisions + session log)
2. Read `.claude/NEXT_SESSION.md` (active handoff + open loops)
3. Read `/memories/repo/index.md`, `/memories/repo/open-loops.md`, and `/memories/repo/known-gotchas.md`
4. Produce a 4-line kickoff summary: objective, constraints, risks, immediate next action

This is the default continuity mechanism that links every new session to prior work.

---

## Session End Protocol

At the end of **every** response, append a brief section using this format:

```
---
**Changes made:** <one-line summary of what was modified>
**Files changed:** <comma-separated list>
**Deploy needed:** <Server / Extensions / Both / None> — <why> — <done ✓ / pending>
**Rollback tag:** <`vX.Y.Z` if deployed and tagged, else `None`>
**Notes updated:** <Yes / No>
**Changelog updated:** <Yes / No>
**Git commit:** <short hash + message, or `N/A`>
**Self-improvements:** <MUST be one of: `None` — OR — exact file path(s) + line numbers where the rule/memory was written, e.g. `.github/copilot-instructions.md:L223` + `/memories/repo/foo.json`. Vague descriptions like "Lesson recorded" with no file citation are NOT acceptable and will be treated as if nothing was written.>
**Next session priority:** <highest open issue or `None`>
**Test plan:** <brief description of how you verified the change, or `N/A`>
**Agents invoked:** <agent names if subagents were used, else `None`>
```
**Remember to update this section accurately before ending the session. It is critical for team communication and project continuity.*
```

> The session end block is a contract with the user. Never skip it. If you deploy, the rollback tag must be present so the user can recover at 2am without asking you.

---

## Multi-session deploy coordination

> Multiple Copilot sessions can be open at the same time. Without coordination, two sessions can `git push` or `flyctl deploy` concurrently — one overwrites the other or the deploy fails mid-flight.

**Rule: run `pre-deploy-check.ps1` before every deploy, and `release-deploy-lock.ps1` after.**

```powershell
# Before any deploy — MANDATORY
.\scripts\pre-deploy-check.ps1 -Type server -Session "feat(feed): brief description"
# If it exits 1 (BLOCKED), stop and inform the user. Do NOT override.

# After deploy completes (success or failure) — MANDATORY
.\scripts\release-deploy-lock.ps1
```

The script does five things, in this order:
0. **Placeholder guard** — rejects `-Session` if it matches a known placeholder string (e.g. the default example text).
1. **Lock check** — if `.vouch-deploy.lock` exists, checks age. Auto-removes if > 30 min old (stale). Otherwise, **polls every 10 seconds for up to 10 minutes** (60 checks), proceeding automatically when the lock is released. Exits 1 only if still held after 10 minutes.
2. **Flyctl process check** — warns (does not block) if another `flyctl` process is already running.
3. **Remote check** — runs `git fetch origin` and checks `git log HEAD..origin/main`. If remote has commits the local branch doesn't have, exits 1 with instructions to `git pull --rebase`.
4. **Lock write** — creates `.vouch-deploy.lock` with session, type, start time, and PID.

**If blocked by an active lock — what happens:**
The script automatically polls every 10 seconds for up to 10 minutes (60 checks). It prints a countdown and proceeds automatically when the lock is released. No user input needed — just wait.

If the lock is still held after 10 minutes, the script exits 1 with force-release instructions. Tell the user:
> "The deploy lock is still held after 10 minutes. If the other session's deploy has definitely finished or crashed, run: `Remove-Item .vouch-deploy.lock -Force` then I'll retry."

**DO NOT override the lock manually** unless certain no deploy is in progress. Concurrent deploys corrupt Fly.io machine state.

**Stale lock auto-recovery:** The script automatically removes a lock if it is > 30 minutes old (checked both at startup and during the polling loop).

---

## Deploy Decision Guide

### Server → Fly.io
Run when any of the following changed:
- `app/routes/**`, `app/utils/**`, `app/shopify.server.ts`, `app/root.tsx`
- `prisma/schema.prisma` (migrations auto-run in Dockerfile)
- Any env var added or changed (set via `flyctl secrets set KEY=value`)

**If this deploy includes a DB migration — MANDATORY backup first:**
```powershell
fly ssh console --app vouch-77sh -C "cp /data/prod.db /data/prod.db.bak"
```
> SQLite on Fly volumes is ephemeral. This backup is your only restore point if a migration corrupts data. Confirm the command exits successfully before proceeding to deploy.
> **Windows PowerShell limitation:** `flyctl ssh console -C` fails on Windows with "Error: The handle is invalid" (pseudo-TTY issue). For **additive-only** migrations (`ADD COLUMN` with a `DEFAULT` value), this backup can be safely skipped — no data loss is possible. For **destructive** migrations (DROP COLUMN, DROP TABLE, data reshaping), run the backup from WSL or a real SSH client before deploying.

```powershell
# Acquire deploy lock (exits 1 and STOPS if another session is deploying)
.\scripts\pre-deploy-check.ps1 -Type server -Session "feat(scope): brief description"
```

```bash
flyctl deploy --app vouch-77sh
# If lease acquisition hangs:
flyctl deploy --app vouch-77sh --strategy immediate
```

> **ALWAYS run `flyctl deploy` and `npx shopify app deploy` in `mode='sync'` with `timeout=300000` (5 minutes).** Never use `mode='async'` for deploy commands. Async mode returns before the deploy produces output, requiring repeated `get_terminal_output` polling — and if you stop polling before the deploy finishes, you lose the result. Sync mode with a 5-minute timeout waits for the full output automatically.

**After every server deploy — mandatory:**
```powershell
# 0. Release deploy lock (always — even if deploy failed)
.\scripts\release-deploy-lock.ps1
# ⚠️  If it prints "No deploy lock found — nothing to release", that is an ANOMALY.
#     The lock SHOULD exist. Do NOT silently accept this. Investigate:
#     Was the lock auto-released during polling? Did the pre-deploy-check create it in
#     a different working directory? Fix before declaring the deploy done.
# 1. Commit changelog + any updated docs
git add CHANGELOG.md
git commit -m "chore: update changelog"
# 2. Push to GitHub to keep remote in sync
git push origin main
# 3. If package.json version was bumped, tag the commit
git tag v$(node -p "require('./package.json').version")
git push origin --tags
# 4. Verify the app is healthy
curl https://vouch-77sh.fly.dev/health
# Must return: {"status":"ok"}
```
> Never deploy to Fly.io without also pushing to GitHub in the same session.

### Extensions → Shopify CLI
Run when any of the following changed:
- `extensions/vouch-theme/**`
- `extensions/vouch-customer-account/**`
- `extensions/vouch-functions/**`

```powershell
# Acquire deploy lock (exits 1 and STOPS if another session is deploying)
.\scripts\pre-deploy-check.ps1 -Type extension -Session "feat(scope): brief description"
```

```bash
npx shopify app deploy --allow-updates
```

**After every extension deploy — mandatory:**
```powershell
# 0. Release deploy lock
.\scripts\release-deploy-lock.ps1
# ⚠️  If it prints "No deploy lock found — nothing to release", that is an ANOMALY — investigate.
# 1. Push to GitHub
git push origin main
```

> Extensions and server are **independent deployments** — only deploy what changed.

---

## Version Bump Guide

Update `version` in `package.json` when:

| Change type | Bump |
|-------------|------|
| New user-facing feature (new module, new setting, new block) | **minor** (0.x.0) |
| Bug fix or small UI improvement | **patch** (0.0.x) |
| Breaking DB migration or API contract change | **major** (x.0.0) |

Do **not** bump for: refactors, copy changes, CSS tweaks, or config adjustments.

**After every version bump that is deployed, create and push a git tag:**
```powershell
git tag v$(node -p "require('./package.json').version")
git push origin --tags
```
This enables `git checkout v1.3.0` instant rollback if production breaks. Tags should match CHANGELOG versions exactly.

---

## NOTES.md Update Triggers

Always update `.claude/NOTES.md` when:
- A new Prisma model or field is added
- A new route is added or an existing route's purpose changes
- A new env var is required
- A bug is found and fixed that reveals a non-obvious architectural constraint
- A Shopify/extension API pattern is confirmed working (or definitively broken)
- The nav structure changes
- A new theme extension setting is added (keep the Key Files table current)

Update this instructions file (`copilot-instructions.md`) when:
- A new project-wide coding rule is established
- A deployment step changes
- A new custom agent or prompt is created
- A repeated session workflow emerges that could become a rule
- A Shopify API limit or constraint is confirmed (add to Checklist or Code Discipline)
- You self-learn something that would have prevented a bug if it had been a rule earlier

---

## Custom Agent Consideration

Ask yourself at the start of each session:

> *"Is this a repeated multi-step workflow that would benefit from a dedicated agent?"*

**Create a custom agent (`.github/agents/*.agent.md`) when:**
- The task has a fixed sequence of 3+ steps that repeat across sessions (e.g. "add a new module", "scaffold a new route + DB model")
- The workflow requires specific tool restrictions (e.g. read-only exploration before writing)
- The task produces a reusable artefact (e.g. migration scripts, extension blocks)

**Don't create an agent when:**
- It's a one-off or exploratory task
- A single prompt or instructions update covers it

Current agents:
- **vouch-batch** — Orchestrator: takes a numbered list of changes, delegates each to `vouch-impl`, returns a summary table. Invoke by @-mentioning or describing "batch changes / list of changes".
- **vouch-impl** — Worker (subagent only, not user-invocable): implements a single scoped task with full Vouch conventions enforced. Spawned by `vouch-batch`.
- **vouch-test** — Read-only: runs the full verification suite (vitest, tsc, build) and reports pass/fail. Use when you want a clean test run without making code changes.
- **vouch-release-manager** — Release orchestrator for deploy gating, deploy execution, post-deploy checks, and rollback metadata.
- **vouch-handoff-writer** — Updates `.claude/NEXT_SESSION.md` with strict open-loop + next-step handoff details.
- **Explore** — Read-only codebase exploration (built-in VS Code agent — no `.agent.md` file). Use before writing code in an unfamiliar area.

Current skills:
- **vouch-session-bootstrap** — Mandatory continuity boot at session start for non-trivial work.
- **vouch-extension-safety-guard** — Pre/postflight checks for theme + customer account extension changes.
- **vouch-migration-safety** — Prisma migration classification, drift control, and deploy preconditions.
- **vouch-third-party-compliance-check** — Mandatory docs/TOS alignment before Shopify/IG/TikTok integration changes.

### When to invoke each agent

| Situation | Action |
|-----------|--------|
| User gives 3+ numbered/bulleted tasks | Use `vouch-batch` — never implement a list directly |
| You need to understand a large file or area before writing | Use `Explore` (keeps main conversation clean) |
| User wants a test run with no code changes | Use `vouch-test` |
| User asks to deploy/release | Use `vouch-release-manager` |
| Session wrap-up or handoff requested | Use `vouch-handoff-writer` |
| Single scoped implementation task (from vouch-batch) | `vouch-impl` is spawned automatically |
| One-off simple change already scoped | Implement directly, no subagent needed |

### When to invoke each skill

| Situation | Action |
|-----------|--------|
| New non-trivial session or resume request | Run `vouch-session-bootstrap` before coding |
| Changing extension Liquid/WC/CSS/feed source rendering | Run `vouch-extension-safety-guard` |
| Editing `prisma/schema.prisma` or migrations | Run `vouch-migration-safety` |
| Editing Shopify/Instagram/TikTok integration behavior | Run `vouch-third-party-compliance-check` first |

---

## Self-Improvement Protocol

> Copilot must continuously improve itself. These rules are non-negotiable.

### When to update this file
Update `copilot-instructions.md` immediately when:
- Any new rule, checklist item, or deployment step is established this session
- A Shopify API limit or constraint is confirmed that would affect future work
- A new subagent is created or an existing one's purpose changes
- A repeated workflow emerges (3+ sessions) that could be automated with an agent
- A bug was caused by a missing rule — add the rule so it never happens again

### When to write to `/memories/repo/`
Write a repo memory (via the `memory` tool) when you learn:
- A confirmed-working build command or deploy flag
- A codebase convention not obvious from a small code sample
- A non-obvious architectural constraint discovered by fixing a bug
- A Shopify API pattern confirmed working after live testing

### When to update `/memories/` (user memory)
- A user preference or working style is observed consistently
- A cross-project lesson emerges (e.g. "always verify npm versions before installing")

### Self-check at every session start
1. Run the **Session Continuity Bootstrap** workflow (NOTES + NEXT_SESSION + repo memories) and output a kickoff summary.
2. Ask: *"Is there a subagent better suited to this request?"* — if yes, use it.
3. Ask: *"Which skill gate applies?"* — extension safety, migration safety, or third-party compliance.
4. Ask: *"Have I seen this pattern before?"* — check `/memories/repo/` before reinventing.

### Self-check at every session end
**Mandatory — answer all three before calling task_complete:**
1. *"Did I learn anything that should be a permanent rule?"* → Update `copilot-instructions.md` and/or `/memories/self-improvement.md`.
2. *"Did I discover a non-obvious codebase fact?"* → Write a `/memories/repo/` entry.
3. *"Did I repeat a mistake I've made before?"* → Write the rule that prevents the whole category, not just the instance.
4. *"Did I change server/runtime code?"* → Explicitly state `Deployed: Yes/No` in the response. If `No`, explicitly offer to run deploy now. Never leave deploy state implicit.

Signal: if I debugged something for >5 minutes or got it wrong on the first try, a rule or memory would have prevented it. Write it.

### Safety Gate Audit — mandatory when implementing any safety/coordination/gating mechanism

> **This rule exists because I built a deploy lock system with 6 exploitable gaps and only found them when the user explicitly asked me to review it. I should have run this audit proactively.**

Whenever I implement a mechanism whose purpose is to *prevent* something bad (a lock, a guard, a validation check, a rate limit, a permission gate), I MUST run all six checks before declaring it done:

1. **Error path bypass** — Can a crash, exception, or unexpected input cause the gate to be *skipped entirely* rather than *blocked*? Check every `try/catch`, `$ErrorActionPreference`, and error handler. The failure mode must be BLOCK, not PASS.

2. **Permanent lock / no recovery** — What happens if the process holding the lock crashes without releasing it? Is there auto-recovery (e.g. age-based stale detection)? If not, one crash permanently blocks all future operations.

3. **Input validation on required fields** — Can the required inputs be satisfied with a placeholder, default, or empty value that looks valid but carries no real information? (e.g. `-Session "feat(scope): brief description"` passing through unchanged). Validate against a known list of placeholder strings.

4. **Correct state assumption** — Am I checking the right thing? Name the concrete variable/value I'm checking and verify it actually reflects what I think it does at runtime. (e.g. checking a subprocess PID that is always dead by the time anyone reads it.)

5. **Blast radius completeness** — Which OTHER files, agents, docs, and checklists reference or depend on this mechanism? List them. Have I updated ALL of them? A gate that isn't mentioned in the agent that triggers the gated action is not enforced.

6. **Self-review as a hostile reviewer** — Re-read the output looking for: skipped numbering, copy-pasted placeholders, inconsistent descriptions between the code and the docs, and any instruction that says "manually do X" without explaining how.

**If I skip any of these six checks, I have not finished the task. The review is not optional.**

**How to fill in the Self-improvements footer field — no shortcuts:**
1. If nothing new was learned → write `None`.
2. If something was learned → call the `memory` tool or `replace_string_in_file` on `copilot-instructions.md` **first**, then copy the exact file path + line number into the footer field. The footer must contain a verifiable citation, not a description. Example: `.github/copilot-instructions.md:L226` or `/memories/repo/liquid-schema-edit-safety.json (created)`.
3. Writing "Lesson recorded" or any other prose without a file path means the write **did not happen**. The user will notice. Do not do this.

### Tool Routing Safety — mandatory for all file edits

> **This rule exists because a repo file edit was accidentally sent to the Obsidian MCP server and failed with an allowed-directory error.**

Before calling any file-edit tool, classify the target path and route to the correct tool family:

1. **Repository/workspace paths** (`D:\VS Code Projects\Vouch\...`) → use workspace edit tools only (`apply_patch`, `replace_string_in_file`, `multi_replace_string_in_file`, `create_file`, `read_file`).
2. **Obsidian vault paths** (`C:\Obsidian\obsidian\40_Projects (Personal)\Vouch\...`) → use `mcp_obsidian-vouc_*` tools only.

Hard constraints:
- Never call `mcp_obsidian-vouc_edit_file`, `mcp_obsidian-vouc_write_file`, or any `mcp_obsidian-vouc_*` file tool for workspace repo files.
- If a tool reports `Access denied - path outside allowed directories`, stop that tool family immediately and retry using workspace-native tools.
- When uncertain, first run `mcp_obsidian-vouc_list_allowed_directories` and verify the target path prefix before editing.

---

## Code Discipline (Critical Rules)

1. **Flat routes only** — `app/routes/app.ugc-feed._index.tsx` not `app/routes/app.ugc-feed/_index.tsx`
2. **Never `Button url=` or `page backAction.url`** — always `useShopNavigate()` + `onAction`
3. **Always `<Form>` from Remix** — never native `<form>`
4. **Redirects must include `?shop=`** — `redirect(\`/app/modules?shop=\${session.shop}\`)`
5. **Server-only imports in loader/action only** — never in component scope
6. **All new routes at one level from `app/`** — `import { authenticate } from "../shopify.server"`
7. **Never run `prisma migrate dev` on local DB without first running `prisma migrate diff`** — local DB drifts from production over time. `migrate dev` will bundle unintended constraint changes (DROP INDEX, CREATE UNIQUE INDEX, etc.) into the migration. Always inspect generated SQL before committing. If in doubt, delete the migration and write it manually.
8. **`<s-select>` requires `<s-option>` children, never native `<option>`** — Polaris Web Components shadow DOM silently discards standard `<option>` elements. Always use `<s-option value="...">Label</s-option>` inside `<s-select>`. Same applies to `<s-option-group>` for grouped options.
9. **`<s-table>` requires Polaris WC children, never native HTML table elements** — `<s-table>` shadow DOM silently discards `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`. The table renders completely empty with no error. The CORRECT structure (verified from Polaris WC source examples): `<s-table-header-row>` is a **direct child of `<s-table>`** (no `<s-table-header>` container wrapper), header cells use `<s-table-header>` (not `<s-table-cell>`), and `<s-table-body>` contains `<s-table-row>` with `<s-table-cell>` children.

    ```html
    <!-- CORRECT -->
    <s-table>
      <s-table-header-row>                          <!-- direct child of <s-table> -->
        <s-table-header>Name</s-table-header>        <!-- header cells: <s-table-header> -->
        <s-table-header>Status</s-table-header>
      </s-table-header-row>
      <s-table-body>
        <s-table-row><s-table-cell>...</s-table-cell></s-table-row>
      </s-table-body>
    </s-table>

    <!-- WRONG — never wrap s-table-header-row in a s-table-header container -->
    <s-table>
      <s-table-header>            <!-- ❌ s-table-header is a CELL, not a container -->
        <s-table-header-row>      <!-- ❌ must be direct child of s-table -->
          <s-table-cell>Name</s-table-cell>  <!-- ❌ header cells must be s-table-header -->
    ```

    **Corollary: never put a `<Form>` (Remix) or `<form>` element inside `<s-table-header>` within a `<s-table-header-row>`.** The browser's HTML parser foster-parents `<form>` elements out of table header contexts, leaving the cells empty and making the entire header row invisible. For interactive sort headers, use `<button type="button" onClick={() => navigate(url)}>` inside `<s-table-header>`. `<Form>` inside `<s-table-cell>` in body rows (`<s-table-row>`) is fine — the issue is specific to header rows.
10. **Shopify section file names ≠ DOM element IDs** — `document.getElementById('cart-drawer')` always returns `null` in Dawn because the section renders `<cart-drawer id="CartDrawer">` (Pascal case). **Never use the section file name as a DOM id.** The correct pattern: request `sections` in the POST body of `/cart/add.js`, parse each section's HTML with `DOMParser`, then update elements by their **actual `id` attributes** found inside that HTML. Also call `cartDrawerEl.open()` directly on the custom element rather than relying on event dispatching.
11. **`purchase.checkout.*` UI extension targets require Shopify Plus — they do NOT work on Basic, Advanced, or any non-Plus plan.** `purchase.thank-you.*` and `customer-account.*` targets work on all plans except Starter. Before building any checkout page extension, confirm the merchant's plan. Symptoms of the plan restriction: extension is completely absent from the checkout editor left panel (not just hidden — literally not there), and nothing renders on the live checkout page. The only workarounds on Basic: (a) cart-page theme extension, (b) thank-you page (already Basic-eligible), (c) upgrade to Plus. Source: https://shopify.dev/docs/apps/build/checkout/technologies and https://help.shopify.com/en/manual/checkout-settings/checkout-extensibility

12. **Never infer `session.shop` from the Shopify admin URL path** — The Shopify admin URL slug (e.g. `store/vouchapp` in `admin.shopify.com/store/vouchapp/...`) is **NOT** reliably the store's `.myshopify.com` domain. Confirmed ground truth for this store: **`vouch-4577.myshopify.com` is the canonical domain** — confirmed by every live Shopify request using `?shop=vouch-4577.myshopify.com`, and by `AppInstallation`/`AppSubscription`/`InstagramConnection` all being keyed to this domain. `vouchapp.myshopify.com` is a Shopify admin URL slug only, NOT the `.myshopify.com` domain. **Before any shop domain migration**, ALWAYS confirm by: (1) checking Fly.io logs for `shop=` in actual HTTP requests — this is the ground truth; (2) running `prisma/db-inspect2.js` to see ALL shop-keyed tables — the key that `AppInstallation` uses IS `session.shop`. Never guess; query logs + ALL tables first.

12. **Liquid schema block files require full-file rewrite when making 2+ changes** — if the file was already partially modified in a prior session, successive replacements corrupt it with merged/duplicate fragments. Rule: read the full file first (`read_file`), then write the complete clean content using `Set-Content` (PowerShell heredoc) or `create_file`. This applies to any `*.liquid` file whose `{% schema %}` block has 2 or more changes needed in the same session.
13. **Never use `aspect-ratio` to enforce square cards when the only child is `position: absolute`** — `aspect-ratio: 1` silently fails on `<button>` and other elements when all children are out of flow (i.e. `position: absolute`). The browser sees an "empty" element and skips the aspect-ratio calculation. **Always use the padding-top intrinsic-ratio technique instead:** `height: 0; padding-top: 100%` on the card + `position: absolute; inset: 0` on the child. This has worked reliably on every element including `<button>` for 15+ years.
14. **Never nest `<fetcher.Form>` or `<Form>` inside another `<Form>`** — nested HTML forms are invalid. The browser closes the outer form when it encounters the inner one, turning the inner form into a standalone top-level form that causes a full-page navigation instead of a fetcher POST. Fix: replace `<fetcher.Form>` with a `<div>`, and call `fetcher.submit({ ...data }, { method, action })` in a `button onClick` handler instead.
15. **Destructive/negative buttons MUST use two-step inline confirmation — never fire on first click.** Any button that deletes, removes, disconnects, withdraws, or performs any irreversible action must reveal an inline "Are you sure?" prompt on first click, not execute immediately. Pattern: add a `fooConfirming` state; first click sets it to `true` (shows confirm text + "Yes, [action]" + "Cancel"); second click fires the action and resets state. This applies to ALL surfaces: admin routes (Polaris `<Button>`), Customer Account extensions (`<s-button>`), theme extension JS. **Do NOT use modals for confirmation** — inline expansion is simpler, avoids the Remote DOM ref limitation, and keeps context visible. Existing compliant examples: ReviewCard delete ✓, IG post Withdraw ✓, Disconnect Instagram ✓ (fixed vouch-216). Whenever you add a delete/remove/disconnect/withdraw button anywhere in the codebase, stop and apply this pattern before moving on.

16. **Every `<s-page>` in a wide-layout route MUST have `inlineSize="large"`** — `<s-page>` defaults to `inlineSize="base"` which causes App Bridge's internal `cs-grid` to apply `gridTemplateColumns: min(100%, 960px)` on the content area, capping the page at ~960px. **`full-width` is NOT a valid attribute on `<s-page>` — it is silently ignored.** The correct fix is `inlineSize="large"` (JSX prop) which means "full width with whitespace". Rule: add `inlineSize="large"` to **every** `<s-page>` that renders a table, grid, or multi-column layout. The only pages that should use the default (`base`) are simple single-column forms. All current Vouch data pages (Social Feed, Moderation Queue, Social Board) use `inlineSize="large"`.

---

## Engineering Standards — How Agents Must Behave

> You are a **seasoned program lead**, not a code typist. These standards are non-negotiable.

### 1. Dependency hygiene — lock tight, watch proactively, catch regressions early

> **Mitigation posture:** Lock dependency versions tightly. Have a disciplined testing layer that catches regressions early. Watch changelogs proactively rather than reactively.

**Locking versions tightly:**
- All dependencies in `package.json` must use **exact versions** (no `^` or `~` prefixes) for Shopify, Prisma, React Router, and Vite — these are the four packages most likely to ship breaking changes between minor/patch releases.
- When adding a new package: pin the exact version you verified. Not `"^2.3.0"` — `"2.3.0"`.
- Run `npm ci` (not `npm install`) in CI and Dockerfile — `ci` respects `package-lock.json` exactly; `install` can silently resolve newer patch versions.

**Watching changelogs proactively:**
- Before adding any new dependency or upgrading an existing one:
  - **Check the package's current stable version** via `https://www.npmjs.com/package/<name>` or the official docs.
  - **Check peer dependencies** — will it conflict with Prisma 7, React 19, or Shopify App Remix v4?
  - **Read the changelog** from the installed version to latest — look for breaking changes, deprecations, and peer dep bumps.
  - **Never assume the version you remember is current.** npm moves fast. A package that was v5 in your training data may be v9 today.

**Catching regressions early:**
- The verification suite (`vitest run` + `tsc --noEmit` + `npm run build`) is **mandatory after every dependency change**, not just code changes.
- The TypeScript error baseline (135) is the regression canary — a dep upgrade that bumps TS errors is a signal something broke.
- If a dep upgrade causes a test or TS failure, **pin back to the prior version immediately** rather than patching forward.

```
# Pattern: always confirm before installing
# 1. fetch_webpage https://www.npmjs.com/package/<name>
# 2. Read changelog from current version → latest
# 3. Verify peer deps against Prisma 7 / React 19 / RR7
# 4. Install exact version — no ^ or ~
# 5. Run: npx vitest run && npx tsc --noEmit && npm run build
```

### 2. Always show a plan before changing 3+ files

> **This rule exists because large multi-file changes without a stated plan are the leading cause of regressions, unintended side effects, and wasted deploy cycles.**

Before writing a single line of code for any change that touches 3 or more files:
1. **List every file that will change and why** — one sentence per file.
2. **Flag any destructive or irreversible steps** (migrations, deletes, renames) explicitly.
3. **Wait for user confirmation** before proceeding. This is non-optional.

For changes to a single file or two files, this step can be skipped — proceed directly.

### 2a. Build a test plan before writing code
For every non-trivial change:
1. **State what you will change and why** — one sentence per file.
2. **Identify what could break** — list affected routes, DB queries, extension behaviour.
3. **Write or update tests** for any new logic in `tests/` (Vitest).
4. **Run the verification suite** after changes:
   ```powershell
   npx vitest run          # unit tests must pass
   npx tsc --noEmit        # TS errors must not increase
   npm run build           # build must exit 0
   ```
5. **Do not deploy** until all three pass.

### 2b. Platform TOS compliance — mandatory before touching any third-party integration

> **Check platform API terms before writing a single line of code for any feature that reads, stores, displays, or acts on data from a third-party API.**

#### Instagram / Meta Graph API — confirmed rules for Vouch

| Constraint | Rule |
|---|---|
| Merchant's own content only | The IG integration MUST connect the merchant's own Business IG account via OAuth. Never fetch or display content from arbitrary public accounts. |
| No re-hosting media | Store only the CDN **URL string** — never copy media files to Fly.io, Shopify Files, or any Vouch-controlled server. Images/videos must always load directly from Instagram's CDN. |
| No download feature | Never add a download button, `download` attribute, or right-click-save prevention bypass for Instagram media. Customers cannot download IG content through Vouch. |
| CDN URL expiry | Instagram CDN URLs expire (typically 24h). This is a known practical limitation — the UX implication (broken images after expiry) is acceptable; re-fetching on every page load is the correct fix if needed, not caching the file. |
| Attribution | Every Instagram post displayed on the storefront must show the Instagram icon with a `permalink` link back to the original post (already implemented via `vsb-ig-link`). |
| No "simply displaying" other users' content | Dev Policy §6 prohibits using the IG API to display content from users who haven't authorized the app. Vouch only displays the merchant's own posts — this is compliant. |
| UGC submissions need explicit consent | Any form that accepts customer-uploaded photos/videos for public display **must** include a consent checkbox granting the merchant rights to use the content. Absence of this checkbox is a compliance gap. |

#### Test plan additions for Instagram-related features
When modifying any Instagram feature, verify:
- [ ] Media URLs in rendered HTML point to `cdninstagram.com` or `instagram.com` CDN — not to Vouch or Shopify servers
- [ ] No `download` attribute on any `<a>` or `<img>` element that wraps IG content
- [ ] Instagram icon with permalink link is visible on every IG card (when permalink available)
- [ ] UGC submission form includes a consent checkbox before the submit button

#### TikTok / TikTok for Developers API — confirmed rules for Vouch

| Constraint | Rule |
|---|---|
| Merchant's own content only | The TikTok integration MUST connect the merchant's own TikTok Business account via OAuth. Never fetch or display content from arbitrary public accounts. |
| No re-hosting media | Store only the CDN **URL string** — never copy video/thumbnail files to Fly.io, Shopify Files, or any Vouch-controlled server. Videos/images must always load directly from TikTok's CDN. |
| CDN URL expiry | TikTok `play_url` CDN URLs expire after ~24h. The refresh cron (02:00/08:00/14:00/20:00 UTC) handles this via Video Query API. Never cache the files. |
| No download feature | Never add a download button, `download` attribute, or right-click-save bypass for TikTok media. |
| Attribution required | Every TikTok video displayed on the storefront **must** show the TikTok logo badge + a permalink link back to the original post. This is implemented via `.vouch-feed-item__tiktok-badge` + `.vouch-tiktok-link`. Never remove these. |
| OAuth gated by env vars | `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` must be set for OAuth. Manual paste path works without these. |
| play_url refresh on delete | If TikTok Video Query API returns a video as deleted, set `isPublished=false` in DB — do not crash or leave a broken video in the feed. |

#### Test plan additions for TikTok-related features
When modifying any TikTok feature, verify:
- [ ] Video/thumbnail URLs in rendered HTML point to TikTok/ByteDance CDN — not to Vouch or Shopify servers
- [ ] No `download` attribute on any element wrapping TikTok content
- [ ] TikTok logo is visible at top-right of every TikTok card (class `vouch-ig-link--top-right`, not the old `vouch-feed-item__tiktok-badge`)
- [ ] Permalink link is present when `permalink` is available (either as top-right `<a>` or footer `.vouch-tiktok-link`)
- [ ] Short vm.tiktok.com URLs are rejected with a user-readable error (parseTikTokVideoId returns null)

---

### 2d. Feed source uniformity contract — mandatory for ALL new feed sources

> **This rule exists because the same gaps were introduced three separate times when TikTok was added:** bottom-left badge instead of top-right, no hashtag splitting, no `data-hashtags`, no `caption_hide_hashtags` support. Every new feed source MUST follow the IG baseline.

**The canonical card structure** (same order for every source — IG, TikTok, and any future source):

```html
<article class="vouch-feed-item"
         data-source="<source>"
         data-post-id="..."
         data-media-url="..."
         data-media-type="..."
         data-tagged-products="..."
         data-sort-order="..."
         data-caption="<full raw caption>"
         data-hashtags="<space-separated hashtags only>"   ← REQUIRED for filter bar
         data-child-media-urls="[]">
  <figure class="vouch-feed-thumb">
    <!-- media: img or video -->
    <!-- source icon: <a class="vouch-ig-link vouch-ig-link--top-right"> when ig_icon_position=="inside_photo_top" -->
    <!-- chip strip injected here by JS -->
  </figure>
  <!-- <div class="vouch-feed-products" hidden> for tagged products -->
  <!-- <p class="vouch-feed-caption"> respecting caption_hide_hashtags + caption_show_lines -->
  <!-- <div class="vouch-hashtag-pills"> when caption_show_hashtag_pills is true -->
  <!-- <div class="vouch-feed-footer"> with source icon when ig_icon_position=="below_caption" -->
</article>
```

**Non-negotiable uniformity rules for every feed source:**

| Feature | Rule |
|---------|------|
| Source icon position | Always follows `ig_icon_position` schema setting — `inside_photo_top` → top-right `vouch-ig-link--top-right`, `below_caption` → footer `.vouch-feed-footer`. Same CSS class for all sources. |
| Source icon CSS | Always uses `class="vouch-ig-link vouch-ig-link--top-right"` for top-right position. Never invent a new class. |
| Caption hashtag splitting | Every source must split raw caption into body + hashtag parts (same Liquid loop as IG). Never render raw caption directly. |
| `data-hashtags` attribute | Must be populated on every article element with space-separated hashtag tokens. Missing = hashtag filter bar silently excludes those posts. |
| `caption_hide_hashtags` | Must be applied to every source's display caption. |
| `caption_show_lines` | Must be applied to every source via `-webkit-line-clamp`. |
| `caption_show_hashtag_pills` | Must be applied to every source. |
| No custom badge/icon CSS | Never create a new CSS class for a source's icon. Re-use `vouch-ig-link--top-right`. |

**Checklist when adding a new feed source:**
- [ ] `data-hashtags` attribute populated from hashtag-split logic
- [ ] `data-caption` contains the full raw caption  
- [ ] Caption uses `display_caption` variable (respects `caption_hide_hashtags`)
- [ ] Caption `caption_show_lines` clamping applied
- [ ] Hashtag pills block present (respects `caption_show_hashtag_pills`)
- [ ] Icon follows `ig_icon_position` setting — no hardcoded position
- [ ] Icon uses `vouch-ig-link vouch-ig-link--top-right` CSS class (not a new class)
- [ ] Icon is inside `<figure class="vouch-feed-thumb">` when `inside_photo_top`
- [ ] Icon is a `<a>` (link) when permalink is available; `<span>` when not

---

### 2c. Visual consistency — never invent a new pattern when one already exists

> **This rule exists because the same visual mistake was made multiple times:** a new widget was built with a different backdrop, blur, shadow, or transition value than the widget sitting right next to it in the same directory.

**Before writing any front-end CSS or UI component:**
1. **Read the sibling widget CSS files first.** The canonical source of truth is `extensions/vouch-theme/assets/`. Open the most related file (usually `ugc-feed.css`) and extract the pattern. Do not guess or invent.
2. **Reuse the exact token values** from the table below. If you deviate, state why in the code comment.
3. **Same component, same class?** If a widget needs a modal, it uses the same backdrop pattern as every other modal. Not a new one.

#### Vouch front-end design tokens (confirmed, authoritative)

| Pattern | Value | Source |
|---------|-------|--------|
| Modal backdrop | `background: rgba(0,0,0,0.55)` — **NO `backdrop-filter`** — full-viewport blur forces GPU to composite every pixel including decoded video, causing system-wide stutter | ugc-feed.css |
| Modal backdrop grain | `::after` pseudo-element with SVG `feTurbulence` noise (`baseFrequency='0.75' numOctaves='4' opacity='0.08'`, 200×200px tile, `pointer-events:none`) — gives frosted-glass texture at **zero per-frame GPU cost** (static cached image, alpha-blend only) | ugc-feed.css, social-board.css, ugc-gallery.css, customer-reviews.css |
| Modal inner (frosted glass) | `background: rgba(255,255,255,0.92); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px)` — blur only on the small panel, ~14% of screen pixels | ugc-feed.css |
| Modal box-shadow | `0 20px 70px rgba(0,0,0,0.45)` | ugc-feed.css |
| Modal border-radius | `12px` | ugc-feed.css, social-board.css |
| Modal max-width (single) | `min(92vw, 480px)` | ugc-feed.css |
| Modal max-width (split) | `min(92vw, 820px–920px)` | ugc-feed.css |
| Modal split height | `min(88vh, 600px)` | ugc-feed.css |
| Skeleton shimmer | `linear-gradient(90deg, #efefef 25%, #e2e2e2 50%, #efefef 75%)` + `1.4s ease-in-out infinite` | ugc-feed.css |
| Card hover scale | `scale(1.06)` on img/video | ugc-feed.css |
| Card hover lift | `translateY(-4px)` + `0 8px 20px rgba(0,0,0,0.12)` | social-board.css |
| Icon badge (frosted) | `background: rgba(0,0,0,0.5); backdrop-filter: blur(4px)` | customer-reviews.css |
| Transition timing | `0.18s–0.22s ease` | all widgets |
| Accent colour var | `var(--vouch-accent, #000)` — canonical name for all **new** widgets. `var(--vsb-accent, #000)` is the legacy name still present in `social-board.css` and `ugc-feed.css` — do not use in new code | all widgets |
| Font-size anchor on host | `font-size: 16px` on custom element root | all widgets |

### 2e. UX guidelines — mandatory for every front-end component

> **This rule exists because the same category of mistake was made repeatedly:** interactive elements with no affordance (users didn't know they could act), single-select when multi-select was obviously more useful, and required fields that silently block submission with no feedback.

**Before writing any interactive UI component — answer all five:**

1. **Discoverability** — Can a user tell at a glance that an element is interactive and what it does? If the answer is "they'd have to guess or try", add an instructional hint. Never rely on hover-only affordance in mobile/touch contexts. Examples: a grid of tappable items must have a visible instruction ("Tap any post to select it"); a button that reveals extra options must be labelled clearly.

2. **Multi-vs-single selection** — If a list shows items the user may want to act on, default to **multi-select** unless there is a specific reason to restrict to one (e.g. a radio-button choice by nature). Implementing single-select when the user obviously might want to act on several items in one go is always a UX regression.

3. **Validation feedback — never silent no-ops** — If an action is blocked because a required step hasn't been completed (unchecked checkbox, empty field, nothing selected), the UI **must** show an inline error message when the user attempts to proceed. Silent blocking (button click does nothing, no message) is forbidden. Pattern: set an `errorState` boolean on attempt; render an `<s-text color="critical">` (or equivalent) immediately adjacent to the missing element; clear it when the user completes the step.

4. **Button label reflects state** — A button's label must reflect the current state of the action. Examples: "Withdraw selected (3)" not "Withdraw selected"; "Submit 2 posts" not "Submit"; "Withdrawing…" during in-flight. A button that shows the same label regardless of selection state is a UX smell.

5. **Required-step ordering** — Put the most important/blocking step first in the visual flow, not last. If a checkbox must be ticked to enable an action, the checkbox comes *before* the action button — not after it. Users read top-to-bottom; the confirmation step should never be below the trigger it gates.

**Checklist — add to your mental review before any UI PR:**
- [ ] Are all interactive areas self-evident without hover/experiment?
- [ ] Is multi-select available wherever a list might need bulk action?
- [ ] Does every required field/checkbox show an inline error on failed submission attempt?
- [ ] Do button labels reflect count/state dynamically?
- [ ] Are blocking steps ordered before the actions they gate?

---

### 2f. Extend-don't-rebuild — mandatory when adding a new item to an existing multi-item system

> **This rule exists because fan posts needed 3 separate fix cycles (hover, drag, sort, badge) for behaviors that were already implemented on IG and TikTok cards.** The root cause: new item code was written from scratch instead of reading the existing implementations first and replicating them exactly.

**Trigger:** Any time you add a new "item kind" to a system that already has 2+ kinds — a new feed source, a new card type, a new tab, a new list entry.

**Mandatory steps — in this order, no exceptions:**

1. **Read ALL existing implementations** of the same kind of item. For the Social Feed admin: read the full IG card block AND the full TikTok card block. For the storefront feed: read the full IG render block AND the TikTok render block. Read them completely, not snippets.

2. **Extract the behavioral contract.** Make an explicit list of every behavior/prop/handler/attribute on existing items:
   - Drag: `draggable`, `onDragStart`, `onDragOver`, `onDrop`, `onDragEnd`, opacity while dragging
   - Hover: `onMouseEnter`, `onMouseMove`, `onMouseLeave`, delay, preview panel
   - Click: `onClick`, `clickedPost` state, modal open
   - CSS order: `order: 1` (in-feed), `order: 3` (hidden)
   - Key function in `orderedAllItems`
   - Batch sort server action + fetcher
   - Visual badges, borders, attribution

3. **Apply the contract 1:1.** The new item gets every behavior from the list. No exceptions, no "I'll add it later".

4. **If any behavior is ambiguous or unclear** — stop and ask the user before coding. Never guess.

**The failure mode this prevents:** Shipping a "working" new feature that silently lacks drag, hover, click, or sort because those handlers were attached elsewhere and the new item was a separate DOM block outside the unified loop.

**Corollary:** If you find yourself writing a separate `filteredFanFeed.map()` block outside the existing `orderedAllItems.map()` loop — **stop**. That's a signal you're rebuilding instead of extending. The correct action is to integrate into the existing loop and add a new `kind` case.

---

### 3. Pre-implementation checklist
Before writing a single line of code:
- [ ] Have I read the relevant existing file(s) fully, not just a snippet?
- [ ] **Is this a new item kind in an existing multi-item system?** → Apply §2f: read ALL existing item implementations, extract the behavioral contract, replicate 1:1.
- [ ] **For any UI/CSS — have I read the sibling widget CSS files to find the existing pattern?** Check `ugc-feed.css` first, then `social-board.css`. Never invent a value that's already in the design token table above.
- [ ] Do I understand the Prisma model for this feature?
- [ ] Does this route need `?shop=` in redirects?
- [ ] Will this touch extensions? (separate deploy)
- [ ] Is there a migration needed?
- [ ] Have I checked NOTES.md for prior decisions on this area?
- [ ] **Does this feature interact with a third-party platform (Instagram, Shopify, TikTok)?** → Check that platform's API TOS before writing code.
- [ ] **Is this a new Shopify feature, extension type, or API surface?** → Fetch the current Shopify dev docs page for it (see §7).
- [ ] **For any interactive UI component — have I applied the 5 UX guidelines in §2e?** Discoverability, multi-select default, inline validation errors, dynamic button labels, correct step ordering.

### 4. Post-implementation checklist
After writing code, before declaring done:
- [ ] Run `npx vitest run` — 0 failures.
- [ ] Run `npx tsc --noEmit` — error count must not increase.
- [ ] Run `npm run build` — exit 0.
- [ ] **For any UI/CSS change — compare all new values against the design token table in §2c.** If any value deviates without a comment explaining why, fix it.
- [ ] Update NOTES.md if a new model, route, env var, or architectural decision was made.
- [ ] **Update `CHANGELOG.md`** — add entry under `[Unreleased]` describing what changed.
- [ ] **`git push origin main`** — remote must never lag behind local after a deploy.
- [ ] If deployed: verify `https://vouch-77sh.fly.dev/health` returns `{"status":"ok"}`.
- [ ] If `package.json` version bumped: `git tag vX.Y.Z && git push origin --tags`.
- [ ] **Self-improve**: did I learn anything this session that should be a permanent rule?
- [ ] Append the Session End Protocol footer to the response.

### 5. Front-end scale & usability — non-negotiable rules for every theme extension

> **This rule exists because the same mistake was made THREE times:** widget elements that look microscopic next to normal Shopify product page content.

#### CRITICAL: Always use `px`, never `rem`, in Shopify theme extension CSS

`rem` units are **unreliable in Shopify theme extensions**. The host theme controls `html { font-size }`. Many themes use the `62.5%` trick (`1rem = 10px`), others use `87.5%` (`1rem ≈ 14px`). You have NO control over this. A value of `3rem` that you expect to be `48px` may render as `30px`. A value of `0.875rem` you expect as `14px` may render as `8.75px` — effectively invisible.

**Rule: use explicit `px` for every `font-size`, `height`, `padding`, `min-height`, and `gap` value in all Vouch theme extension CSS files.** Never use `rem` or `em` for sizing. CSS custom property defaults must also use `px`.

Correct:
```css
.vcr-avg   { font-size: var(--vcr-avg-size, 52px); }
.vcr-title { font-size: 12px; }
.vcr-cta   { font-size: 16px; min-height: 48px; }
```

Wrong:
```css
.vcr-avg   { font-size: var(--vcr-avg-size, 3rem); }   /* 30px if theme uses 62.5% */
.vcr-title { font-size: 0.8125rem; }                    /* 8px — invisible */
```

Also add an explicit `font-size: 16px` reset on the custom element root:
```css
vouch-reviews, vouch-social-board, vouch-referral {
  font-size: 16px; /* isolate from host theme rem scaling */
}
```

**Customer Account UI Extension additional Remote DOM rules (confirmed by repeated crashes):**
- **NEVER use `style="..."` string attribute on `<s-*>` elements** — crashes Remote DOM on attribute set (same blank-block symptom as native HTML)
- **NEVER use dynamic expressions on `<s-button>` props** (e.g. `kind={expr}`) — crashes Remote DOM on prop update; use button text content to convey state
- **`window.open(..., '_blank')` is blocked** in the extension iframe; use `<s-button href="url">` instead (not `window.location.href`)
- **`navigator.clipboard` is blocked** — use `<s-clipboard-item id="x" text="val" onCopy={fn}>` + `<s-button commandFor="x">` for copy-to-clipboard
- **`kind=` is a checkout extension prop** — in customer account extensions use `variant="primary"` / `variant="secondary"` on `<s-button>`
- **`<s-box>` uses Web Component token names, NOT Polaris React token names** — Polaris React tokens (`surface`, `surface-secondary`, `025`, `300`) silently do nothing. Correct WC API values: `background="base"|"subdued"|"transparent"`, `border="base"` (shorthand), `borderRadius="base"|"small"|"large"`, `padding="base"|"large"|"small"`. Example: `<s-box background="subdued" border="base" border-radius="base" padding="base">`
- **Both camelCase (`borderRadius`) and kebab-case (`border-radius`) work on `<s-*>` JSX elements** — Preact maps both correctly. Match the official docs style (camelCase). The earlier theory that camelCase crashes was wrong; the actual cause of the vouch-169 crash was `overflow="hidden"`.
- **NEVER use `overflow="hidden"` on outer `<s-box>` wrappers in customer account extensions.** Confirmed crashes the entire extension tree at runtime in 2026-04 API even though docs list it as a valid prop.
- **`<s-stack>` uses `gap=`, NOT `spacing=`.** `spacing` is NOT a valid prop on `<s-stack>` — it is silently ignored, causing every layout to render with zero gaps (Copy buttons jammed against text, no breathing room between rows). Always use `gap="small"|"base"|"large"|"none"`. Also supports `columnGap` and `rowGap`.
- **Use `<s-section heading="...">` for the canonical white-rounded-card with heading** — this is THE native Shopify card primitive on the customer account surface. Do NOT wrap content in `<s-box background="base" border="base" border-radius="base" padding="base">` to fake a card — `<s-section>` provides the white background, rounded corners, padding, AND the heading automatically and adapts styling based on nesting depth. Optional slots: `slot="primary-action"`, `slot="secondary-actions"` for header buttons.
- **When debugging a "block disappears" crash:** check the browser console for `TypeError` — it is always the most-recently-added attribute on the OUTER wrapper. Revert ONE attribute at a time. NEVER add multiple new s-* attributes in a single deploy without testing — when it crashes you will not know which one.
- **For navigation from a profile block to a full-page extension within the same app, use `extension:handle/` protocol** — `<s-button href="extension:vouch-ig-fan-posts/">` is the correct approach per Shopify docs. This works from ANY `customer-account.*.render` target to a `customer-account.page.render` target within the same app, without requiring merchant activation. The previous note that this "silently scrolls to top" was observed during a timing window after vouch-194 — the extension may not have propagated yet. Confirmed correct in vouch-197. **Do NOT use the direct HTTP URL (`https://shopify.com/{id}/account/extensions/{handle}/`) as the button href inside an extension** — clicking that URL shows "There's a problem loading this page" (Shopify routing does not handle direct URL navigation from within the extension sandbox the same way). **Do NOT use `igData.fanPostsUrl` (server-returned URL) as the button href** — this is the same direct HTTPS URL in a different form; it has the same broken behavior. `fanPostsUrl` is ONLY for external linking (emails, marketing pages outside the extension). **Do NOT use `payload.iss` from `shopify.sessionToken.get()` to construct this URL** — the `iss` claim for customer account session tokens is `https://{shop}.myshopify.com/checkouts` (the checkout session token issuer), NOT the customer accounts URL. The direct HTTP URL (`https://shopify.com/{id}/account/extensions/{handle}/`) is only useful for external linking (emails, marketing pages) — the server-side `fanPostsUrl` in the API response serves this purpose.

**This rule applies to ALL widget CSS files — not just new ones:**
- `customer-reviews.css` ✓ fixed
- `social-board.css` ✓ fixed
- `ugc-feed.css` ✓ fixed
- `ugc-gallery.css` ✓ fixed
- `ugc-submit.css` ✓ fixed

When adding CSS to any of these files, check your editor for any `rem` or `em` before saving. If you see one, convert it to `px`.

**Before writing a single CSS rule for any theme extension widget:**

1. **All font-sizes in `px`.** Minimum: `12px` for labels, `14px` for supporting text, `16px` for body/CTA, `24px`+ for stars, `48px`+ for dominant scores.
2. **Average score / headline numbers must be large and dominant** — minimum `48px`, ideally `52–64px`. They are the visual anchor of the design.
3. **Star characters in summary rows must be at least `24px`.**
4. **Touch targets must be at least 44×44px** (Apple HIG / WCAG 2.5.5). Distribution bar rows, CTA buttons, carousel nav — all must meet this minimum.
5. **Distribution bars must be at least `12px` tall** — anything thinner is invisible on a product page.
6. **Padding/spacing must be generous.** Section-level padding ≥ `40px` top/bottom. Internal section gaps ≥ `16px`. Card gaps ≥ `12px`.
7. **CTA buttons must have a minimum height of `48px`** and font-size of at least `16px`.
8. **After writing any CSS, mentally place it on a product page** with an `h1` at ~28px and body text at 16px and ask: *"Does every element feel proportionate, or does any part look like a footnote?"* If any element looks like a footnote — fix it.
9. **Schema defaults in Liquid must match the CSS defaults.** If the CSS default is `40px` for section padding, the schema `"default": 40` must match. Mismatched defaults mean already-placed blocks use stale saved values.

### 7. Mandatory Shopify docs check — hard requirement

> **This rule exists because repeated sessions re-invented broken workarounds for problems that are directly addressed — and often solved — in the current Shopify documentation. Every wasted deploy cycle and every user frustration event traced back to working from stale memory instead of live docs.**

**MUST fetch Shopify dev docs before writing code in these situations — no exceptions:**

| Trigger | Docs URL pattern |
|---------|------------------|
| New Shopify feature / API surface (any) | `https://shopify.dev/docs/api/...` |
| New extension type or target (any) | `https://shopify.dev/docs/apps/build/...` |
| New Polaris Web Component (`<s-*>`) or prop | `https://shopify.dev/docs/api/customer-account-ui-extensions/...` |
| Shopify API / webhook / GraphQL change | `https://shopify.dev/changelog` |
| **User expresses frustration** about a feature not working | Immediately fetch the relevant docs page — do NOT iterate on broken assumptions |
| Bug that has resisted 2+ fix attempts | Stop, fetch the docs, read them fully before the 3rd attempt |

**How to fetch:**
```
fetch_webpage url="https://shopify.dev/docs/api/<relevant-path>" query="<specific question>"
```
Fetch the page **before writing any new code**, not after the third failed deploy.

**When the user gets frustrated:**
1. Stop implementing immediately.
2. Acknowledge the issue.
3. Fetch the relevant Shopify docs page(s) using `fetch_webpage`.
4. Read them fully.
5. Only then propose the corrected approach — citing the doc URL so the user can verify.

This rule overrides any prior in-memory knowledge about a Shopify API. Documentation evolves every API version (currently `2026-04`). Memory from training or earlier sessions may reflect a removed or changed behaviour.

---

### 6. Program lead posture
- **Read before writing.** Always read the full relevant file before editing it.
- **One change at a time.** Don't refactor adjacent code while fixing a bug.
- **Explain trade-offs.** If two approaches are valid, say so and pick one with reasoning.
- **Surface blockers early.** If a package conflict, Shopify API limit, or architectural constraint will block progress, flag it before coding.
- **Don't gold-plate.** Implement exactly what was asked. No extra abstractions, no unrequested "improvements".
- **Verify assumptions.** If unsure whether a Shopify API behaviour, package API, or extension target is correct — fetch the docs first.
- **Mandatory Shopify docs check — see §7 below.** This is not optional.

---

## Before Deploying — Checklist

- [ ] **Multi-session safety:** Run `.\scripts\pre-deploy-check.ps1 -Type server|extension -Session "..."` — if it exits 1 (BLOCKED), stop and inform the user. Do NOT override.
- [ ] Does any new route need to be added to the route map in NOTES.md?
- [ ] Does any new DB model/field need a migration? (`npx prisma migrate dev --name <desc>`)
- [ ] **Migration included?** Run DB backup first: `fly ssh console --app vouch-77sh -C "cp /data/prod.db /data/prod.db.bak"`
- [ ] Does any new env var need to be set on Fly.io? (`flyctl secrets set`) — keep NOTES.md env var table current.
- [ ] If extensions changed, are they deployed separately with `shopify app deploy`?
- [ ] If a new Shopify metafield or metaobject is used, is it declared in the relevant TOML?
- [ ] Does any app block schema have ≤ 6 `header` settings? (Shopify hard limit — causes deploy error if exceeded)
- [ ] Do any new `range` settings stay within Shopify limits? Max 101 steps `(max-min)/step ≤ 100`; `unit: "ms"` max must be `< 10000`
- [ ] **CHANGELOG.md updated?** Add entry before deploying.
- [ ] **`git push origin main` run after deploy?** Remote must match live.
- [ ] **Git tag pushed?** If `package.json` version was bumped: `git tag vX.Y.Z && git push origin --tags`
- [ ] **Post-deploy health check passed?** `curl https://vouch-77sh.fly.dev/health` → `{"status":"ok"}`

---

## Git Commit Convention

```
<type>(<scope>): <short description>

Types: feat | fix | style | refactor | chore
Scope: feed | ugc | referral | influencer | modules | extension | infra

Examples:
  feat(feed): add chip scale + title styling options to feed widget
  fix(ugc): correct token parsing for multi-dot shop domains
  chore(infra): bump to v0.9.0
```
