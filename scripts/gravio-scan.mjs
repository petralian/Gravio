#!/usr/bin/env node
/**
 * gravio-scan.mjs
 *
 * Gravio Scanner CLI — entry point.
 * Usage:
 *   node scripts/gravio-scan.mjs --once
 *   node scripts/gravio-scan.mjs --target ../some-project --output agent-quality/runs/latest.json
 *
 * Publish encrypted results:
 *   node scripts/gravio-scan.mjs --once --publish --project my-saas --api-key gv_xxx
 *   node scripts/gravio-scan.mjs --once --publish --project my-saas --api-key gv_xxx --passphrase "my secret"
 *   node scripts/gravio-scan.mjs --once --publish --project my-saas --api-key gv_xxx --key <64-char-hex>
 *   node scripts/gravio-scan.mjs --once --publish --project my-saas --api-key gv_xxx --passphrase "x" --salt <hex>
 */
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { runScannerOnce, startScannerWatcher } from "../src/core/scanner.mjs";
import { printScanReport, printWatchUpdate, printPublishResult, printScanStep } from "../src/core/reporter.mjs";

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
    debounceMs: 500,
    publish: false,
    project: null,
    server: "http://localhost:3000",
    apiKey: null,
    noUpdate: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--once") {
      args.once = true;
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
    if (token === "--no-update") {
      args.noUpdate = true;
      continue;
    }
  }

  return args;
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

// Auto-update: check server for a newer CLI version before doing anything else.
// Skips silently if offline or running from source. Pass --no-update to opt out.
if (!args.noUpdate) {
  await checkAndUpdate(args.server);
}

// Validate publish prerequisites
if (args.publish && !args.project) {
  process.stderr.write("\n  \x1b[91m\x1b[1m✖  Error\x1b[0m  --publish requires --project <id>\n\n");
  process.exit(1);
}

if (args.publish && !args.apiKey) {
  process.stderr.write("\n  \x1b[91m\x1b[1m✖  Error\x1b[0m  --publish requires --api-key <gv_...>\n\n");
  process.stderr.write("  \x1b[2mSteps:\x1b[0m\n");
  process.stderr.write("    1) Sign in  →  \x1b[36mhttps://gravio.dev/login\x1b[0m\n");
  process.stderr.write("    2) Get API key in your dashboard\n");
  process.stderr.write("    3) Re-run with  \x1b[97m--api-key gv_...\x1b[0m\n\n");
  process.exit(1);
}

if (args.once) {
  // ── Progress: start ─────────────────────────────────────────────────────
  if (process.stdout.isTTY) {
    console.log();
    printScanStep(0);
  }

  const { run, scan } = runScannerOnce({
    targetDir: args.target,
    outputFile: args.output,
    repoRoot: ROOT,
  });

  // ── Progress: done ──────────────────────────────────────────────────────
  if (process.stdout.isTTY) {
    const SCAN_TOTAL = 8;
    printScanStep(SCAN_TOTAL);
    process.stdout.write("\n");
  }

  printScanReport({ run, scan, version: readVersion() });

  if (args.publish) {
    const publishUrl = new URL("/api/publish", args.server).toString();

    try {
      const result = await httpPost(
        publishUrl,
        { projectId: args.project, run },
        { Authorization: `Bearer ${args.apiKey}` },
      );
      if (result.status === 200 && result.data?.ok) {
        printPublishResult({ server: args.server, project: args.project, success: true });
      } else if (result.status === 401 || result.status === 403) {
        printPublishResult({
          server: args.server, project: args.project, success: false,
          error: `HTTP ${result.status}: ${result.data?.error ?? "Authentication required"}`,
        });
        process.exit(1);
      } else {
        printPublishResult({
          server: args.server, project: args.project, success: false,
          error: `HTTP ${result.status}: ${result.data?.error ?? JSON.stringify(result.data)}`,
        });
        process.exit(1);
      }
    } catch (err) {
      printPublishResult({ server: args.server, project: args.project, success: false, error: err.message });
      process.exit(1);
    }
  }

  process.exit(0);
}

const watcher = startScannerWatcher({
  targetDir: args.target,
  outputFile: args.output,
  repoRoot: ROOT,
  debounceMs: args.debounceMs,
  logger: console,
  onScan: printWatchUpdate,
});

console.log(
  `\n  \x1b[96m\x1b[1m  gravio  \x1b[0m\x1b[2m watch mode\x1b[0m\n` +
  `\n  \x1b[2mWatching\x1b[0m  \x1b[36m${args.target}\x1b[0m` +
  `\n  \x1b[2mDebounce  ${args.debounceMs}ms  ·  Ctrl+C to stop\x1b[0m\n`
);

process.on("SIGINT", () => {
  watcher.close();
  console.log("\n  \x1b[2mgravio: stopped\x1b[0m\n");
  process.exit(0);
});

process.on("SIGTERM", () => {
  watcher.close();
  console.log("\n  \x1b[2mgravio: stopped\x1b[0m\n");
  process.exit(0);
});
