#!/usr/bin/env node
/**
 * gravio-scan.mjs
 *
 * Gravio Scanner CLI — entry point.
 * Usage:
 *   node scripts/gravio-scan.mjs --setup --target .
 *   node scripts/gravio-scan.mjs --authorize --project my-saas --api-key gv_xxx --server https://gravio.dev
 *   node scripts/gravio-scan.mjs --once
 *   node scripts/gravio-scan.mjs --target ../some-project --once
 *
 * Optional encryption modes:
 *   node scripts/gravio-scan.mjs --once --key <64-char-hex>
 *   node scripts/gravio-scan.mjs --once --passphrase "my secret" --salt <hex>
 *
 * First run automatically performs setup unless --no-setup is provided.
 */
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { runScannerOnce, startScannerWatcher } from "../src/core/scanner.mjs";
import { printScanReport, printWatchUpdate, printPublishResult, printScanStep } from "../src/core/reporter.mjs";
import { deriveKey, encrypt, generateKey } from "../src/core/crypto-e2ee.mjs";

/* Version injected by esbuild at bundle time. Falls back to "dev" when
 * running directly from source (scripts/gravio-scan.mjs). */
// eslint-disable-next-line no-undef
const CLI_VERSION = typeof GRAVIO_CLI_VERSION !== "undefined" ? GRAVIO_CLI_VERSION : "dev";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    return pkg.version ?? "?";
  } catch { return "?"; }
}

function parseArgs(argv) {
  const args = {
    target: ROOT,
    output: path.join(ROOT, "agent-quality", "runs", "latest.json"),
    once: false,
    authorize: false,
    logout: false,
    noAutoPublish: false,
    debounceMs: 500,
    publish: false,
    setup: false,
    noSetup: false,
    project: null,
    server: null,
    apiKey: null,
    key: null,
    passphrase: null,
    salt: null,
    noUpdate: false,
    setupVerbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--once") {
      args.once = true;
      continue;
    }
    if (token === "--authorize") {
      args.authorize = true;
      continue;
    }
    if (token === "--logout") {
      args.logout = true;
      continue;
    }
    if (token === "--no-auto-publish") {
      args.noAutoPublish = true;
      continue;
    }
    if (token === "--target" && argv[i + 1]) {
      args.target = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--output" && argv[i + 1]) {
      args.output = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--debounce" && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 50) {
        args.debounceMs = parsed;
      }
      i += 1;
      continue;
    }
    if (token === "--publish") {
      args.publish = true;
      continue;
    }
    if (token === "--setup") {
      args.setup = true;
      continue;
    }
    if (token === "--no-setup") {
      args.noSetup = true;
      continue;
    }
    if (token === "--project" && argv[i + 1]) {
      args.project = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--server" && argv[i + 1]) {
      args.server = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--api-key" && argv[i + 1]) {
      args.apiKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--key" && argv[i + 1]) {
      args.key = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--passphrase" && argv[i + 1]) {
      args.passphrase = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--salt" && argv[i + 1]) {
      args.salt = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--no-update") {
      args.noUpdate = true;
      continue;
    }
    if (token === "--setup-verbose") {
      args.setupVerbose = true;
      continue;
    }
  }

  return args;
}

function hashHex(str) {
  return createHash("sha256").update(String(str)).digest("hex");
}

function authConfigPath(targetDir) {
  return path.join(path.resolve(targetDir), ".gravio", "auth.json");
}

function setupStatePath(targetDir) {
  return path.join(path.resolve(targetDir), ".gravio", "setup.json");
}

function loadAuthConfig(targetDir) {
  try {
    const p = authConfigPath(targetDir);
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveAuthConfig(targetDir, payload) {
  const p = authConfigPath(targetDir);
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function deleteAuthConfig(targetDir) {
  try { unlinkSync(authConfigPath(targetDir)); } catch { /* ignore */ }
}

function ensureGravioIgnored(targetDir) {
  const gitignore = path.join(path.resolve(targetDir), ".gitignore");
  let body = "";
  if (existsSync(gitignore)) {
    body = readFileSync(gitignore, "utf8");
  }
  if (/^\.gravio\/$/m.test(body)) return;
  const next = body.trimEnd().length > 0
    ? `${body.trimEnd()}\n\n# Gravio local auth state\n.gravio/\n`
    : "# Gravio local auth state\n.gravio/\n";
  writeFileSync(gitignore, next, "utf8");
}

function loadSetupState(targetDir) {
  try {
    const p = setupStatePath(targetDir);
    if (!existsSync(p)) return null;
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSetupState(targetDir, payload) {
  const p = setupStatePath(targetDir);
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function getNodeMajorVersion() {
  const version = String(process.versions?.node ?? "");
  const major = Number(version.split(".")[0]);
  return Number.isFinite(major) ? major : 0;
}

function getNodeInstallHint() {
  if (process.platform === "win32") {
    return "Install Node.js LTS: winget install OpenJS.NodeJS.LTS";
  }
  if (process.platform === "darwin") {
    return "Install Node.js LTS: brew install node@20 (or download from nodejs.org)";
  }
  return "Install Node.js LTS 20+: https://nodejs.org/en/download";
}

function assertNodeSupported() {
  const major = getNodeMajorVersion();
  if (major >= 20) return;
  process.stderr.write("\n  \x1b[91m\x1b[1m✖  Error\x1b[0m  Node.js 20 or newer is required.\n");
  process.stderr.write(`  Detected: ${process.version}\n`);
  process.stderr.write(`  ${getNodeInstallHint()}\n\n`);
  process.exit(1);
}

function dependencyInstallPlan(targetDir) {
  const dir = path.resolve(targetDir);
  const plan = [];
  const has = (file) => existsSync(path.join(dir, file));

  if (has("package.json")) {
    if (has("pnpm-lock.yaml")) {
      plan.push({
        cmd: "pnpm",
        args: ["install", "--frozen-lockfile"],
        stage: "Install Node dependencies",
        reason: "Match Node packages to your lockfile so scans run consistently.",
      });
    } else if (has("yarn.lock")) {
      plan.push({
        cmd: "yarn",
        args: ["install", "--frozen-lockfile"],
        stage: "Install Node dependencies",
        reason: "Match Node packages to your lockfile so scans run consistently.",
      });
    } else if (has("package-lock.json")) {
      plan.push({
        cmd: "npm",
        args: ["ci"],
        stage: "Install Node dependencies",
        reason: "Use pinned Node package versions from package-lock.json.",
      });
    } else {
      plan.push({
        cmd: "npm",
        args: ["install"],
        stage: "Install Node dependencies",
        reason: "Install required Node packages from package.json.",
      });
    }
  }

  if (has("requirements.txt")) {
    if (process.platform === "win32") {
      plan.push({
        cmd: "py",
        args: ["-m", "pip", "install", "--disable-pip-version-check", "--progress-bar", "off", "-r", "requirements.txt"],
        stage: "Install Python dependencies",
        reason: "Install Python packages needed by your project tooling.",
      });
    } else {
      plan.push({
        cmd: "python3",
        args: ["-m", "pip", "install", "--disable-pip-version-check", "--progress-bar", "off", "-r", "requirements.txt"],
        stage: "Install Python dependencies",
        reason: "Install Python packages needed by your project tooling.",
      });
    }
  }

  return plan;
}

function isPipStep(step) {
  if (!step) return false;
  if (step.cmd === "py" || step.cmd === "python3" || step.cmd === "python") {
    return step.args[0] === "-m" && step.args[1] === "pip";
  }
  return false;
}

function printSetupStage(index, total, title, reason) {
  process.stdout.write(`\n  ${index}. ${title}\n`);
  if (reason) process.stdout.write(`     Why: ${reason}\n`);
  process.stdout.write(`     Progress: step ${index}/${total}\n`);
}

function runInstallStep(targetDir, step, { setupVerbose = false } = {}) {
  return new Promise((resolve) => {
    const pretty = `${step.cmd} ${step.args.join(" ")}`;
    process.stdout.write(`     Running: ${pretty}\n`);

    const pipFiltered = isPipStep(step) && !setupVerbose;
    if (!pipFiltered) {
      const res = spawnSync(step.cmd, step.args, {
        cwd: path.resolve(targetDir),
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      resolve(res.status === 0);
      return;
    }

    process.stdout.write("     Note: pip may replace package versions to satisfy pinned compatibility.\n");
    process.stdout.write("     This affects only the virtual environment, not your source files.\n");

    const child = spawn(step.cmd, step.args, {
      cwd: path.resolve(targetDir),
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let alreadySatisfied = 0;
    const important = /^(Collecting|Using cached|Downloading|Installing collected packages|Attempting uninstall|Found existing installation|Uninstalling|Successfully installed|ERROR:|WARNING:)/;
    const consumeStream = (stream) => {
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const text = line.trim();
          if (!text) continue;
          if (text.startsWith("Requirement already satisfied:")) {
            alreadySatisfied += 1;
            continue;
          }
          if (important.test(text)) {
            process.stdout.write(`       ${text}\n`);
          }
        }
      });
      stream.on("end", () => {
        const text = pending.trim();
        if (text && important.test(text)) {
          process.stdout.write(`       ${text}\n`);
        }
      });
    };

    consumeStream(child.stdout);
    consumeStream(child.stderr);

    child.on("close", (code) => {
      if (alreadySatisfied > 0) {
        process.stdout.write(`     pip summary: ${alreadySatisfied} dependencies were already satisfied.\n`);
      }
      resolve(code === 0);
    });
  });
}

async function runSetup(targetDir, { silentNoWork = false, setupVerbose = false } = {}) {
  assertNodeSupported();
  process.stdout.write("\n  \x1b[96m\x1b[1mGravio setup\x1b[0m\n");
  process.stdout.write(`  Folder: ${path.resolve(targetDir)}\n`);
  process.stdout.write("  Setup stages are shown before each action so changes are easy to follow.\n");

  const totalStages = 3;
  printSetupStage(1, totalStages, "Preflight checks", "Detect package managers and build a dependency plan.");
  const plan = dependencyInstallPlan(targetDir);
  if (!plan.length) {
    if (!silentNoWork) {
      process.stdout.write("  No package manager files detected. Skipping dependency install.\n");
    }
    saveSetupState(targetDir, {
      version: 1,
      completedAt: new Date().toISOString(),
      installedSteps: [],
    });
    ensureGravioIgnored(targetDir);
    return true;
  }

  printSetupStage(2, totalStages, "Install dependencies", "Run project dependency installers in a predictable order.");
  for (const step of plan) {
    process.stdout.write(`     Stage: ${step.stage}\n`);
    process.stdout.write(`     Detail: ${step.reason}\n`);
    if (isPipStep(step)) {
      process.stdout.write("     Why uninstall messages happen: pip reconciles conflicting versions to match requirements.txt.\n");
    }
    if (!await runInstallStep(targetDir, step, { setupVerbose })) {
      process.stderr.write(`\n  \x1b[91m\x1b[1m✖  Setup failed\x1b[0m while running ${step.cmd}.\n\n`);
      return false;
    }
  }

  printSetupStage(3, totalStages, "Finalize", "Save setup state and protect local Gravio config from being committed.");
  saveSetupState(targetDir, {
    version: 1,
    completedAt: new Date().toISOString(),
    installedSteps: plan.map((s) => `${s.cmd} ${s.args.join(" ")}`),
  });
  ensureGravioIgnored(targetDir);
  process.stdout.write("  \x1b[92m\x1b[1m✔  Setup complete\x1b[0m\n\n");
  return true;
}

function resolvePublishContext(args, authCfg) {
  return {
    server: args.server ?? authCfg?.server ?? "http://localhost:3000",
    project: args.project ?? authCfg?.projectId ?? null,
    apiKey: args.apiKey ?? authCfg?.apiKey ?? null,
  };
}

function buildEncryptedRunEnvelope(run, options) {
  const now = new Date().toISOString();
  const publicSummary = {
    runId: run?.runId ?? "run",
    createdAt: run?.createdAt ?? now,
    overallScore: Number.isFinite(run?.summary?.overallScore) ? Number(run.summary.overallScore) : null,
    scorecard: run?.scorecard ?? null,
  };

  if (options.key) {
    const key = String(options.key).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      throw new Error("--key must be a 64-character hex string");
    }
    return {
      envelope: {
        format: "gravio-run-v1",
        encryptedAt: now,
        publicSummary,
        cipher: "aes-256-gcm",
        keyMode: "raw-key",
        ciphertext: encrypt(key, JSON.stringify(run)),
      },
      keyMessage: `Encryption key: ${key}`,
    };
  }

  if (options.passphrase) {
    const saltHex = options.salt && /^[0-9a-fA-F]+$/.test(options.salt)
      ? options.salt.toLowerCase()
      : hashHex(`gravio-passphrase:${options.project ?? "default"}`);
    const key = deriveKey(options.passphrase, saltHex);
    return {
      envelope: {
        format: "gravio-run-v1",
        encryptedAt: now,
        publicSummary,
        cipher: "aes-256-gcm",
        keyMode: "passphrase",
        kdf: { name: "pbkdf2-sha256", iterations: 210000, saltHex },
        ciphertext: encrypt(key, JSON.stringify(run)),
      },
      keyMessage: `Passphrase mode enabled. Salt: ${saltHex}`,
    };
  }

  if (options.apiKey && options.project) {
    const saltHex = hashHex(`gravio-api-key:${options.project}`);
    const key = deriveKey(options.apiKey, saltHex);
    return {
      envelope: {
        format: "gravio-run-v1",
        encryptedAt: now,
        publicSummary,
        cipher: "aes-256-gcm",
        keyMode: "api-key",
        kdf: { name: "pbkdf2-sha256", iterations: 210000, saltHex },
        ciphertext: encrypt(key, JSON.stringify(run)),
      },
      keyMessage: "Run encrypted using your API key-derived key.",
    };
  }

  const oneTimeKey = generateKey();
  return {
    envelope: {
      format: "gravio-run-v1",
      encryptedAt: now,
      publicSummary,
      cipher: "aes-256-gcm",
      keyMode: "raw-key",
      ciphertext: encrypt(oneTimeKey, JSON.stringify(run)),
    },
    keyMessage: `One-time encryption key (save this): ${oneTimeKey}`,
  };
}

async function publishEnvelope({ server, project, apiKey, envelope }) {
  const publishUrl = new URL("/api/publish", server).toString();
  const result = await httpPost(
    publishUrl,
    { projectId: project, run: envelope },
    { Authorization: `Bearer ${apiKey}` },
  );
  return result;
}

/**
 * POST a JSON payload to a URL, returns the parsed response body.
 * Supports http:// and https:// URLs.
 */
function httpPost(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
          catch { resolve({ status: res.statusCode, data: body }); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
});
}

/**
 * GET a URL, returns { status, body } where body is a UTF-8 string.
 */
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Return true if `remote` is a higher semver than `local`.
 */
function isNewer(remote, local) {
  if (!remote || remote === local || local === "dev") return false;
  const parse = (v) => String(v).split(".").map(Number);
  const [rA, rB, rC] = parse(remote);
  const [lA, lB, lC] = parse(local);
  if (rA !== lA) return rA > lA;
  if (rB !== lB) return rB > lB;
  return rC > lC;
}

/**
 * Check the server for a newer CLI version and, if found, download it over
 * the current file then re-exec so the user always runs the latest build.
 *
 * Skips automatically when running directly from source (gravio-scan.mjs).
 * Skips silently on any network error so offline users are not blocked.
 */
async function checkAndUpdate(serverBase) {
  // Don’t self-update when running from source in development.
  const isBundled = !path.basename(process.argv[1]).includes("gravio-scan");
  if (!isBundled) return;

  const c = {
    cyan: "\x1b[36m", green: "\x1b[32m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m",
    bgreen: "\x1b[92m", bcyan: "\x1b[96m", byellow: "\x1b[93m",
  };

  try {
    const versionUrl = new URL("/api/cli/version", serverBase).toString();
    const res = await httpGet(versionUrl);
    if (res.status !== 200) return;

    let remoteVersion;
    try { remoteVersion = JSON.parse(res.body).version; } catch { return; }
    if (!isNewer(remoteVersion, CLI_VERSION)) return;

    console.log(`\n  ${c.byellow}${c.bold}↑  Update available${c.reset}  ${c.dim}${CLI_VERSION}${c.reset} ${c.dim}→${c.reset} ${c.bgreen}${c.bold}${remoteVersion}${c.reset}`);
    console.log(`  ${c.dim}Downloading new version...${c.reset}`);

    const downloadUrl = new URL("/cli/gravio.mjs", serverBase).toString();
    const dlRes = await httpGet(downloadUrl);
    if (dlRes.status !== 200) {
      console.log(`  ${c.dim}[!] Update download failed (HTTP ${dlRes.status}) — continuing with v${CLI_VERSION}\n${c.reset}`);
      return;
    }

    const currentFile = path.resolve(process.argv[1]);
    writeFileSync(currentFile, dlRes.body, "utf8");
    try { chmodSync(currentFile, 0o755); } catch { /* ignore on Windows */ }

    console.log(`  ${c.bgreen}${c.bold}✔  Updated to v${remoteVersion}${c.reset}${c.dim}  Restarting...${c.reset}\n`);

    // Re-exec: spawn updated script with same args then exit this process.
    await new Promise((resolve) => {
      const child = spawn(process.execPath, [currentFile, "--no-update", ...process.argv.slice(2)], {
        stdio: "inherit",
      });
      child.on("close", (code) => { resolve(); process.exit(code ?? 0); });
    });
  } catch {
    // Network or write failure — silently continue with current version.
  }
}

const args = parseArgs(process.argv.slice(2));
assertNodeSupported();

const existingAuth = loadAuthConfig(args.target);
const context = resolvePublishContext(args, existingAuth);

// Auto-update: check server for a newer CLI version before doing anything else.
// Skips silently if offline or running from source. Pass --no-update to opt out.
if (!args.noUpdate) {
  await checkAndUpdate(context.server);
}

if (args.logout) {
  deleteAuthConfig(args.target);
  process.stdout.write("\n  Local Gravio authorization cleared (.gravio/auth.json removed).\n\n");
  process.exit(0);
}

if (args.setup) {
  const ok = await runSetup(args.target, { setupVerbose: args.setupVerbose });
  process.exit(ok ? 0 : 1);
}

if (!args.noSetup) {
  const setupState = loadSetupState(args.target);
  const setupDone = Boolean(setupState?.completedAt);
  if (!setupDone) {
    const ok = await runSetup(args.target, { silentNoWork: true, setupVerbose: args.setupVerbose });
    if (!ok) process.exit(1);
  }
}

if (args.authorize) {
  if (!context.project) {
    process.stderr.write("\n  \x1b[91m\x1b[1m✖  Error\x1b[0m  --authorize requires --project <id>\n\n");
    process.exit(1);
  }
  if (!context.apiKey) {
    process.stderr.write("\n  \x1b[91m\x1b[1m✖  Error\x1b[0m  --authorize requires --api-key <gv_...>\n\n");
    process.exit(1);
  }

  try {
    const meUrl = new URL("/api/me", context.server).toString();
    const me = await httpGet(meUrl, { Authorization: `Bearer ${context.apiKey}` });
    if (me.status !== 200) {
      process.stderr.write("\n  \x1b[91m\x1b[1m✖  Error\x1b[0m  API key validation failed.\n\n");
      process.exit(1);
    }

    const now = new Date().toISOString();
    saveAuthConfig(args.target, {
      version: 1,
      authorizedAt: existingAuth?.authorizedAt ?? now,
      updatedAt: now,
      projectId: context.project,
      server: context.server,
      apiKey: context.apiKey,
    });
    ensureGravioIgnored(args.target);
    process.stdout.write("\n  \x1b[92m\x1b[1m✔  Authorized\x1b[0m  saved local auth at .gravio/auth.json\n");
    process.stdout.write("  Future --once scans in this folder will auto-publish.\n\n");
    process.exit(0);
  } catch (err) {
    process.stderr.write(`\n  \x1b[91m\x1b[1m✖  Error\x1b[0m  ${err.message}\n\n`);
    process.exit(1);
  }
}

// Validate publish prerequisites
const isScanCommand = args.once || (!args.authorize && !args.logout);

if (isScanCommand && !context.project) {
  process.stderr.write("\n  \x1b[91m\x1b[1m✖  Error\x1b[0m  Scanning requires an authorized project first.\n\n");
  process.stderr.write("  Run once in this folder:\n");
  process.stderr.write("    \x1b[97mnode gravio.mjs --authorize --target . --project <id> --api-key gv_...\x1b[0m\n\n");
  process.exit(1);
}

if (isScanCommand && !context.apiKey) {
  process.stderr.write("\n  \x1b[91m\x1b[1m✖  Error\x1b[0m  Scanning requires an API key first.\n\n");
  process.stderr.write("  \x1b[2mSteps:\x1b[0m\n");
  process.stderr.write("    1) Sign in  →  \x1b[36mhttps://gravio.dev/login\x1b[0m\n");
  process.stderr.write("    2) Open onboarding to auto-fill your user-bound token\n");
  process.stderr.write("    3) Run once: \x1b[97mnode gravio.mjs --authorize --project <id> --api-key gv_...\x1b[0m\n\n");
  process.exit(1);
}

if (args.once) {
  // ── Progress: start ─────────────────────────────────────────────────────
  if (process.stdout.isTTY) {
    console.log();
    printScanStep(0);
  }

  const plainTempOutput = `${args.output}.plain.tmp`;
  const { run, scan } = runScannerOnce({
    targetDir: args.target,
    outputFile: plainTempOutput,
    repoRoot: ROOT,
  });
  try { unlinkSync(plainTempOutput); } catch { /* ignore */ }

  const { envelope, keyMessage } = buildEncryptedRunEnvelope(run, {
    project: context.project,
    apiKey: context.apiKey,
    key: args.key,
    passphrase: args.passphrase,
    salt: args.salt,
  });

  // ── Progress: done ──────────────────────────────────────────────────────
  if (process.stdout.isTTY) {
    const SCAN_TOTAL = 8;
    printScanStep(SCAN_TOTAL);
    process.stdout.write("\n");
  }

  printScanReport({ run, scan, version: readVersion() });
  process.stdout.write("\n  \x1b[2mCloud-only mode:\x1b[0m no local JSON artifact is written.\n");
  process.stdout.write(`  \x1b[2m${keyMessage}\x1b[0m\n`);

  {
    try {
      const result = await publishEnvelope({
        server: context.server,
        project: context.project,
        apiKey: context.apiKey,
        envelope,
      });
      if (result.status === 200 && result.data?.ok) {
        printPublishResult({ server: context.server, project: context.project, success: true });
      } else if (result.status === 401 || result.status === 403) {
        printPublishResult({
          server: context.server, project: context.project, success: false,
          error: `HTTP ${result.status}: ${result.data?.error ?? "Authentication required"}`,
        });
        process.exit(1);
      } else {
        printPublishResult({
          server: context.server, project: context.project, success: false,
          error: `HTTP ${result.status}: ${result.data?.error ?? JSON.stringify(result.data)}`,
        });
        process.exit(1);
      }
    } catch (err) {
      printPublishResult({ server: context.server, project: context.project, success: false, error: err.message });
      process.exit(1);
    }
  }

  process.exit(0);
}

const plainWatchOutput = `${args.output}.plain.tmp`;
const watcher = startScannerWatcher({
  targetDir: args.target,
  outputFile: plainWatchOutput,
  repoRoot: ROOT,
  debounceMs: args.debounceMs,
  logger: console,
  onScan: async ({ run, scan }) => {
    try {
      try { unlinkSync(plainWatchOutput); } catch { /* ignore */ }
      const { envelope } = buildEncryptedRunEnvelope(run, {
        project: context.project,
        apiKey: context.apiKey,
        key: args.key,
        passphrase: args.passphrase,
        salt: args.salt,
      });
      await publishEnvelope({
        server: context.server,
        project: context.project,
        apiKey: context.apiKey,
        envelope,
      });
      printWatchUpdate({ run, scan });
    } catch (error) {
      console.error(`gravio: auto-publish failed: ${error.message}`);
    }
  },
});

console.log(
  `\n  \x1b[96m\x1b[1m  gravio  \x1b[0m\x1b[2m watch mode\x1b[0m\n` +
  `\n  \x1b[2mWatching\x1b[0m  \x1b[36m${args.target}\x1b[0m` +
  `\n  \x1b[2mDebounce  ${args.debounceMs}ms  ·  Ctrl+C to stop\x1b[0m\n`
);

process.on("SIGINT", () => {
  watcher.close();
  try { unlinkSync(plainWatchOutput); } catch { /* ignore */ }
  console.log("\n  \x1b[2mgravio: stopped\x1b[0m\n");
  process.exit(0);
});

process.on("SIGTERM", () => {
  watcher.close();
  try { unlinkSync(plainWatchOutput); } catch { /* ignore */ }
  console.log("\n  \x1b[2mgravio: stopped\x1b[0m\n");
  process.exit(0);
});
