/**
 * db.mjs — SQLite database layer
 *
 * Schema:
 *   users    — email/password accounts, role (user | admin)
 *   sessions — HTTP-only cookie sessions (token hash stored, not plaintext)
 *   api_keys — CLI bearer tokens for /api/publish (hash stored, not plaintext)
 *   runs     — encrypted run payloads (replaces in-memory runStore)
 *
 * DB path resolution:
 *   1. DB_PATH env var (explicit override)
 *   2. /data/db.sqlite  (Fly.io persistent volume)
 *   3. ./data/db.sqlite (local dev fallback — created automatically)
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  // Fly.io mounts a persistent volume at /data
  if (fs.existsSync("/data")) return "/data/db.sqlite";
  // Local dev
  const localDir = path.join(process.cwd(), "data");
  fs.mkdirSync(localDir, { recursive: true });
  return path.join(localDir, "db.sqlite");
}

const DB_PATH = resolveDbPath();
const db = new Database(DB_PATH);

// WAL mode — better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT  NOT NULL,
    auth_provider TEXT,
    auth_subject TEXT,
    role        TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    plan        TEXT    NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','team')),
    billing_provider TEXT,
    lemon_customer_id TEXT,
    lemon_subscription_id TEXT,
    billing_status TEXT    NOT NULL DEFAULT 'none',
    billing_seats INTEGER NOT NULL DEFAULT 1,
    billing_renews_at TEXT,
    billing_cancelled INTEGER NOT NULL DEFAULT 0,
    billing_portal_url TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash  TEXT    NOT NULL UNIQUE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash    TEXT    NOT NULL UNIQUE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label       TEXT    NOT NULL DEFAULT 'default',
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT    NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ciphertext  TEXT    NOT NULL,
    published_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    provider    TEXT    NOT NULL,
    event_key   TEXT    NOT NULL,
    event_name  TEXT,
    object_id   TEXT,
    payload     TEXT,
    processed_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(provider, event_key)
  );

  CREATE TABLE IF NOT EXISTS magic_links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT    NOT NULL UNIQUE,
    email      TEXT    NOT NULL,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT    NOT NULL,
    used_at    TEXT,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
`);

// ─── Migrations (idempotent — run on every start) ───────────────────────────

// Add plan column if upgrading from a pre-plan schema
try {
  db.exec(`ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','team'))`);
} catch {
  // Column already exists — ignore
}

try {
  db.exec(`ALTER TABLE users ADD COLUMN auth_provider TEXT`);
} catch {
  // Column already exists — ignore
}

try {
  db.exec(`ALTER TABLE users ADD COLUMN auth_subject TEXT`);
} catch {
  // Column already exists — ignore
}

try {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_auth_provider_subject_uq
      ON users(auth_provider, auth_subject)
      WHERE auth_provider IS NOT NULL AND auth_subject IS NOT NULL
  `);
} catch {
  // Index already exists — ignore
}

try {
  db.exec(`ALTER TABLE users ADD COLUMN billing_provider TEXT`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN lemon_customer_id TEXT`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN lemon_subscription_id TEXT`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'none'`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN billing_seats INTEGER NOT NULL DEFAULT 1`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN billing_renews_at TEXT`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN billing_cancelled INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN billing_portal_url TEXT`);
} catch {
  // Column already exists — ignore
}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      provider    TEXT    NOT NULL,
      event_key   TEXT    NOT NULL,
      event_name  TEXT,
      object_id   TEXT,
      payload     TEXT,
      processed_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(provider, event_key)
    )
  `);
} catch {
  // Table already exists — ignore
}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS magic_links (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT    NOT NULL UNIQUE,
      email      TEXT    NOT NULL,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT    NOT NULL,
      used_at    TEXT,
      created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )
  `);
} catch {
  // Table already exists — ignore
}

// Migration: older schema enforced one run per (project_id, user_id) via UNIQUE.
// New model stores scan history rows, so drop that unique constraint safely.
try {
  const runsSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='runs'`).get()?.sql ?? "";
  if (runsSql.includes("UNIQUE(project_id, user_id)")) {
    db.exec(`
      CREATE TABLE runs_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id  TEXT    NOT NULL,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ciphertext  TEXT    NOT NULL,
        published_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      INSERT INTO runs_new (id, project_id, user_id, ciphertext, published_at)
      SELECT id, project_id, user_id, ciphertext, published_at FROM runs;

      DROP TABLE runs;
      ALTER TABLE runs_new RENAME TO runs;
    `);
  }
} catch {
  // If migration fails unexpectedly, keep startup non-fatal; tests will catch regressions.
}

try {
  db.exec(`ALTER TABLE users ADD COLUMN scans_published INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists — ignore
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_history (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id      TEXT    NOT NULL,
      scanned_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      git_commit      TEXT,
      overall_score   REAL,
      dimension_scores TEXT,
      checks_run      TEXT,
      recommendations TEXT
    )
  `);
} catch {
  // Table already exists — ignore
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS scan_history_user_project_scanned
      ON scan_history(user_id, project_id, scanned_at DESC)
  `);
} catch {
  // Index already exists — ignore
}

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_contexts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scan_id       INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      project_id    TEXT    NOT NULL,
      context_note  TEXT,
      action_items  TEXT,
      created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(user_id, scan_id)
    )
  `);
} catch {
  // Table already exists — ignore
}

try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS scan_contexts_user_project_updated
      ON scan_contexts(user_id, project_id, updated_at DESC)
  `);
} catch {
  // Index already exists — ignore
}

// Promote first registered user (or ADMIN_EMAIL) to admin if no admin exists yet
function ensureAdminRole() {
  const adminCount = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='admin'`).get().c;
  if (adminCount > 0) return;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    db.prepare(`UPDATE users SET role='admin' WHERE email=? COLLATE NOCASE`).run(adminEmail);
  } else {
    // Promote oldest user
    const first = db.prepare(`SELECT id FROM users ORDER BY id ASC LIMIT 1`).get();
    if (first) db.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(first.id);
  }
}

// ─── Prepared statements ──────────────────────────────────────────────────────

export const stmts = {
  // users
  createUser: db.prepare(
    `INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)`,
  ),
  getUserByEmail: db.prepare(`SELECT * FROM users WHERE email=? COLLATE NOCASE`),
  getUserByProviderSubject: db.prepare(
    `SELECT * FROM users WHERE auth_provider=? AND auth_subject=?`,
  ),
  getUserById: db.prepare(`SELECT * FROM users WHERE id=?`),
  linkUserAuthProvider: db.prepare(
    `UPDATE users SET auth_provider=?, auth_subject=? WHERE id=?`,
  ),
  listUsers: db.prepare(`SELECT id, email, role, plan, is_active, created_at FROM users ORDER BY id ASC`),
  setUserPlan: db.prepare(`UPDATE users SET plan=? WHERE id=?`),
  getBillingForUser: db.prepare(
    `SELECT id, email, plan, billing_provider, lemon_customer_id, lemon_subscription_id,
            billing_status, billing_seats, billing_renews_at, billing_cancelled, billing_portal_url
     FROM users WHERE id=?`,
  ),
  setUserBillingState: db.prepare(
    `UPDATE users
     SET plan=?,
         billing_provider='lemonsqueezy',
         lemon_customer_id=?,
         lemon_subscription_id=?,
         billing_status=?,
         billing_seats=?,
         billing_renews_at=?,
         billing_cancelled=?,
         billing_portal_url=?
     WHERE id=?`,
  ),
  setUserActive: db.prepare(`UPDATE users SET is_active=? WHERE id=?`),
  deleteUser: db.prepare(`DELETE FROM users WHERE id=?`),

  // sessions
  createSession: db.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
  ),
  getSession: db.prepare(
    `SELECT s.*, u.id as uid, u.email, u.role, u.plan, u.is_active
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.token_hash=? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  ),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE token_hash=?`),
  cleanExpiredSessions: db.prepare(
    `DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  ),

  // api keys
  createApiKey: db.prepare(
    `INSERT INTO api_keys (key_hash, user_id, label) VALUES (?, ?, ?)`,
  ),
  getApiKey: db.prepare(
    `SELECT k.*, u.id as uid, u.email, u.role, u.plan, u.is_active
     FROM api_keys k JOIN users u ON k.user_id = u.id
     WHERE k.key_hash=?`,
  ),
  listApiKeys: db.prepare(
    `SELECT id, label, created_at FROM api_keys WHERE user_id=? ORDER BY id DESC`,
  ),
  deleteApiKey: db.prepare(`DELETE FROM api_keys WHERE id=? AND user_id=?`),

  // runs
  insertRun: db.prepare(
    `INSERT INTO runs (project_id, user_id, ciphertext, published_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`,
  ),
  getLatestRun: db.prepare(
    `SELECT * FROM runs
     WHERE project_id=? AND user_id=?
     ORDER BY published_at DESC, id DESC
     LIMIT 1`,
  ),
  getLatestRunAdmin: db.prepare(
    `SELECT * FROM runs
     WHERE project_id=?
     ORDER BY published_at DESC, id DESC
     LIMIT 1`,
  ),
  listProjectScansForUser: db.prepare(
    `SELECT id, project_id, ciphertext, published_at
     FROM runs
     WHERE project_id=? AND user_id=?
     ORDER BY published_at DESC, id DESC`,
  ),
  listRunsForUser: db.prepare(
    `SELECT project_id,
            MAX(published_at) AS last_scan_at,
            COUNT(*) AS scan_count
     FROM runs
     WHERE user_id=?
     GROUP BY project_id
     ORDER BY last_scan_at DESC`,
  ),
  countRunsForProjectUser: db.prepare(
    `SELECT COUNT(*) AS c FROM runs WHERE project_id=? AND user_id=?`,
  ),
  renameProjectRunsForUser: db.prepare(
    `UPDATE runs SET project_id=? WHERE project_id=? AND user_id=?`,
  ),
  deleteScanByIdForUserProject: db.prepare(
    `DELETE FROM runs WHERE id=? AND user_id=? AND project_id=?`,
  ),
  getScanByIdForUserProject: db.prepare(
    `SELECT id, project_id, published_at
     FROM runs
     WHERE id=? AND user_id=? AND project_id=?`,
  ),
  listAllRuns: db.prepare(
    `SELECT r.project_id, r.published_at, u.email
     FROM runs r JOIN users u ON r.user_id=u.id
     ORDER BY r.published_at DESC`,
  ),
  trimRunsForFreeUser: db.prepare(
    `DELETE FROM runs
     WHERE user_id=?
       AND id NOT IN (
         SELECT id FROM runs
         WHERE user_id=?
         ORDER BY published_at DESC, id DESC
         LIMIT 3
       )`,
  ),
  incrementScansPublished: db.prepare(
    `UPDATE users SET scans_published = scans_published + 1 WHERE id=?`,
  ),
  runCountPerUser: db.prepare(
    `SELECT user_id, COUNT(*) as run_count FROM runs GROUP BY user_id`,
  ),

  // webhook idempotency + audit log
  insertWebhookEvent: db.prepare(
    `INSERT OR IGNORE INTO webhook_events (provider, event_key, event_name, object_id, payload)
     VALUES (?, ?, ?, ?, ?)`,
  ),
  listWebhookEvents: db.prepare(
    `SELECT id, provider, event_name, object_id, processed_at
     FROM webhook_events
     ORDER BY processed_at DESC
     LIMIT 100`,
  ),

  // billing diagnostics
  listBillingUsers: db.prepare(
    `SELECT id, email, plan, billing_provider, lemon_customer_id, lemon_subscription_id,
            billing_status, billing_seats, billing_renews_at, billing_cancelled
     FROM users
     ORDER BY id ASC`,
  ),

  // magic links (one-time sign-in tokens)
  createMagicLink: db.prepare(
    `INSERT INTO magic_links (token_hash, email, user_id, expires_at) VALUES (?, ?, ?, ?)`,
  ),
  getMagicLinkByToken: db.prepare(
    `SELECT * FROM magic_links
     WHERE token_hash=? AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  ),
  consumeMagicLink: db.prepare(
    `UPDATE magic_links SET used_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE token_hash=? AND used_at IS NULL`,
  ),

  // password management
  updatePasswordHash: db.prepare(`UPDATE users SET password_hash=? WHERE id=?`),

  // scan_history
  insertScanHistory: db.prepare(
    `INSERT INTO scan_history (user_id, project_id, git_commit, overall_score, dimension_scores, checks_run, recommendations)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ),
  listScanHistory: db.prepare(
    `SELECT id, project_id, scanned_at, git_commit, overall_score, dimension_scores
     FROM scan_history
     WHERE user_id=? AND project_id=?
     ORDER BY scanned_at DESC`,
  ),
  getRecentScanScores: db.prepare(
    `SELECT scanned_at, overall_score
     FROM scan_history
     WHERE user_id=? AND project_id=?
     ORDER BY scanned_at DESC
     LIMIT 60`,
  ),
  listScanContextsForProject: db.prepare(
    `SELECT scan_id, context_note, action_items, updated_at
     FROM scan_contexts
     WHERE user_id=? AND project_id=?`,
  ),
  upsertScanContext: db.prepare(
    `INSERT INTO scan_contexts (user_id, scan_id, project_id, context_note, action_items)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, scan_id)
     DO UPDATE SET
       context_note=excluded.context_note,
       action_items=excluded.action_items,
       updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  ),
};

export { db, ensureAdminRole };
export default db;
