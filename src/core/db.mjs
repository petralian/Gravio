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
    role        TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
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
    published_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(project_id, user_id)
  );
`);

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
  getUserById: db.prepare(`SELECT * FROM users WHERE id=?`),
  listUsers: db.prepare(`SELECT id, email, role, is_active, created_at FROM users ORDER BY id ASC`),
  setUserActive: db.prepare(`UPDATE users SET is_active=? WHERE id=?`),
  deleteUser: db.prepare(`DELETE FROM users WHERE id=?`),

  // sessions
  createSession: db.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
  ),
  getSession: db.prepare(
    `SELECT s.*, u.id as uid, u.email, u.role, u.is_active
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
    `SELECT k.*, u.id as uid, u.email, u.role, u.is_active
     FROM api_keys k JOIN users u ON k.user_id = u.id
     WHERE k.key_hash=?`,
  ),
  listApiKeys: db.prepare(
    `SELECT id, label, created_at FROM api_keys WHERE user_id=? ORDER BY id DESC`,
  ),
  deleteApiKey: db.prepare(`DELETE FROM api_keys WHERE id=? AND user_id=?`),

  // runs
  upsertRun: db.prepare(
    `INSERT INTO runs (project_id, user_id, ciphertext, published_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
     ON CONFLICT(project_id, user_id) DO UPDATE SET
       ciphertext=excluded.ciphertext,
       published_at=excluded.published_at`,
  ),
  getRun: db.prepare(
    `SELECT * FROM runs WHERE project_id=? AND user_id=?`,
  ),
  getRunAdmin: db.prepare(`SELECT * FROM runs WHERE project_id=?`),
  listRunsForUser: db.prepare(
    `SELECT project_id, published_at FROM runs WHERE user_id=? ORDER BY published_at DESC`,
  ),
  listAllRuns: db.prepare(
    `SELECT r.project_id, r.published_at, u.email
     FROM runs r JOIN users u ON r.user_id=u.id
     ORDER BY r.published_at DESC`,
  ),
  runCountPerUser: db.prepare(
    `SELECT user_id, COUNT(*) as run_count FROM runs GROUP BY user_id`,
  ),
};

export { db, ensureAdminRole };
export default db;
