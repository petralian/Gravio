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
import { fileURLToPath, pathToFileURL } from "node:url";

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
  const serverModule = await import(pathToFileURL(path.join(ROOT, "src", "server.mjs")).href);
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
    assert.ok(res.body.includes("<title>Gravio"), "Expected Gravio title in marketing HTML");
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
    // Use http.request with explicit path= to bypass URL normalization in http.get()
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: "localhost", port: TEST_PORT, path: "/../package.json", method: "GET" },
        (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => resolve({ status: r.statusCode, body: b })); }
      );
      req.on("error", reject);
      req.end();
    });
    assert.strictEqual(res.status, 403);
  });
});

describe("GET /tool", () => {
  it("returns 200 with tool HTML", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/tool`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers["content-type"]?.includes("text/html"), "Expected HTML content-type");
    assert.ok(res.body.includes("Scoring Tool"), "Expected Scoring Tool text");
  });
});

describe("GET /health", () => {
  it("returns {status: ok}", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/health`);
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.status, "ok");
  });
});

describe("POST /api/publish + GET /api/runs/:projectId", () => {
  it("stores and retrieves an encrypted blob", async () => {
    const ciphertext = Buffer.from("test-ciphertext").toString("base64");
    const pubRes = await httpPost(`http://localhost:${TEST_PORT}/api/publish`, {
      projectId: "test-proj-phase2",
      ciphertext,
    });
    assert.strictEqual(pubRes.status, 200);
    const pubData = JSON.parse(pubRes.body);
    assert.strictEqual(pubData.ok, true);
    assert.strictEqual(pubData.projectId, "test-proj-phase2");

    const getRes = await httpGet(`http://localhost:${TEST_PORT}/api/runs/test-proj-phase2`);
    assert.strictEqual(getRes.status, 200);
    const getData = JSON.parse(getRes.body);
    assert.strictEqual(getData.ciphertext, ciphertext);
    assert.ok(typeof getData.publishedAt === "string", "publishedAt must be a string");
  });

  it("returns 404 for an unknown project", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/runs/nonexistent-xyz-project`);
    assert.strictEqual(res.status, 404);
  });

  it("returns 400 for invalid projectId on publish", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/publish`, {
      projectId: "../../evil",
      ciphertext: "abc",
    });
    assert.strictEqual(res.status, 400);
  });

  it("returns 400 when ciphertext is missing", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/publish`, {
      projectId: "valid-project-id",
    });
    assert.strictEqual(res.status, 400);
  });
});
