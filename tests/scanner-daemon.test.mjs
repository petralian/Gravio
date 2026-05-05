/**
 * tests/scanner-daemon.test.mjs
 * Unit tests for Scanner Daemon v1 core behavior.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScannerOnce } from "../src/core/scanner-daemon.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const tempDirs = [];

function makeTempProject() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "scorecard-scan-"));
  tempDirs.push(dir);
  return dir;
}

function createBasicProject(projectDir) {
  writeFileSync(path.join(projectDir, "CHANGELOG.md"), "# Changelog\n", "utf8");
  writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: "tmp-project", version: "0.0.1", scripts: { test: "node --test", build: "node -e \"0\"" } }, null, 2),
    "utf8"
  );
  mkdirSync(path.join(projectDir, "tests"), { recursive: true });
  writeFileSync(path.join(projectDir, "tests", "sample.test.mjs"), "import { test } from 'node:test'; test('ok', () => {});\n", "utf8");
  mkdirSync(path.join(projectDir, ".claude"), { recursive: true });
  writeFileSync(path.join(projectDir, ".claude", "NOTES.md"), "notes\n", "utf8");
  writeFileSync(path.join(projectDir, ".claude", "NEXT_SESSION.md"), "next\n", "utf8");
}

function initGit(projectDir) {
  execSync("git init", { cwd: projectDir, stdio: "ignore" });
  execSync("git config user.name \"Scanner Test\"", { cwd: projectDir, stdio: "ignore" });
  execSync("git config user.email \"scanner@test.local\"", { cwd: projectDir, stdio: "ignore" });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("scanner daemon v1", () => {
  it("writes evaluator-compatible latest run JSON", () => {
    const projectDir = makeTempProject();
    createBasicProject(projectDir);
    initGit(projectDir);

    const outputFile = path.join(projectDir, "agent-quality", "runs", "latest.json");
    const result = runScannerOnce({
      targetDir: projectDir,
      outputFile,
      repoRoot: ROOT,
    });

    assert.ok(result.run.runId.startsWith("scan-"));
    assert.ok(Array.isArray(result.run.workflowResults));
    assert.ok(result.run.workflowResults.length >= 10);
    assert.ok(Array.isArray(result.run.traces));
    assert.strictEqual(result.run.traces.length, 1);

    const saved = JSON.parse(readFileSync(outputFile, "utf8"));
    assert.strictEqual(saved.runId, result.run.runId);
    assert.ok(saved.summary && typeof saved.summary.overallScore === "number");
    assert.ok(saved.scorecard && typeof saved.scorecard.safety === "number");
  });

  it("flags committed .env file as secret-scan failure", () => {
    const projectDir = makeTempProject();
    createBasicProject(projectDir);
    initGit(projectDir);

    writeFileSync(path.join(projectDir, ".env"), "SUPER_SECRET=topsecret\n", "utf8");
    execSync("git add .env", { cwd: projectDir, stdio: "ignore" });

    const outputFile = path.join(projectDir, "agent-quality", "runs", "latest.json");
    const { run } = runScannerOnce({
      targetDir: projectDir,
      outputFile,
      repoRoot: ROOT,
    });

    const secretScan = run.workflowResults.find((w) => w.id === "secret-scan");
    assert.ok(secretScan, "secret-scan workflow missing");
    assert.strictEqual(secretScan.status, "fail");
    assert.ok(secretScan.evidence.leaksFound >= 1);
  });

  it("does not read .env content and passes when .env is not tracked", () => {
    const projectDir = makeTempProject();
    createBasicProject(projectDir);
    initGit(projectDir);

    writeFileSync(path.join(projectDir, ".env.local"), Buffer.from([0xff, 0x00, 0xfe, 0x0a]));

    const outputFile = path.join(projectDir, "agent-quality", "runs", "latest.json");
    const { run } = runScannerOnce({
      targetDir: projectDir,
      outputFile,
      repoRoot: ROOT,
    });

    const secretScan = run.workflowResults.find((w) => w.id === "secret-scan");
    assert.ok(secretScan, "secret-scan workflow missing");
    assert.strictEqual(secretScan.status, "pass");
    assert.strictEqual(secretScan.evidence.leaksFound, 0);
  });
});
