/**
 * tests/server.test.mjs
 * Integration smoke tests for the HTTP server.
 * Run: node --test tests/server.test.mjs
 *
 * Starts the server on a random port, tests endpoints, then shuts down.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Dynamically import server module but override PORT
let server;
const TEST_PORT = 13099;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

function httpPost(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const parsed = new URL(url);
    const req = http.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const VALID_RUN = {
  runId: "test-server",
  scorecard: { safety: 95, reliability: 90, evaluation: 90, observability: 89, governance: 95 },
  workflowResults: [{ id: "verification-suite", status: "pass" }],
  adversarialResults: [{ id: "llm01", status: "pass" }],
};

before(async () => {
  process.env.PORT = String(TEST_PORT);
  // Import and start server
  const serverModule = await import(`${ROOT}/src/server.mjs`);
  server = serverModule.default ?? serverModule.server;
  // Wait for server to be listening
  await new Promise((r) => setTimeout(r, 200));
});

after(() => {
  if (server && server.close) server.close();
});

describe("GET /", () => {
  it("returns 200 with HTML content", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes("<title>Agent Scorecard Platform</title>"), "Expected title in HTML");
  });
});

describe("GET /styles.css", () => {
  it("returns 200 with CSS content-type", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/styles.css`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers["content-type"]?.includes("text/css"), "Expected CSS content-type");
  });
});

describe("POST /api/evaluate", () => {
  it("returns 200 with score for valid run", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/evaluate`, { run: VALID_RUN });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(typeof data.score === "number", "score must be a number");
    assert.ok(typeof data.passed === "boolean", "passed must be boolean");
    assert.ok(Array.isArray(data.gates), "gates must be array");
  });

  it("returns 400 for missing run field", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/evaluate`, { notRun: true });
    assert.strictEqual(res.status, 400);
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: "localhost", port: TEST_PORT, path: "/api/evaluate", method: "POST", headers: { "Content-Type": "application/json" } },
        (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => resolve({ status: r.statusCode, body: b })); }
      );
      req.on("error", reject);
      req.write("{bad json}");
      req.end();
    });
    assert.strictEqual(res.status, 400);
  });

  it("path traversal is blocked with 403", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/../package.json`);
    assert.strictEqual(res.status, 403);
  });
});
