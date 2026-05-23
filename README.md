# Gravio — AI Agent Quality Engine

**Score, track, and improve AI-assisted development workflows.**

Gravio scans your project for agent-quality signals across six dimensions — safety, reliability, evaluation, observability, governance, and agentic readiness — and gives you an actionable scorecard with ranked next steps.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-103%20passing-brightgreen)](#running-tests)

---

## What it does

```
node gravio.mjs --once --target .
```

```
  ████████████████████████  100%  Complete

  gravio  v0.4.2  ·  scan-abc123  ·  42 files

  ⬡  Overall     73.4 / 100  C  ↑ +2.1 vs last

  🔒 Safety          80.0 / 100
  ✦  Reliability     60.0 / 100
  ⬡  Evaluation      75.0 / 100
  ◎  Observability   55.0 / 100
  ⬡  Governance      70.0 / 100
  ◈  Agentic         85.0 / 100

  ── Top priorities ─────────────────────────────────────
  1. [critical]  Add secret scanning (gitleaks / secretlint)       +6pts · 15min
  2. [high]      Add integration/E2E test suite                     +4pts · 45min
  3. [high]      Add OpenTelemetry or structured logging            +3pts · 30min
```

Results are encrypted client-side (AES-256-GCM) and published to your dashboard. The server never sees plaintext run data.

---

## Architecture

```
src/
  server.mjs              HTTP server — all routes (auth, API, static)
  core/
    evaluate.mjs          Evaluator engine — pure function, no I/O
    scan-signals.mjs      Filesystem signal detection (bundled into CLI)
    scanner.mjs           Scoring engine — maps signals → scorecard
    crypto-e2ee.mjs       AES-256-GCM E2EE helpers
    auth.mjs              Session/API-key auth (scrypt + SHA-256)
    db.mjs                SQLite schema + prepared statements
  web/
    dashboard.html/js     Project dashboard (trends, runs, recommendations)
    onboarding.html/js    New-user setup flow
    settings.html/js      API keys, billing, E2EE tools
    site-chrome.js        Shared header/footer loader
    cli/
      gravio.mjs          Pre-built single-file CLI (esbuild bundle)

agent-quality/
  evals/workflow-corpus.json   Evaluation workflow definitions
  scorecard/weights.json       Dimension weights
  schemas/agent-trace.schema.json   Run artifact JSON schema

tests/
  evaluate.test.mjs       Evaluator unit tests
  scanner.test.mjs        Scanner signal tests
  crypto-e2ee.test.mjs    Crypto unit tests
  server.test.mjs         HTTP route integration tests
```

**Key design principles:**
- Zero-knowledge: the server stores ciphertext only. Decryption happens in the browser.
- No build step: web JS is served raw. No bundler, no JSX, no TypeScript.
- `node:http` only — no framework dependency.
- `better-sqlite3` — synchronous, embedded, zero-config.

---

## Quick start — self-host

### Prerequisites
- Node.js 20+
- (Optional) A domain + [Fly.io](https://fly.io) account for cloud deploy

### Local dev

```bash
git clone https://github.com/your-org/gravio.git
cd gravio
npm ci
cp .env.example .env          # fill in SESSION_SECRET at minimum
node src/server.mjs
# Open http://localhost:3000
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes | 32+ char random string for cookie signing |
| `PORT` | No (default 3000) | HTTP port |
| `NODE_ENV` | No | Set to `production` for Secure cookies |
| `GOOGLE_OAUTH_CLIENT_ID` | No | Google SSO client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | No | Google SSO client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | No | Google SSO redirect URI |
| `LEMON_API_KEY` | No | LemonSqueezy API key (billing) |
| `LEMON_STORE_ID` | No | LemonSqueezy store ID |
| `LEMON_WEBHOOK_SECRET` | No | LemonSqueezy webhook signature secret |

### Fly.io deploy

```bash
flyctl launch --copy-config --no-deploy
flyctl secrets set SESSION_SECRET=$(openssl rand -hex 32)
flyctl deploy
```

---

## Using the CLI

The CLI is a single self-contained file — no install required.

```bash
# Download
curl -fsSL https://gravio.dev/cli/gravio.mjs -o gravio.mjs
# Windows: Invoke-WebRequest https://gravio.dev/cli/gravio.mjs -OutFile gravio.mjs

# One-time setup (installs project deps if needed)
node gravio.mjs --setup --target .

# Authorize once per folder
node gravio.mjs --authorize --target . --project my-agent --server https://gravio.dev --api-key YOUR_KEY

# Run a scan
node gravio.mjs --once --target .

# Watch mode (continuous scanning)
node gravio.mjs --target .
```

**CLI flags:**

| Flag | Description |
|---|---|
| `--target <dir>` | Project directory to scan (default: `.`) |
| `--once` | Single scan then exit |
| `--setup` | Install dependencies, configure gitignore |
| `--authorize` | Save project auth credentials |
| `--server <url>` | Gravio server URL |
| `--api-key <key>` | User API key (`gv_...`) |
| `--project <name>` | Project name (auto-generated on first scan) |
| `--encrypt` | Encrypt with passphrase instead of API-key-derived key |
| `--no-publish` | Score locally, skip publishing |
| `--no-update` | Skip auto-update check |

---

## Evaluation dimensions

| Dimension | Weight | What it measures |
|---|---|---|
| Safety | 30% | Secrets management, gitignore hygiene, security tooling |
| Reliability | 25% | Tests, CI/CD, error handling, dependency management |
| Evaluation | 20% | Eval suites, baseline tracking, adversarial tests |
| Governance | 15% | Docs, changelogs, code review, ADRs |
| Observability | 10% | Logging, tracing, health checks, run artifacts |
| Agentic | — | Multi-agent coordination, prompt versioning, tool whitelists |

Weights are configurable in `agent-quality/scorecard/weights.json`.

---

## Running tests

```bash
npm test                  # full suite (103 tests)
npm run secret-scan       # check for accidentally committed secrets
npm run scorecard:check   # gate own scorecard
npm run verify            # all of the above
```

---

## Adding evaluation signals

1. Open `src/core/scan-signals.mjs` — add a boolean detection under the relevant ecosystem block.
2. Open `src/core/scanner.mjs` — add the signal to `computeRichScorecard()` under the right dimension.
3. Add a workflow entry to `agent-quality/evals/workflow-corpus.json`.
4. Write a test in `tests/scanner.test.mjs`.
5. Run `npm run build:cli` to rebuild the CLI bundle.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide.

---

## Zero-knowledge crypto

All run data is encrypted before leaving the scanner:

```
Key derivation:  PBKDF2-SHA-256 (210,000 iterations)  — passphrase OR API-key-derived
Encryption:      AES-256-GCM
Wire format:     base64( IV[12] | GCM-tag[16] | ciphertext )
```

The server stores only the ciphertext envelope. Decryption happens in the browser using the key stored in your local `.gravio/` folder. See `src/core/crypto-e2ee.mjs` for the full implementation.

---

## Contributing

We welcome contributions — especially:
- New evaluation signals (new languages, new tool ecosystems)
- Evaluation corpus entries (new workflow definitions)
- CLI improvements
- Dashboard UX

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

---

## License

[MIT](LICENSE) — free to use, fork, and self-host.

Built by the Gravio contributors. Hosted platform at [gravio.dev](https://gravio.dev).
