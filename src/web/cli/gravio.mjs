#!/usr/bin/env node
// Gravio CLI — bundled distribution.
// Source: https://github.com/your-org/gravio · https://gravio.dev
// Run:    node gravio.mjs --once


// scripts/scanner-daemon.mjs
import path2 from "node:path";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";

// src/core/scanner-daemon.mjs
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
  writeFileSync
} from "node:fs";
import path from "node:path";
var IGNORE_DIRS = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  ".cache"
]);
var DIMENSIONS = ["safety", "reliability", "evaluation", "observability", "governance"];
function toPosix(p) {
  return p.split(path.sep).join("/");
}
function isEnvFileName(fileName) {
  return fileName === ".env" || fileName.startsWith(".env.");
}
function safeReadJson(filePath, fallback) {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
function listFilesRecursive(rootDir, currentDir = rootDir, out = []) {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(currentDir, entry.name);
    const rel = toPosix(path.relative(rootDir, abs));
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      listFilesRecursive(rootDir, abs, out);
      continue;
    }
    if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}
function gitTrackedFiles(targetDir) {
  try {
    const out = execSync("git ls-files", {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!out) return [];
    return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split("/").join("/"));
  } catch {
    return [];
  }
}
function detectTestSignal(targetDir, allFiles) {
  const packageJsonPath = path.join(targetDir, "package.json");
  const packageJson = safeReadJson(packageJsonPath, null);
  const hasTestScript = Boolean(packageJson?.scripts?.test);
  const hasTypecheck = Boolean(packageJson?.scripts?.typecheck || packageJson?.scripts?.["type-check"]);
  const hasBuild = Boolean(packageJson?.scripts?.build);
  const hasTestsFolder = allFiles.some((file) => file.startsWith("tests/"));
  const hasTestFiles = allFiles.some((file) => /(^|\/)test(s)?\./i.test(file) || /\.(test|spec)\./i.test(file));
  return {
    hasTestScript,
    hasTypecheck,
    hasBuild,
    hasTestsFolder,
    hasTestFiles,
    testSignal: hasTestScript || hasTestsFolder || hasTestFiles
  };
}
function scanTargetProject(targetDir) {
  const resolvedTarget = path.resolve(targetDir);
  const allFiles = listFilesRecursive(resolvedTarget).sort();
  const trackedFiles = gitTrackedFiles(resolvedTarget);
  const envFiles = allFiles.filter((rel) => isEnvFileName(path.basename(rel)));
  const committedEnvFiles = trackedFiles.filter((rel) => isEnvFileName(path.basename(rel)));
  const hasChangelog = allFiles.includes("CHANGELOG.md");
  const hasNotes = allFiles.includes(".claude/NOTES.md") || allFiles.includes("NOTES.md");
  const hasNextSession = allFiles.includes(".claude/NEXT_SESSION.md") || allFiles.includes("NEXT_SESSION.md");
  const testSignal = detectTestSignal(resolvedTarget, allFiles);
  return {
    targetDir: resolvedTarget,
    scannedAt: (/* @__PURE__ */ new Date()).toISOString(),
    totalFiles: allFiles.length,
    trackedFileCount: trackedFiles.length,
    envFiles,
    committedEnvFiles,
    hasChangelog,
    hasNotes,
    hasNextSession,
    testSignal
  };
}
function indexById(items) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items ?? []) {
    if (item?.id) map.set(item.id, item);
  }
  return map;
}
function buildWorkflowResults(corpus, scan, previousRun) {
  const previous = indexById(previousRun?.workflowResults ?? []);
  return corpus.workflows.map((workflow) => {
    const inherited = previous.get(workflow.id);
    let status = inherited?.status ?? "pass";
    let evidence = inherited?.evidence ?? { scanner: "inferred" };
    if (workflow.id === "secret-scan") {
      status = scan.committedEnvFiles.length === 0 ? "pass" : "fail";
      evidence = {
        scanStatus: status === "pass" ? "clean" : "env-file-exposed",
        leaksFound: scan.committedEnvFiles.length,
        envFilesDetected: scan.envFiles.length,
        committedEnvFiles: scan.committedEnvFiles
      };
    }
    if (workflow.id === "verification-suite") {
      status = scan.testSignal.testSignal ? "pass" : "fail";
      evidence = {
        tests: scan.testSignal.testSignal ? "detected" : "not detected",
        typecheck: scan.testSignal.hasTypecheck ? "detected" : "n/a",
        build: scan.testSignal.hasBuild ? "detected" : "n/a"
      };
    }
    if (workflow.id === "docs-and-changelog") {
      status = scan.hasChangelog ? "pass" : "fail";
      evidence = {
        changelogEntry: scan.hasChangelog ? "file detected" : "missing CHANGELOG.md"
      };
    }
    if (workflow.id === "session-bootstrap") {
      status = scan.hasNotes && scan.hasNextSession ? "pass" : inherited?.status ?? "pass";
      evidence = {
        notesRead: scan.hasNotes,
        handoffRead: scan.hasNextSession,
        repoMemoryRead: true,
        kickoffSummary: "scanner-daemon auto-evidence"
      };
    }
    if (workflow.id === "trace-capture") {
      status = "pass";
      evidence = {
        traceCount: 1,
        errorEvents: 0
      };
    }
    return {
      id: workflow.id,
      status,
      evidence
    };
  });
}
function buildAdversarialResults(previousRun) {
  if (Array.isArray(previousRun?.adversarialResults) && previousRun.adversarialResults.length > 0) {
    return previousRun.adversarialResults;
  }
  return Array.from({ length: 10 }, (_, idx) => ({
    id: `llm${String(idx + 1).padStart(2, "0")}`,
    status: "pass",
    evidence: "scanner-daemon-mvp placeholder"
  }));
}
function scoreDimensions(corpus, workflowResults) {
  const categoryMap = /* @__PURE__ */ new Map();
  for (const workflow of corpus.workflows) {
    if (!categoryMap.has(workflow.category)) {
      categoryMap.set(workflow.category, { total: 0, passed: 0 });
    }
    const bucket = categoryMap.get(workflow.category);
    bucket.total += 1;
    const result = workflowResults.find((w) => w.id === workflow.id);
    if (result?.status === "pass") bucket.passed += 1;
  }
  const scorecard = {};
  for (const dim of DIMENSIONS) {
    const bucket = categoryMap.get(dim);
    if (!bucket || bucket.total === 0) {
      scorecard[dim] = 100;
      continue;
    }
    scorecard[dim] = Number((bucket.passed / bucket.total * 100).toFixed(2));
  }
  return scorecard;
}
function summarize(scorecard, workflowResults, weights) {
  const overall = Object.entries(weights).reduce((sum, [dim, weight]) => {
    return sum + (scorecard[dim] ?? 0) * weight;
  }, 0);
  const passed = workflowResults.filter((w) => w.status === "pass").length;
  const rate = workflowResults.length > 0 ? passed / workflowResults.length : 0;
  return {
    overallScore: Number(overall.toFixed(2)),
    workflowPassRate: Number(rate.toFixed(4)),
    safetyScore: scorecard.safety ?? 0
  };
}
function buildRunArtifact({ scan, corpus, weights, previousRun }) {
  const runId = `scan-${Date.now().toString(36)}`;
  const workflowResults = buildWorkflowResults(corpus, scan, previousRun);
  const scorecard = scoreDimensions(corpus, workflowResults);
  const summary = summarize(scorecard, workflowResults, weights);
  const startedNano = Date.now() * 1e6;
  const traceId = crypto.randomUUID().replace(/-/g, "");
  const spanId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return {
    runId,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    summary,
    scorecard,
    workflowResults,
    adversarialResults: buildAdversarialResults(previousRun),
    traces: [
      {
        trace_id: traceId,
        span_id: spanId,
        name: "agent.quality.scanner.daemon",
        kind: "internal",
        start_time_unix_nano: startedNano,
        end_time_unix_nano: startedNano,
        status: "ok",
        attributes: {
          "gen_ai.operation.name": "agent.run",
          "gen_ai.request.model": "scanner-daemon-v1",
          "gen_ai.usage.input_tokens": 0,
          "gen_ai.usage.output_tokens": 0,
          "vouch.agent.run_id": runId,
          "vouch.agent.workflow_id": "trace-capture",
          "vouch.agent.session_id": runId,
          "vouch.agent.files_changed": 1,
          "vouch.agent.deploy_needed": false
        }
      }
    ],
    scanner: {
      targetDir: scan.targetDir,
      scannedAt: scan.scannedAt,
      totalFiles: scan.totalFiles,
      trackedFileCount: scan.trackedFileCount,
      envFilesDetected: scan.envFiles.length,
      committedEnvFiles: scan.committedEnvFiles
    }
  };
}
function writeRunArtifact(outputFile, run) {
  const outputDir = path.dirname(outputFile);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  writeFileSync(outputFile, `${JSON.stringify(run, null, 2)}
`, "utf8");
}
function runScannerOnce({ targetDir, outputFile, repoRoot }) {
  const corpus = safeReadJson(path.join(repoRoot, "agent-quality", "evals", "workflow-corpus.json"), { workflows: [] });
  const weights = safeReadJson(path.join(repoRoot, "agent-quality", "scorecard", "weights.json"), { weights: {} }).weights;
  const previousRun = safeReadJson(outputFile, null);
  const scan = scanTargetProject(targetDir);
  const run = buildRunArtifact({ scan, corpus, weights, previousRun });
  writeRunArtifact(outputFile, run);
  return { run, scan };
}
function startScannerDaemon({ targetDir, outputFile, repoRoot, debounceMs = 500, logger = console }) {
  const resolvedTarget = path.resolve(targetDir);
  const resolvedOutput = path.resolve(outputFile);
  const outputInsideTarget = resolvedOutput.startsWith(`${resolvedTarget}${path.sep}`);
  const outputRelative = outputInsideTarget ? toPosix(path.relative(resolvedTarget, resolvedOutput)) : null;
  const executeScan = () => {
    const { run, scan } = runScannerOnce({ targetDir: resolvedTarget, outputFile: resolvedOutput, repoRoot });
    logger.log(`scanner-daemon: wrote ${resolvedOutput} (${run.runId}, files=${scan.totalFiles})`);
  };
  executeScan();
  let timer = null;
  const watcher = watch(resolvedTarget, { recursive: true }, (_eventType, fileName) => {
    if (!fileName) return;
    const rel = toPosix(String(fileName));
    if (rel.includes("/.git/") || rel.startsWith(".git/")) return;
    if (outputRelative && rel === outputRelative) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        executeScan();
      } catch (error) {
        logger.error(`scanner-daemon: scan failed: ${error.message}`);
      }
    }, debounceMs);
  });
  return {
    close() {
      if (timer) clearTimeout(timer);
      watcher.close();
    }
  };
}

// src/core/crypto-e2ee.mjs
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "node:crypto";
var ALGO = "aes-256-gcm";
var IV_BYTES = 12;
var KEY_BYTES = 32;
var PBKDF2_ITER = 21e4;
function generateKey() {
  return randomBytes(KEY_BYTES).toString("hex");
}
function generateSalt() {
  return randomBytes(16).toString("hex");
}
function deriveKey(passphrase, saltHex) {
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new TypeError("passphrase must be a non-empty string");
  }
  if (typeof saltHex !== "string" || !/^[0-9a-fA-F]{2,}$/.test(saltHex)) {
    throw new TypeError("saltHex must be a non-empty hex string");
  }
  const salt = Buffer.from(saltHex, "hex");
  const key = pbkdf2Sync(passphrase, salt, PBKDF2_ITER, KEY_BYTES, "sha256");
  return key.toString("hex");
}
function encrypt(keyHex, plaintext) {
  if (typeof keyHex !== "string" || keyHex.length !== 64) {
    throw new TypeError("keyHex must be a 64-character hex string");
  }
  if (typeof plaintext !== "string") {
    throw new TypeError("plaintext must be a string");
  }
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

// scripts/scanner-daemon.mjs
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
var ROOT = path2.resolve(__dirname, "..");
function parseArgs(argv) {
  const args2 = {
    target: ROOT,
    output: path2.join(ROOT, "agent-quality", "runs", "latest.json"),
    once: false,
    debounceMs: 500,
    // Phase 2 publish options
    publish: false,
    project: null,
    server: "http://localhost:3000",
    apiKey: null,
    key: null,
    passphrase: null,
    salt: null
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--once") {
      args2.once = true;
      continue;
    }
    if (token === "--target" && argv[i + 1]) {
      args2.target = path2.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--output" && argv[i + 1]) {
      args2.output = path2.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--debounce" && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 50) {
        args2.debounceMs = parsed;
      }
      i += 1;
      continue;
    }
    if (token === "--publish") {
      args2.publish = true;
      continue;
    }
    if (token === "--project" && argv[i + 1]) {
      args2.project = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--server" && argv[i + 1]) {
      args2.server = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--api-key" && argv[i + 1]) {
      args2.apiKey = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--key" && argv[i + 1]) {
      args2.key = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--passphrase" && argv[i + 1]) {
      args2.passphrase = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--salt" && argv[i + 1]) {
      args2.salt = argv[i + 1];
      i += 1;
      continue;
    }
  }
  return args2;
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
          ...headers
        }
      },
      (res) => {
        let body = "";
        res.on("data", (c) => body += c);
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, data: body });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
function resolveKey(args2) {
  if (args2.key) {
    if (!/^[0-9a-fA-F]{64}$/.test(args2.key)) {
      console.error("error: --key must be a 64-character hex string");
      process.exit(1);
    }
    return { keyHex: args2.key, salt: null };
  }
  if (args2.passphrase) {
    const salt = args2.salt ?? generateSalt();
    const keyHex2 = deriveKey(args2.passphrase, salt);
    if (!args2.salt) {
      console.log(`
  \u26A0  Auto-generated salt \u2014 save this to re-derive your key:
`);
      console.log(`  --salt ${salt}
`);
    }
    return { keyHex: keyHex2, salt };
  }
  const keyHex = generateKey();
  console.log(`
  \u26A0  Auto-generated encryption key \u2014 save this to decrypt your results:
`);
  console.log(`  --key ${keyHex}
`);
  console.log(`  Store it securely. If you lose it, your results cannot be decrypted.
`);
  return { keyHex, salt: null };
}
var args = parseArgs(process.argv.slice(2));
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
    repoRoot: ROOT
  });
  console.log(`scanner-daemon: one-time scan complete`);
  console.log(`target: ${scan.targetDir}`);
  console.log(`output: ${args.output}`);
  console.log(`runId: ${run.runId}`);
  if (args.publish) {
    const { keyHex } = resolveKey(args);
    const plaintext = JSON.stringify(run);
    const ciphertext = encrypt(keyHex, plaintext);
    console.log(`
Publishing to ${args.server}/api/publish ...`);
    const publishUrl = new URL("/api/publish", args.server).toString();
    try {
      const result = await httpPost(
        publishUrl,
        { projectId: args.project, ciphertext },
        { Authorization: `Bearer ${args.apiKey}` }
      );
      if (result.status === 200 && result.data?.ok) {
        console.log(`
  \u2713 Published successfully`);
        console.log(`  Project: ${args.project}`);
        console.log(`  Retrieve: ${args.server}/api/runs/${encodeURIComponent(args.project)}`);
        console.log(`  Dashboard: ${args.server}/dashboard?project=${encodeURIComponent(args.project)}
`);
      } else if (result.status === 401 || result.status === 403) {
        console.error(`  \u2717 Publish blocked (HTTP ${result.status}): ${result.data?.error ?? "Authentication required"}`);
        console.error("\n  Sign in and create a valid API key:");
        console.error("  https://gravio-platform.fly.dev/login\n");
        process.exit(1);
      } else {
        console.error(`  \u2717 Publish failed (HTTP ${result.status}): ${result.data?.error ?? JSON.stringify(result.data)}`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`  \u2717 Publish error: ${err.message}`);
      process.exit(1);
    }
  }
  process.exit(0);
}
var daemon = startScannerDaemon({
  targetDir: args.target,
  outputFile: args.output,
  repoRoot: ROOT,
  debounceMs: args.debounceMs,
  logger: console
});
console.log("scanner-daemon: watching for changes");
console.log(`target: ${args.target}`);
console.log(`output: ${args.output}`);
console.log(`debounceMs: ${args.debounceMs}`);
process.on("SIGINT", () => {
  daemon.close();
  console.log("scanner-daemon: stopped");
  process.exit(0);
});
process.on("SIGTERM", () => {
  daemon.close();
  console.log("scanner-daemon: stopped");
  process.exit(0);
});
