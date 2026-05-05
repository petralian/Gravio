#!/usr/bin/env node
/**
 * secret-scan.mjs
 * Context-aware secret scanner for the Agent Scorecard Platform.
 * Strict on git-staged files, permissive on .env (only flags PEM/admin tokens).
 * SAFE_VALUES: known dev-only strings that are explicitly allowed.
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SAFE_VALUES = new Set([
  "SCORECARD-DEV-2026",
  "example",
  "your-key-here",
  "your_secret_here",
  "changeme",
  "placeholder",
  "xxxx",
]);

const SECRET_PATTERNS = [
  { name: "Generic API Key", pattern: /api[_-]?key\s*[:=]\s*["']?[a-zA-Z0-9]{20,}/i },
  { name: "Generic Secret", pattern: /secret\s*[:=]\s*["']?[a-zA-Z0-9+/]{20,}/i },
  { name: "Private Key Header", pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "Bearer Token", pattern: /bearer\s+[a-zA-Z0-9._-]{30,}/i },
  { name: "Password in config", pattern: /password\s*[:=]\s*["'][^"']{6,}["']/i },
  { name: "Connection string", pattern: /postgres:\/\/[^:]+:[^@]+@/ },
];

const STRICT_PATTERNS = [
  ...SECRET_PATTERNS,
  { name: "Short token (10+ chars)", pattern: /token\s*[:=]\s*["']?[a-zA-Z0-9]{10,}/i },
];

function getGitStagedFiles() {
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACM", {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

function scanFile(filePath, patterns, label) {
  const findings = [];
  if (!existsSync(filePath)) return findings;
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, pattern } of patterns) {
      if (pattern.test(line)) {
        const match = line.match(pattern)?.[0] ?? "";
        const isSafe = [...SAFE_VALUES].some((v) => line.toLowerCase().includes(v.toLowerCase()));
        if (!isSafe) {
          findings.push({ file: label, line: i + 1, rule: name, snippet: line.trim().slice(0, 80) });
        }
      }
    }
  }
  return findings;
}

const allFindings = [];

// Scan staged files strictly
const staged = getGitStagedFiles();
for (const rel of staged) {
  const abs = path.join(ROOT, rel);
  const isEnv = rel.endsWith(".env") || rel.includes(".env.");
  const patterns = isEnv ? SECRET_PATTERNS : STRICT_PATTERNS;
  allFindings.push(...scanFile(abs, patterns, rel));
}

// Always scan .env files in project root (permissive)
const envCandidates = [".env", ".env.local", ".env.development"];
for (const envFile of envCandidates) {
  const abs = path.join(ROOT, envFile);
  if (!staged.includes(envFile)) {
    allFindings.push(...scanFile(abs, SECRET_PATTERNS, envFile));
  }
}

console.log(`\nAgent Scorecard — Secret Scan`);
console.log(`─────────────────────────────`);
console.log(`Staged files scanned: ${staged.length}`);

if (allFindings.length === 0) {
  console.log(`Result: CLEAN — no secrets found\n`);
  process.exit(0);
} else {
  console.error(`Result: FOUND ${allFindings.length} potential secret(s)\n`);
  for (const f of allFindings) {
    console.error(`  [${f.file}:${f.line}] ${f.rule}`);
    console.error(`    ${f.snippet}`);
  }
  process.exit(1);
}
