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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runScannerOnce, startScannerWatcher } from "../src/core/scanner.mjs";
import { printScanReport, printWatchUpdate, printPublishResult } from "../src/core/reporter.mjs";

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

const args = parseArgs(process.argv.slice(2));

// Validate publish prerequisites
if (args.publish && !args.project) {
  console.error("error: --publish requires --project <id>");
  process.exit(1);
}

if (args.publish && !args.apiKey) {
  console.error("error: --publish requires --api-key <gv_...>");
  console.error("\nNext steps:");
  console.error("  1) Sign in: https://gravio-platform.fly.dev/login");
  console.error("  2) Create API key in dashboard");
  console.error("  3) Re-run with: --api-key <your_key>\n");
  process.exit(1);
}

if (args.once) {
  const { run, scan } = runScannerOnce({
    targetDir: args.target,
    outputFile: args.output,
    repoRoot: ROOT,
  });

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

console.log(`\n  \x1b[2mGravio scanner watching ${args.target}  (Ctrl+C to stop)\x1b[0m\n`);

process.on("SIGINT", () => {
  watcher.close();
  console.log("gravio-scan: stopped");
  process.exit(0);
});

process.on("SIGTERM", () => {
  watcher.close();
  console.log("gravio-scan: stopped");
  process.exit(0);
});
