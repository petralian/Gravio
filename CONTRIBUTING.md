# Contributing to Gravio

Thanks for your interest in contributing. Gravio is fully open source (MIT) and welcomes builders who care about AI agent quality.

---

## Where to contribute

The highest-value areas right now:

| Area | What's needed | Files |
|---|---|---|
| **New scan signals** | Detection for more languages, tool ecosystems, and agent patterns | `src/core/scan-signals.mjs`, `src/core/scanner.mjs` |
| **Evaluation corpus** | New workflow definitions and quality checks | `agent-quality/evals/workflow-corpus.json` |
| **CLI improvements** | Better output, new flags, cross-platform fixes | `scripts/build-cli.mjs`, `src/core/scan-signals.mjs` |
| **Dashboard UX** | Better visualizations, new views | `src/web/dashboard.html`, `src/web/dashboard.js` |
| **Tests** | More coverage for scanner signals and server routes | `tests/` |

---

## Getting started

```bash
git clone https://github.com/petralian/Gravio.git
cd gravio
npm ci
cp .env.example .env     # set SESSION_SECRET to any 32+ char string for local dev
node src/server.mjs      # http://localhost:3000
```

Run the test suite before making any changes to confirm a clean baseline:

```bash
npm test
```

Expected: **103 tests, 0 failures**.

---

## Adding a new scan signal

This is the most common contribution. Each signal is a boolean detection in the scanner.

### 1. Add detection to `scan-signals.mjs`

Open `src/core/scan-signals.mjs`. Find the relevant ecosystem section and add your detection:

```js
// Example: detect Pydantic AI usage
const hasPydanticAi = depsText.includes("pydantic-ai");
```

Return it in the `scanTargetProject()` return object at the bottom of the function.

### 2. Add scoring in `scanner.mjs`

Open `src/core/scanner.mjs`. Find `computeRichScorecard()` and add your signal to the appropriate dimension block. Follow the existing pattern exactly — copy an adjacent check and adapt:

```js
{
  id: "pydantic-ai-agent",
  label: "Pydantic AI agent framework detected",
  subdim: "agentic/framework",
  difficulty: "quick-win",
  estimatedMinutes: 0,
  impactScore: 3,
  severity: "medium",
  passed: scan.hasPydanticAi,
  points: scan.hasPydanticAi ? 4 : 0,
  maxPoints: 4,
},
```

### 3. Add a workflow definition

Open `agent-quality/evals/workflow-corpus.json` and add an entry:

```json
{
  "id": "pydantic-ai-agent",
  "category": "agentic",
  "critical": false,
  "description": "Pydantic AI agent framework detected in project dependencies."
}
```

### 4. Write a test

Open `tests/scanner.test.mjs` and add a test case. Look at existing tests for the pattern — they create a minimal temp directory with specific files and assert the signal value.

### 5. Rebuild the CLI bundle

```bash
npm run build:cli
```

This regenerates `src/web/cli/gravio.mjs`. **Always commit this file in the same commit** as your signal changes.

---

## Code style

- **Node.js 20+ ESM only.** All files use `import`/`export`, `.mjs` extension.
- **No build step for web UI.** Web JS is served as-is. No bundler, no JSX, no TypeScript.
- **No new dependencies** without discussion. The only runtime dep is `better-sqlite3`.
- **Read the existing file** before editing. Match the exact style of surrounding code.
- Follow the git commit convention:
  ```
  feat(scanner): add pydantic-ai agent detection signal
  fix(cli): handle Windows paths with spaces in setup
  test(scanner): add pydantic-ai signal test
  ```

---

## Submitting changes

1. Fork the repo and create a branch: `git checkout -b feat/my-signal`
2. Make your changes.
3. Run `npm run verify` — all checks must pass:
   ```bash
   npm run secret-scan   # no secrets
   npm test              # 0 failures
   npm run scorecard:check
   ```
4. Open a pull request. Describe what signal/check you added and why it matters for agent quality.

---

## Questions?

Open an issue or start a discussion. We're building in public and happy to help orient new contributors.
