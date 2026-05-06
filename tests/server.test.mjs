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
let TEST_PORT = 13099;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: "GET", headers },
      (res) => { let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body })); }
    );
    req.setTimeout(10_000, () => req.destroy(new Error("timeout")));
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
    req.setTimeout(10_000, () => req.destroy(new Error("timeout")));
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
  TEST_PORT = await findFreePort();
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

  it("redirects fly host to canonical gravio.dev", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/`, { Host: "gravio-platform.fly.dev" });
    assert.strictEqual(res.status, 308);
    assert.strictEqual(res.headers.location, "https://gravio.dev/");
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
  it("permanently redirects to /dashboard", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/tool`);
    assert.strictEqual(res.status, 308);
    assert.strictEqual(res.headers.location, "/dashboard");
  });
});

describe("GET /onboarding", () => {
  it("returns 200 with onboarding HTML", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/onboarding`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers["content-type"]?.includes("text/html"), "Expected HTML content-type");
    assert.ok(res.body.includes("Getting Started"), "Expected onboarding headline");
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
  let cookie;

  it("setup: authenticate user", async () => {
    cookie = await registerAndGetCookie(`eval-${Date.now()}@gravio.test`, "password123");
    assert.ok(cookie);
  });

  it("returns 200 with score for valid run", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/evaluate`, { run: VALID_RUN }, { Cookie: cookie });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(typeof data.score === "number", "score must be a number");
    assert.ok(typeof data.passed === "boolean", "passed must be boolean");
    assert.ok(Array.isArray(data.gates), "gates must be array");
  });

  it("returns 401 when not authenticated", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/evaluate`, { run: VALID_RUN });
    assert.strictEqual(res.status, 401);
  });

  it("returns 400 for missing run field", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/evaluate`, { notRun: true }, { Cookie: cookie });
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

describe("POST /api/keys/onboarding", () => {
  const email = `onboarding-${Date.now()}@gravio.test`;
  let cookie;

  it("setup: register user", async () => {
    cookie = await registerAndGetCookie(email, "password123");
    assert.ok(cookie);
  });

  it("returns 401 without session", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/keys/onboarding`, {});
    assert.strictEqual(res.status, 401);
  });

  it("returns a user-bound gv_ key when authenticated", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/keys/onboarding`, {}, { Cookie: cookie });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.key.startsWith("gv_"), "Key must start with gv_");
    assert.strictEqual(data.ok, true);
  });

  it("rotating the key (second call) returns a fresh key and keeps only one onboarding key", async () => {
    const r1 = await httpPost(`http://localhost:${TEST_PORT}/api/keys/onboarding`, {}, { Cookie: cookie });
    const r2 = await httpPost(`http://localhost:${TEST_PORT}/api/keys/onboarding`, {}, { Cookie: cookie });
    const key1 = JSON.parse(r1.body).key;
    const key2 = JSON.parse(r2.body).key;
    assert.notStrictEqual(key1, key2, "Second call must produce a different key");

    const list = await httpGet(`http://localhost:${TEST_PORT}/api/keys`, { Cookie: cookie });
    const keys = JSON.parse(list.body).keys;
    const onboardingKeys = keys.filter((k) => k.label === "onboarding");
    assert.strictEqual(onboardingKeys.length, 1, "Only one onboarding key should exist after rotation");
  });
});

describe("POST /api/publish + GET /api/runs/:projectId (authenticated)", () => {
  const email = `publish-${Date.now()}@gravio.test`;
  let cookie;
  let apiKey;
  const testRun = { runId: "test-run-001", summary: { overallScore: 75 }, scorecard: { safety: 80 } };
  const encryptedRun = {
    format: "gravio-run-v1",
    encryptedAt: new Date().toISOString(),
    cipher: "aes-256-gcm",
    keyMode: "api-key",
    kdf: { name: "pbkdf2-sha256", iterations: 210000, saltHex: "ab".repeat(32) },
    ciphertext: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  };
  const projectId = `test-proj-${Date.now()}`;
  const encryptedProjectId = `test-proj-enc-${Date.now()}`;

  it("setup: register + create API key", async () => {
    cookie = await registerAndGetCookie(email, "password123");
    const me = await httpGet(`http://localhost:${TEST_PORT}/api/me`, { Cookie: cookie });
    const uid = JSON.parse(me.body).id;
    const { db } = await import(pathToFileURL(path.join(ROOT, "src", "core", "db.mjs")).href);
    db.prepare("UPDATE users SET plan='pro' WHERE id=?").run(uid);
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/keys`, { label: "ci" }, { Cookie: cookie });
    apiKey = JSON.parse(res.body).key;
    assert.ok(apiKey.startsWith("gv_"));
  });

  it("stores a run via Bearer key", async () => {
    const res = await httpPost(
      `http://localhost:${TEST_PORT}/api/publish`,
      { projectId, run: testRun },
      { Authorization: `Bearer ${apiKey}` },
    );
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.ok, true);
  });

  it("stores multiple scans for the same project (history model)", async () => {
    const res = await httpPost(
      `http://localhost:${TEST_PORT}/api/publish`,
      {
        projectId,
        run: { runId: "test-run-002", summary: { overallScore: 82 }, scorecard: { safety: 84 } },
      },
      { Authorization: `Bearer ${apiKey}` },
    );
    assert.strictEqual(res.status, 200);
  });

  it("retrieves stored run via session cookie", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${projectId}`, { Cookie: cookie });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.run?.runId, "test-run-002");
    assert.ok(typeof data.publishedAt === "string");
  });

  it("returns project history with scans in latest-first order", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${projectId}/history`, { Cookie: cookie });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data.scans));
    assert.ok(data.scans.length >= 2);
    assert.strictEqual(data.scans[0].runId, "test-run-002");
    assert.strictEqual(data.scans[1].runId, "test-run-001");
  });

  it("lists projects for relink flows", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/projects/list`, { Cookie: cookie });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data.projects));
    assert.ok(data.projects.some((p) => p.project_id === projectId));
  });

  it("renames a project id", async () => {
    const source = `rename-src-${Date.now()}`;
    const renamed = `rename-dst-${Date.now()}`;

    await httpPost(
      `http://localhost:${TEST_PORT}/api/publish`,
      { projectId: source, run: { runId: "rename-run", summary: { overallScore: 73 } } },
      { Authorization: `Bearer ${apiKey}` },
    );

    const res = await httpPost(
      `http://localhost:${TEST_PORT}/api/projects/rename`,
      { fromProjectId: source, toProjectId: renamed },
      { Cookie: cookie },
    );
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.ok, true);

    const check = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${renamed}`, { Cookie: cookie });
    assert.strictEqual(check.status, 200);
  });

  it("merges source project into destination project", async () => {
    const source = `merge-src-${Date.now()}`;
    const dest = `merge-dst-${Date.now()}`;

    await httpPost(
      `http://localhost:${TEST_PORT}/api/publish`,
      { projectId: source, run: { runId: "m-src", summary: { overallScore: 61 } } },
      { Authorization: `Bearer ${apiKey}` },
    );
    await httpPost(
      `http://localhost:${TEST_PORT}/api/publish`,
      { projectId: dest, run: { runId: "m-dst", summary: { overallScore: 88 } } },
      { Authorization: `Bearer ${apiKey}` },
    );

    const mergeRes = await httpPost(
      `http://localhost:${TEST_PORT}/api/projects/merge`,
      { sourceProjectId: source, destinationProjectId: dest },
      { Cookie: cookie },
    );
    assert.strictEqual(mergeRes.status, 200);
    const mergeBody = JSON.parse(mergeRes.body);
    assert.strictEqual(mergeBody.ok, true);

    const sourceAfter = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${source}`, { Cookie: cookie });
    assert.strictEqual(sourceAfter.status, 404);

    const destHistory = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${dest}/history`, { Cookie: cookie });
    assert.strictEqual(destHistory.status, 200);
    const historyBody = JSON.parse(destHistory.body);
    assert.ok(historyBody.scans.some((s) => s.runId === "m-src"));
    assert.ok(historyBody.scans.some((s) => s.runId === "m-dst"));
  });

  it("deletes selected scans with confirmation endpoint", async () => {
    const history = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${projectId}/history`, { Cookie: cookie });
    const scans = JSON.parse(history.body).scans;
    const targetId = scans.find((s) => s.runId === "test-run-001")?.id;
    assert.ok(targetId, "expected scan id for test-run-001");

    const del = await httpPost(
      `http://localhost:${TEST_PORT}/api/runs/delete`,
      { projectId, scanIds: [targetId] },
      { Cookie: cookie },
    );
    assert.strictEqual(del.status, 200);
    const delBody = JSON.parse(del.body);
    assert.strictEqual(delBody.ok, true);
    assert.strictEqual(delBody.deleted, 1);

    const historyAfter = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${projectId}/history`, { Cookie: cookie });
    const scansAfter = JSON.parse(historyAfter.body).scans;
    assert.ok(scansAfter.every((s) => s.runId !== "test-run-001"));
  });

  it("stores and retrieves encrypted run envelopes", async () => {
    const store = await httpPost(
      `http://localhost:${TEST_PORT}/api/publish`,
      { projectId: encryptedProjectId, run: encryptedRun },
      { Authorization: `Bearer ${apiKey}` },
    );
    assert.strictEqual(store.status, 200);

    const fetch = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${encryptedProjectId}`, { Cookie: cookie });
    assert.strictEqual(fetch.status, 200);
    const data = JSON.parse(fetch.body);
    assert.strictEqual(data.run?.format, "gravio-run-v1");
    assert.strictEqual(data.run?.ciphertext, encryptedRun.ciphertext);
  });

  it("returns 401 for unauthenticated publish", async () => {
    const res = await httpPost(`http://localhost:${TEST_PORT}/api/publish`, { projectId: "x", run: { runId: "x" } });
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
      { projectId: "../../evil", run: { runId: "x" } },
      { Cookie: cookie },
    );
    assert.strictEqual(res.status, 400);
  });

  it("free tier keeps only latest 3 cloud records", async () => {
    const limitCookie = await registerAndGetCookie(`limit-${Date.now()}@gravio.test`, "password123");
    const keyRes = await httpPost(`http://localhost:${TEST_PORT}/api/keys`, { label: "limit" }, { Cookie: limitCookie });
    const limitKey = JSON.parse(keyRes.body).key;

    for (const pid of ["limit-proj-1", "limit-proj-2", "limit-proj-3"]) {
      const okRes = await httpPost(
        `http://localhost:${TEST_PORT}/api/publish`,
        { projectId: pid, run: { runId: pid } },
        { Authorization: `Bearer ${limitKey}` },
      );
      assert.strictEqual(okRes.status, 200);
    }

    const fourth = await httpPost(
      `http://localhost:${TEST_PORT}/api/publish`,
      { projectId: "limit-proj-4", run: { runId: "limit-proj-4" } },
      { Authorization: `Bearer ${limitKey}` },
    );
    assert.strictEqual(fourth.status, 200);

    const list = await httpGet(`http://localhost:${TEST_PORT}/api/runs/list`, { Cookie: limitCookie });
    assert.strictEqual(list.status, 200);
    const data = JSON.parse(list.body);
    assert.strictEqual(data.runs.length, 3, "free tier should retain only latest 3 records");
    assert.ok(data.runs.some((r) => r.project_id === "limit-proj-4"));
  });

  it("free tier receives generic rating only from /api/runs/:projectId", async () => {
    const genericCookie = await registerAndGetCookie(`generic-${Date.now()}@gravio.test`, "password123");
    const keyRes = await httpPost(`http://localhost:${TEST_PORT}/api/keys`, { label: "generic" }, { Cookie: genericCookie });
    const genericKey = JSON.parse(keyRes.body).key;

    const pid = `generic-proj-${Date.now()}`;
    const save = await httpPost(
      `http://localhost:${TEST_PORT}/api/publish`,
      {
        projectId: pid,
        run: {
          runId: "g-1",
          summary: { overallScore: 81.25, workflowPassRate: 0.9 },
          workflowResults: [{ id: "secret-scan", status: "pass" }],
        },
      },
      { Authorization: `Bearer ${genericKey}` },
    );
    assert.strictEqual(save.status, 200);

    const res = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${pid}`, { Cookie: genericCookie });
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.limitedDetails, true);
    assert.strictEqual(body.run?.limitedDetails, true);
    assert.strictEqual(typeof body.run?.summary?.overallScore, "number");
    assert.ok(typeof body.run?.summary?.rating === "string");
    assert.strictEqual(body.run?.workflowResults, undefined);
  });

  it("paid tier receives full details from /api/runs/:projectId", async () => {
    const paidCookie = await registerAndGetCookie(`paid-${Date.now()}@gravio.test`, "password123");
    const me = await httpGet(`http://localhost:${TEST_PORT}/api/me`, { Cookie: paidCookie });
    const paidId = JSON.parse(me.body).id;
    const { db } = await import(pathToFileURL(path.join(ROOT, "src", "core", "db.mjs")).href);
    db.prepare("UPDATE users SET plan='pro' WHERE id=?").run(paidId);

    const keyRes = await httpPost(`http://localhost:${TEST_PORT}/api/keys`, { label: "paid" }, { Cookie: paidCookie });
    const paidKey = JSON.parse(keyRes.body).key;
    const pid = `paid-proj-${Date.now()}`;
    await httpPost(
      `http://localhost:${TEST_PORT}/api/publish`,
      {
        projectId: pid,
        run: {
          runId: "p-1",
          summary: { overallScore: 92.5, workflowPassRate: 1 },
          workflowResults: [{ id: "secret-scan", status: "pass" }],
        },
      },
      { Authorization: `Bearer ${paidKey}` },
    );

    const res = await httpGet(`http://localhost:${TEST_PORT}/api/runs/${pid}`, { Cookie: paidCookie });
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.limitedDetails, false);
    assert.ok(Array.isArray(body.run?.workflowResults));
  });
});

describe("Admin — user plan management", () => {
  let adminCookie;
  let targetId;
  let targetCookie;

  before(async () => {
    // Register a user then directly promote them to admin via the shared DB instance
    const adminEmail = `plan-admin-${Date.now()}@gravio.test`;
    adminCookie = await registerAndGetCookie(adminEmail, "password123");
    const { db } = await import(pathToFileURL(path.join(ROOT, "src", "core", "db.mjs")).href);
    db.prepare("UPDATE users SET role='admin' WHERE email=?").run(adminEmail);

    // Register the target user whose plan we'll manage
    const targetEmail = `plan-target-${Date.now()}@gravio.test`;
    targetCookie = await registerAndGetCookie(targetEmail, "password123");
    const meRes = await httpGet(`http://localhost:${TEST_PORT}/api/me`, { Cookie: targetCookie });
    targetId = JSON.parse(meRes.body).id;
  });

  it("GET /api/me includes plan field", async () => {
    const res = await httpGet(`http://localhost:${TEST_PORT}/api/me`, { Cookie: targetCookie });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(["free", "pro", "team"].includes(data.plan), "plan must be a valid tier");
  });

  it("admin can upgrade a user plan to pro", async () => {
    const res = await httpPost(
      `http://localhost:${TEST_PORT}/api/admin/users/${targetId}/plan`,
      { plan: "pro" },
      { Cookie: adminCookie },
    );
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(JSON.parse(res.body), { ok: true });
  });

  it("rejects invalid plan value with 400", async () => {
    const res = await httpPost(
      `http://localhost:${TEST_PORT}/api/admin/users/${targetId}/plan`,
      { plan: "enterprise" },
      { Cookie: adminCookie },
    );
    assert.strictEqual(res.status, 400);
  });

  it("rejects non-admin caller with 403", async () => {
    const res = await httpPost(
      `http://localhost:${TEST_PORT}/api/admin/users/${targetId}/plan`,
      { plan: "team" },
      { Cookie: targetCookie },
    );
    assert.strictEqual(res.status, 403);
  });

  it("pro user is not blocked after 3 published projects", async () => {
    // targetId user is already on pro plan from the earlier test in this suite
    const keyRes = await httpPost(`http://localhost:${TEST_PORT}/api/keys`, { label: "pro-test" }, { Cookie: targetCookie });
    const proKey = JSON.parse(keyRes.body).key;

    for (const pid of ["pro-p1", "pro-p2", "pro-p3", "pro-p4"]) {
      const r = await httpPost(
        `http://localhost:${TEST_PORT}/api/publish`,
        { projectId: pid, run: { runId: pid } },
        { Authorization: `Bearer ${proKey}` },
      );
      assert.strictEqual(r.status, 200, `Project ${pid} should succeed for pro user`);
    }
  });
});
