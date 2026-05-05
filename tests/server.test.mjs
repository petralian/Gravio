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

// Use a test-only DB so we don't pollute local data/db.sqlite
process.env.DB_PATH = path.join(ROOT, "data", "test.sqlite");

let server;
const TEST_PORT = 13099;

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: "GET", headers },
      (res) => { let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body })); }
    );
    req.on("error", reject);
    req.end();
  });
}

function httpPost(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname, port: parsed.port, path: parsed.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers },
      },
      (res) => { let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body })); }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/** Register a user and return the Set-Cookie header value for subsequent requests. */
async function registerAndGetCookie(email, password) {
  const res = await httpPost(`http://localhost:${TEST_PORT}/auth/register`, { email, password });
  const setCookie = res.headers["set-cookie"];
  if (!setCookie) throw new Error("No Set-Cookie header after register");
  const cookie = Array.isArray(setCookie) ? setCookie[0].split(";")[0] : setCookie.split(";")[0];
  return cookie;
}

const VALID_RUN = {
  runId: "test-server",
  scorecard: { safety: 95, reliability: 90, evaluation: 90, observability: 89, governance: 95 },
  workflowResults: [{ id: "verification-suite", status: "pass" }],
  adversarialResults: [{ id: "llm01", status: "pass" }],
};

before(async () => {
  // Ensure data/ directory exists and remove stale test DB
  const { default: fs } = await import("node:fs");
  fs.mkdirSync(path.dirname(process.env.DB_PATH), { recursive: true });
  try { fs.unlinkSync(process.env.DB_PATH); } catch { /* ok if not present */ }
  process.env.PORT = String(TEST_PORT);
  const serverModule = await import(pathToFileURL(path.join(ROOT, "src", "server.mjs")).href);
  server = serverModule.default ?? serverModule.server;
  await new Promise((r) => setTimeout(r, 300));
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

describe("GET /login", () => {
  it("returns 200 with login HTML", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/login`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers["content-type"]?.includes("text/html"));
    assert.ok(res.body.includes("login.js"));
  });
});

describe("GET /dp", () => {
  it("returns 200 with admin HTML at /dp (auth guard is client-side)", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/dp`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers["content-type"]?.includes("text/html"));
    assert.ok(res.body.includes("admin.js"));
  });

  it("returns 404 for the old /admin URL", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/admin`);
    assert.strictEqual(res.status, 404);
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

describe("GET /dashboard", () => {
  it("returns 200 with dashboard HTML", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/dashboard`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers["content-type"]?.includes("text/html"), "Expected HTML content-type");
    assert.ok(res.body.includes("Gravio"), "Expected Gravio brand text");
    assert.ok(res.body.includes("dashboard.js"), "Expected dashboard.js script tag");
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

  it("path traversal is blocked with 403", async () => {
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

describe("Auth — register / login / logout / me", () => {
  const email = `test-${Date.now()}@gravio.test`;
  const password = "hunter2-test";
  let cookie;

  it("registers a new user and returns a session cookie", async () => {
    cookie = await registerAndGetCookie(email, password);
    assert.ok(cookie.includes("__session="), "Cookie must contain __session token");
  });

  it("GET /api/me returns authenticated user", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/me`, { Cookie: cookie });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.email, email.toLowerCase());
    assert.ok(["user", "admin"].includes(data.role));
  });

  it("GET /api/me returns 401 without session", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/me`);
    assert.strictEqual(res.status, 401);
  });

  it("registers duplicate email returns 400", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/auth/register`, { email, password });
    assert.strictEqual(res.status, 400);
    const data = JSON.parse(res.body);
    assert.ok(data.error);
  });

  it("login with correct credentials returns session", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/auth/login`, { email, password });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.ok, true);
    assert.ok(res.headers["set-cookie"]);
  });

  it("login with wrong password returns 401", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/auth/login`, { email, password: "wrongpassword" });
    assert.strictEqual(res.status, 401);
  });

  it("logout clears session", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/auth/logout`, {}, { Cookie: cookie });
    assert.strictEqual(res.status, 200);
    const setCookie = res.headers["set-cookie"] ?? "";
    assert.ok(String(setCookie).includes("Max-Age=0"), "Logout must clear cookie");
  });
});

describe("API keys", () => {
  const email = `apikey-${Date.now()}@gravio.test`;
  let cookie;
  let apiKey;

  it("setup: register user", async () => {
    cookie = await registerAndGetCookie(email, "password123");
    assert.ok(cookie);
  });

  it("generates an API key", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/keys`, { label: "test-key" }, { Cookie: cookie });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.key.startsWith("gv_"), "Key must start with gv_");
    apiKey = data.key;
  });

  it("lists API keys", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/keys`, { Cookie: cookie });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data.keys));
    assert.ok(data.keys.length >= 1);
  });

  it("Bearer API key authenticates /api/me", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/me`, { Authorization: `Bearer ${apiKey}` });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.email, email.toLowerCase());
  });
});

describe("POST /api/publish + GET /api/runs/:projectId (authenticated)", () => {
  const email = `publish-${Date.now()}@gravio.test`;
  let cookie;
  let apiKey;
  const ciphertext = Buffer.from("test-e2e-ciphertext").toString("base64");
  const projectId = `test-proj-${Date.now()}`;

  it("setup: register + create API key", async () => {
    cookie = await registerAndGetCookie(email, "password123");
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/keys`, { label: "ci" }, { Cookie: cookie });
    apiKey = JSON.parse(res.body).key;
    assert.ok(apiKey.startsWith("gv_"));
  });

  it("stores an encrypted blob via Bearer key", async () => {
    const res = await httpPost(
      `http://localhost:${TEST_PORT}/api/publish`,
      { projectId, ciphertext },
      { Authorization: `Bearer ${apiKey}` },
    );
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.ok, true);
  });

  it("retrieves stored blob via session cookie", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${projectId}`, { Cookie: cookie });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.ciphertext, ciphertext);
    assert.ok(typeof data.publishedAt === "string");
  });

  it("returns 401 for unauthenticated publish", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/publish`, { projectId: "x", ciphertext: "abc" });
    assert.strictEqual(res.status, 401);
  });

  it("returns 401 for unauthenticated run fetch", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${projectId}`);
    assert.strictEqual(res.status, 401);
  });

  it("returns 404 for project belonging to another user", async () => {
    const cookie2 = await registerAndGetCookie(`other-${Date.now()}@gravio.test`, "password123");
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${projectId}`, { Cookie: cookie2 });
    assert.strictEqual(res.status, 404);
  });

  it("returns 400 for invalid projectId on publish", async () => {
    const res = await httpPost(
      `http://localhost:${TEST_PORT}/api/publish`,
      { projectId: "../../evil", ciphertext: "abc" },
      { Cookie: cookie },
    );
    assert.strictEqual(res.status, 400);
  });
});


