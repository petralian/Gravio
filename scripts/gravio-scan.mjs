#!/usr/bin/env node
/**
 * gravio-scan.mjs
 *
 * Simplified Gravio CLI:
 *   node gravio.mjs                     # setup/auth/link/scan/publish
 *   node gravio.mjs --token gv_xxx      # first-time connect + run
 *   node gravio.mjs link --project id   # relink folder to an existing project
 *   node gravio.mjs rename new-id       # rename current project id
 *   node gravio.mjs merge --to target   # merge current project into target
 *   node gravio.mjs doctor              # show setup/auth/link status
 *   node gravio.mjs logout              # clear local auth/link
 */
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { readdirSync, readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { scanTargetProject } from "../src/core/scan-signals.mjs";
import { printScanReport, printPublishResult, printScanStep } from "../src/core/reporter.mjs";
import { deriveKey, encrypt, generateKey } from "../src/core/crypto-e2ee.mjs";

// eslint-disable-next-line no-undef
const CLI_VERSION = typeof GRAVIO_CLI_VERSION !== "undefined" ? GRAVIO_CLI_VERSION : "dev";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_SERVER = "https://gravio.dev";

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    return pkg.version ?? "?";
  } catch {
    return "?";
  }
}

function parseArgs(argv) {
  const args = {
    command: "run",
    target: process.cwd(),
    server: null,
    token: null,
    project: null,
    from: null,
    to: null,
    key: null,
    passphrase: null,
    salt: null,
    noUpdate: false,
    setupVerbose: false,
    help: false,
  };

  if (argv[0] && !argv[0].startsWith("-")) {
    args.command = String(argv[0]).toLowerCase();
    argv = argv.slice(1);
  }

  if (args.command === "help") {
    args.help = true;
    args.command = "run";
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--server" && argv[i + 1]) {
      args.server = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--token" && argv[i + 1]) {
      args.token = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--project" && argv[i + 1]) {
      args.project = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--from" && argv[i + 1]) {
      args.from = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--to" && argv[i + 1]) {
      args.to = argv[i + 1];
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
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
  }

  if (args.command === "rename" && !args.to && argv.length > 0) {
    const positional = argv.find((v) => !v.startsWith("-"));
    if (positional) args.to = positional;
  }

  return args;
}

function hashHex(str) {
  return createHash("sha256").update(String(str)).digest("hex");
}

function normalizeProjectId(value) {
  const cleaned = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 64);
}

function isValidProjectId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);
}

function authConfigPath(targetDir) {
  return path.join(path.resolve(targetDir), ".gravio", "auth.json");
}

function setupStatePath(targetDir) {
  return path.join(path.resolve(targetDir), ".gravio", "setup.json");
}

function projectStatePath(targetDir) {
  return path.join(path.resolve(targetDir), ".gravio", "project.json");
}

function loadJson(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveJson(filePath, payload) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function loadAuthConfig(targetDir) {
  return loadJson(authConfigPath(targetDir));
}

function saveAuthConfig(targetDir, payload) {
  saveJson(authConfigPath(targetDir), payload);
}

function deleteAuthConfig(targetDir) {
  try {
    unlinkSync(authConfigPath(targetDir));
  } catch {
    // ignore
  }
}

function loadSetupState(targetDir) {
  return loadJson(setupStatePath(targetDir));
}

function saveSetupState(targetDir, payload) {
  saveJson(setupStatePath(targetDir), payload);
}

function loadProjectState(targetDir) {
  return loadJson(projectStatePath(targetDir));
}

function saveProjectState(targetDir, payload) {
  saveJson(projectStatePath(targetDir), payload);
}

function deleteProjectState(targetDir) {
  try {
    unlinkSync(projectStatePath(targetDir));
  } catch {
    // ignore
  }
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

function computeFolderFingerprint(targetDir) {
  const dir = path.resolve(targetDir);
  const entries = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".gravio") continue;
    const kind = entry.isDirectory() ? "d" : "f";
    entries.push(`${kind}:${entry.name.toLowerCase()}`);
    if (entries.length >= 120) break;
  }
  entries.sort();
  return hashHex(`${path.basename(dir).toLowerCase()}|${entries.join("|")}`).slice(0, 16);
}

function generateAutoProjectId(targetDir) {
  const baseRaw = normalizeProjectId(path.basename(path.resolve(targetDir)));
  const base = baseRaw || "project";
  const suffix = computeFolderFingerprint(targetDir).slice(0, 6);
  const maxBaseLen = 64 - 1 - suffix.length;
  return `${base.slice(0, maxBaseLen)}-${suffix}`;
}

function getNodeMajorVersion() {
  const version = String(process.versions?.node ?? "");
  const major = Number(version.split(".")[0]);
  return Number.isFinite(major) ? major : 0;
}

function getNodeInstallHint() {
  if (process.platform === "win32") return "Install Node.js LTS: winget install OpenJS.NodeJS.LTS";
  if (process.platform === "darwin") return "Install Node.js LTS: brew install node@20 (or download from nodejs.org)";
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

function resolveNativeCmd(cmd) {
  // On Windows, script-based package managers need the .cmd extension to run without shell: true.
  if (process.platform !== "win32") return cmd;
  const scriptCmds = ["npm", "yarn", "pnpm", "npx"];
  return scriptCmds.includes(cmd) ? `${cmd}.cmd` : cmd;
}

function writeSetupProgress(pct, label) {
  if (!process.stdout.isTTY) return;
  const barW   = 30;
  const filled = Math.round((pct / 100) * barW);
  const b      = `\x1b[96m${"\u2588".repeat(filled)}\x1b[0m\x1b[2m${"\u2591".repeat(barW - filled)}\x1b[0m`;
  const pctStr = `\x1b[2m${String(pct).padStart(3, " ")}%\x1b[0m`;
  process.stdout.write(`\r  ${b}  ${pctStr}  \x1b[90m${label.padEnd(36, " ")}\x1b[0m`);
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
    const isNpmLike = ["npm", "yarn", "pnpm"].includes(step.cmd);

    if (!pipFiltered && !isNpmLike) {
      // Generic fallback — resolveNativeCmd handles Windows .cmd extension without shell: true.
      const res = spawnSync(resolveNativeCmd(step.cmd), step.args, {
        cwd: path.resolve(targetDir),
        stdio: "inherit",
      });
      resolve(res.status === 0);
      return;
    }

    if (isNpmLike && !setupVerbose) {
      process.stdout.write("     Note: deprecation notices and audit warnings are suppressed. Use --setup-verbose to see all output.\n");
      const resolvedCmd = resolveNativeCmd(step.cmd);
      const child = spawn(resolvedCmd, step.args, {
        cwd: path.resolve(targetDir),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let elapsed = 0;
      writeSetupProgress(0, "Starting install...");
      const progressTimer = setInterval(() => {
        elapsed += 1;
        // Logistic curve: smooth approach up to ~88%, leaves room to jump to 100% on done.
        const pct = Math.min(88, Math.round(100 * (1 - Math.exp(-elapsed / 25))));
        writeSetupProgress(pct, `Installing packages... (${elapsed}s)`);
      }, 1000);

      const npmNoise = /^(npm warn|added \d|audited \d|found \d|up to date|changed \d)/i;
      const consumeNpmStream = (stream) => {
        let pending = "";
        stream.setEncoding("utf8");
        stream.on("data", (chunk) => {
          pending += chunk;
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";
          for (const line of lines) {
            const text = line.trim();
            if (!text || npmNoise.test(text)) continue;
            if (/^npm error|^error /i.test(text)) {
              if (process.stdout.isTTY) process.stdout.write("\n");
              process.stdout.write(`       ${text}\n`);
            }
          }
        });
        stream.on("end", () => {
          const text = pending.trim();
          if (text && /^npm error|^error /i.test(text)) {
            if (process.stdout.isTTY) process.stdout.write("\n");
            process.stdout.write(`       ${text}\n`);
          }
        });
      };

      consumeNpmStream(child.stdout);
      consumeNpmStream(child.stderr);

      child.on("close", (code) => {
        clearInterval(progressTimer);
        writeSetupProgress(100, "Complete");
        process.stdout.write("\n");
        resolve(code === 0);
      });
      return;
    }

    if (isNpmLike) {
      // setupVerbose=true: pass raw output through.
      const resolvedCmd = resolveNativeCmd(step.cmd);
      const res = spawnSync(resolvedCmd, step.args, {
        cwd: path.resolve(targetDir),
        stdio: "inherit",
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
          if (important.test(text)) process.stdout.write(`       ${text}\n`);
        }
      });
      stream.on("end", () => {
        const text = pending.trim();
        if (text && important.test(text)) process.stdout.write(`       ${text}\n`);
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
    if (!silentNoWork) process.stdout.write("  No package manager files detected. Skipping dependency install.\n");
    saveSetupState(targetDir, { version: 1, completedAt: new Date().toISOString(), installedSteps: [] });
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

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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
        res.on("end", () => resolve({ status: res.statusCode, data: parseJsonSafe(body) ?? body }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

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
    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

function isNewer(remote, local) {
  if (!remote || remote === local || local === "dev") return false;
  const parse = (v) => String(v).split(".").map(Number);
  const [rA, rB, rC] = parse(remote);
  const [lA, lB, lC] = parse(local);
  if (rA !== lA) return rA > lA;
  if (rB !== lB) return rB > lB;
  return rC > lC;
}

async function checkAndUpdate(serverBase) {
  const isBundled = !path.basename(process.argv[1]).includes("gravio-scan");
  if (!isBundled) return;

  const c = {
    dim: "\x1b[2m",
    bold: "\x1b[1m",
    reset: "\x1b[0m",
    bgreen: "\x1b[92m",
    byellow: "\x1b[93m",
  };

  try {
    const versionUrl = new URL("/api/cli/version", serverBase).toString();
    const res = await httpGet(versionUrl);
    if (res.status !== 200) return;
    const remoteVersion = parseJsonSafe(res.body)?.version;
    if (!isNewer(remoteVersion, CLI_VERSION)) return;

    console.log(`\n  ${c.byellow}${c.bold}↑  Update available${c.reset}  ${c.dim}${CLI_VERSION}${c.reset} -> ${c.bgreen}${c.bold}${remoteVersion}${c.reset}`);
    console.log(`  ${c.dim}Downloading new version...${c.reset}`);

    const downloadUrl = new URL("/cli/gravio.mjs", serverBase).toString();
    const dlRes = await httpGet(downloadUrl);
    if (dlRes.status !== 200) return;

    const currentFile = path.resolve(process.argv[1]);
    writeFileSync(currentFile, dlRes.body, "utf8");
    try {
      chmodSync(currentFile, 0o755);
    } catch {
      // ignore on Windows
    }

    await new Promise((resolve) => {
      const child = spawn(process.execPath, [currentFile, "--no-update", ...process.argv.slice(2)], {
        stdio: "inherit",
      });
      child.on("close", (code) => {
        resolve();
        process.exit(code ?? 0);
      });
    });
  } catch {
    // stay on current version
  }
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
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("--key must be a 64-character hex string");
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

async function ensureAuth(targetDir, server, maybeToken) {
  const existing = loadAuthConfig(targetDir);
  const apiKey = String(maybeToken ?? existing?.apiKey ?? "").trim();
  if (!apiKey) {
    throw new Error("Missing API key. Sign in on onboarding and use: node gravio.mjs --token <gv_...>");
  }

  const meUrl = new URL("/api/me", server).toString();
  const me = await httpGet(meUrl, { Authorization: `Bearer ${apiKey}` });
  if (me.status !== 200) {
    throw new Error("API key validation failed. Go to your project's Commands tab to get a fresh command with your token integrated.");
  }

  saveAuthConfig(targetDir, {
    version: 2,
    updatedAt: new Date().toISOString(),
    server,
    apiKey,
  });
  ensureGravioIgnored(targetDir);
  return { apiKey };
}

async function fetchProjects(server, apiKey) {
  const listUrl = new URL("/api/projects/list", server).toString();
  const res = await httpGet(listUrl, { Authorization: `Bearer ${apiKey}` });
  if (res.status !== 200) return [];
  return parseJsonSafe(res.body)?.projects ?? [];
}

function ensureProjectLink(targetDir, fallbackProjectId = null) {
  const linked = loadProjectState(targetDir);
  if (isValidProjectId(linked?.projectId)) return linked.projectId;

  const oldAuth = loadAuthConfig(targetDir);
  if (isValidProjectId(oldAuth?.projectId)) {
    const projectId = oldAuth.projectId;
    saveProjectState(targetDir, {
      version: 1,
      projectId,
      linkedAt: new Date().toISOString(),
      folderFingerprint: computeFolderFingerprint(targetDir),
    });
    return projectId;
  }

  const projectId = isValidProjectId(fallbackProjectId)
    ? fallbackProjectId
    : generateAutoProjectId(targetDir);

  saveProjectState(targetDir, {
    version: 1,
    projectId,
    linkedAt: new Date().toISOString(),
    folderFingerprint: computeFolderFingerprint(targetDir),
  });
  ensureGravioIgnored(targetDir);
  return projectId;
}

async function handleRun(args) {
  const setupDone = Boolean(loadSetupState(args.target)?.completedAt);
  if (!setupDone) {
    const ok = await runSetup(args.target, { silentNoWork: true, setupVerbose: args.setupVerbose });
    if (!ok) process.exit(1);
  }

  const existingAuth = loadAuthConfig(args.target);
  const server = String(args.server ?? existingAuth?.server ?? DEFAULT_SERVER).trim();

  const { apiKey } = await ensureAuth(args.target, server, args.token);
  const projectId = ensureProjectLink(args.target, args.project);

  if (process.stdout.isTTY) {
    console.log();
    printScanStep(0);
  }

  const scan = scanTargetProject(args.target);
  const evalUrl = new URL("/api/scan-evaluate", server).toString();
  const evalResult = await httpPost(
    evalUrl,
    { scan },
    { Authorization: `Bearer ${apiKey}` },
  );
  if (evalResult.status !== 200) {
    const errMsg = typeof evalResult.data === "object" ? evalResult.data?.error : String(evalResult.data);
    throw new Error(`Scan evaluation failed: HTTP ${evalResult.status}: ${errMsg ?? "Server error"}`);
  }
  const run = evalResult.data;

  const { envelope, keyMessage } = buildEncryptedRunEnvelope(run, {
    project: projectId,
    apiKey,
    key: args.key,
    passphrase: args.passphrase,
    salt: args.salt,
  });

  if (process.stdout.isTTY) {
    printScanStep(8);
    process.stdout.write("\n");
  }

  printScanReport({ run, scan, version: readVersion() });
  process.stdout.write("\n  \x1b[2mCloud-only mode:\x1b[0m no local JSON artifact is written.\n");
  process.stdout.write(`  \x1b[2m${keyMessage}\x1b[0m\n`);

  const publishUrl = new URL("/api/publish", server).toString();
  const result = await httpPost(
    publishUrl,
    { projectId, run: envelope },
    { Authorization: `Bearer ${apiKey}` },
  );

  if (result.status === 200 && result.data?.ok) {
    printPublishResult({ server, project: projectId, success: true });
    process.exit(0);
  }

  const reason = typeof result.data === "object" ? result.data?.error : String(result.data);
  printPublishResult({
    server,
    project: projectId,
    success: false,
    error: `HTTP ${result.status}: ${reason ?? "Publish failed"}`,
  });
  process.exit(1);
}

async function handleLink(args) {
  const existingAuth = loadAuthConfig(args.target);
  const server = String(args.server ?? existingAuth?.server ?? DEFAULT_SERVER).trim();
  const { apiKey } = await ensureAuth(args.target, server, args.token);

  const requested = normalizeProjectId(args.project);
  if (!isValidProjectId(requested)) {
    const projects = await fetchProjects(server, apiKey);
    const names = projects.slice(0, 8).map((p) => p.project_id).join(", ");
    throw new Error(`Provide --project <id>. Existing projects: ${names || "none"}`);
  }

  const projects = await fetchProjects(server, apiKey);
  const exists = projects.some((p) => p.project_id === requested);
  if (!exists) {
    throw new Error(`Project not found on server: ${requested}`);
  }

  saveProjectState(args.target, {
    version: 1,
    projectId: requested,
    linkedAt: new Date().toISOString(),
    folderFingerprint: computeFolderFingerprint(args.target),
  });
  ensureGravioIgnored(args.target);
  process.stdout.write(`\n  Linked this folder to project ${requested}.\n\n`);
}

async function handleRename(args) {
  const existingAuth = loadAuthConfig(args.target);
  const server = String(args.server ?? existingAuth?.server ?? DEFAULT_SERVER).trim();
  const { apiKey } = await ensureAuth(args.target, server, args.token);

  const linkedProjectId = ensureProjectLink(args.target, args.project);
  const toProjectId = normalizeProjectId(args.to);
  if (!isValidProjectId(toProjectId)) throw new Error("Provide a valid destination id: node gravio.mjs rename <new-id>");

  const url = new URL("/api/projects/rename", server).toString();
  const result = await httpPost(
    url,
    { fromProjectId: linkedProjectId, toProjectId },
    { Authorization: `Bearer ${apiKey}` },
  );

  if (result.status !== 200 || !result.data?.ok) {
    const err = typeof result.data === "object" ? result.data?.error : String(result.data);
    throw new Error(`Rename failed: ${err ?? `HTTP ${result.status}`}`);
  }

  saveProjectState(args.target, {
    version: 1,
    projectId: toProjectId,
    linkedAt: new Date().toISOString(),
    folderFingerprint: computeFolderFingerprint(args.target),
  });
  process.stdout.write(`\n  Renamed project ${linkedProjectId} -> ${toProjectId}.\n\n`);
}

async function handleMerge(args) {
  const existingAuth = loadAuthConfig(args.target);
  const server = String(args.server ?? existingAuth?.server ?? DEFAULT_SERVER).trim();
  const { apiKey } = await ensureAuth(args.target, server, args.token);

  const linkedProjectId = ensureProjectLink(args.target, args.project);
  const sourceProjectId = normalizeProjectId(args.from ?? linkedProjectId);
  const destinationProjectId = normalizeProjectId(args.to);

  if (!isValidProjectId(sourceProjectId) || !isValidProjectId(destinationProjectId)) {
    throw new Error("Use: node gravio.mjs merge --to <destination-id> [--from <source-id>]");
  }

  const url = new URL("/api/projects/merge", server).toString();
  const result = await httpPost(
    url,
    { sourceProjectId, destinationProjectId },
    { Authorization: `Bearer ${apiKey}` },
  );

  if (result.status !== 200 || !result.data?.ok) {
    const err = typeof result.data === "object" ? result.data?.error : String(result.data);
    throw new Error(`Merge failed: ${err ?? `HTTP ${result.status}`}`);
  }

  const current = loadProjectState(args.target);
  if (current?.projectId === sourceProjectId) {
    saveProjectState(args.target, {
      version: 1,
      projectId: destinationProjectId,
      linkedAt: new Date().toISOString(),
      folderFingerprint: computeFolderFingerprint(args.target),
    });
  }

  process.stdout.write(`\n  Merged ${sourceProjectId} -> ${destinationProjectId}.\n\n`);
}

async function handleDoctor(args) {
  const setup = loadSetupState(args.target);
  const auth = loadAuthConfig(args.target);
  const project = loadProjectState(args.target);

  process.stdout.write("\n  Gravio doctor\n");
  process.stdout.write(`  Folder: ${path.resolve(args.target)}\n`);
  process.stdout.write(`  Setup: ${setup?.completedAt ? "ok" : "missing"}\n`);
  process.stdout.write(`  Auth: ${auth?.apiKey ? "ok" : "missing"}\n`);
  process.stdout.write(`  Linked project: ${project?.projectId ?? "missing"}\n`);

  if (!auth?.apiKey) process.stdout.write("  Fix: node gravio.mjs --token <gv_...>\n");
  if (auth?.apiKey && !project?.projectId) process.stdout.write("  Fix: node gravio.mjs link --project <id>\n");
  process.stdout.write("\n");
}

function printHelp() {
  const c = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    cyan: "\x1b[96m", green: "\x1b[92m", yellow: "\x1b[93m",
  };
  process.stdout.write(`
  ${c.cyan}${c.bold}gravio CLI${c.reset}  ${c.dim}AI Agent Quality Engine${c.reset}

  ${c.bold}USAGE${c.reset}
    ${c.green}node gravio.mjs${c.reset}                       Scan and publish (uses saved auth)
    ${c.green}node gravio.mjs --token <gv_...>${c.reset}      First-time setup, auth, link, scan, and publish

  ${c.bold}ADVANCED COMMANDS${c.reset}
    ${c.cyan}doctor${c.reset}                                Show setup / auth / link status and repair suggestions
      ${c.dim}node gravio.mjs doctor${c.reset}

    ${c.cyan}link --project <id>${c.reset}                   Relink this folder to an existing project
      ${c.dim}node gravio.mjs link --project <project-id>${c.reset}

    ${c.cyan}rename <new-name>${c.reset}                     Rename the current linked project
      ${c.dim}node gravio.mjs rename <new-name>${c.reset}

    ${c.cyan}merge --to <destination>${c.reset}              Merge current project into destination (finalize in dashboard)
      ${c.dim}node gravio.mjs merge --to <destination-id>${c.reset}

    ${c.cyan}logout${c.reset}                                Clear local auth and project link
      ${c.dim}node gravio.mjs logout${c.reset}

  ${c.bold}OPTIONS${c.reset}
    ${c.dim}--server <url>${c.reset}   Override server  (default: https://gravio.dev)
    ${c.dim}--help${c.reset}           Show this help

  ${c.dim}Full docs \u2192 https://gravio.dev/onboarding${c.reset}

`);
}

function handleLogout(args) {
  deleteAuthConfig(args.target);
  deleteProjectState(args.target);
  process.stdout.write("\n  Local Gravio auth and project link cleared (.gravio/auth.json, .gravio/project.json).\n\n");
}

const args = parseArgs(process.argv.slice(2));
assertNodeSupported();

if (args.help) {
  printHelp();
  process.exit(0);
}

const auth = loadAuthConfig(args.target);
const updateServer = String(args.server ?? auth?.server ?? DEFAULT_SERVER).trim();
if (!args.noUpdate) await checkAndUpdate(updateServer);

if (args.command === "setup") {
  const ok = await runSetup(args.target, { setupVerbose: args.setupVerbose });
  process.exit(ok ? 0 : 1);
}

if (args.command === "logout") {
  handleLogout(args);
  process.exit(0);
}

try {
  if (args.command === "doctor") {
    await handleDoctor(args);
    process.exit(0);
  }
  if (args.command === "link") {
    await handleLink(args);
    process.exit(0);
  }
  if (args.command === "rename") {
    await handleRename(args);
    process.exit(0);
  }
  if (args.command === "merge") {
    await handleMerge(args);
    process.exit(0);
  }

  await handleRun(args);
} catch (err) {
  process.stderr.write(`\n  \x1b[91m\x1b[1m✖  Error\x1b[0m  ${err.message}\n\n`);
  process.exit(1);
}
