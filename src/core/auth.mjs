/**
 * auth.mjs — Authentication helpers
 *
 * Password hashing : node:crypto scrypt (N=16384, r=8, p=1, keylen=64)
 * Session tokens   : 32 random bytes → base64url (sent in cookie)
 *                    SHA-256(token) stored in DB — never the plaintext token
 * API keys         : 32 random bytes → base64url prefixed "gv_"
 *                    SHA-256(key) stored in DB
 *
 * Cookie name: __session
 * Cookie flags: HttpOnly; SameSite=Lax; Secure (in production); Path=/
 * Session lifetime: 30 days
 */

import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { stmts, ensureAdminRole } from "./db.mjs";

const scryptAsync = promisify(scrypt);

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_BYTES = 16;
const SESSION_DAYS = 30;
const COOKIE_NAME = "__session";
const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_POLICY_HINT = "Use at least 12 characters with uppercase, lowercase, number, and symbol.";

// ─── Password ─────────────────────────────────────────────────────────────────

/**
 * Hash a password with scrypt. Returns "salt$hash" (both hex).
 */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_LEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
  });
  return `${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verify a password against a stored hash. Returns boolean.
 * Always runs the full scrypt to prevent timing attacks.
 */
export async function verifyPassword(password, storedHash) {
  try {
    const [saltHex, hashHex] = storedHash.split("$");
    if (!saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = await scryptAsync(password, salt, KEY_LEN, {
      N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(email, password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (/\s/.test(password)) {
    return { ok: false, error: "Password cannot contain spaces" };
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return { ok: false, error: PASSWORD_POLICY_HINT };
  }

  const lowered = password.toLowerCase();
  const commonParts = ["password", "qwerty", "letmein", "123456", "admin", "welcome", "changeme"];
  if (commonParts.some((part) => lowered.includes(part))) {
    return { ok: false, error: "Password is too common. Choose a less predictable password." };
  }

  const local = String(email ?? "").trim().toLowerCase().split("@")[0] ?? "";
  if (local.length >= 3 && lowered.includes(local)) {
    return { ok: false, error: "Password cannot include your email name." };
  }

  return { ok: true };
}

// ─── Session tokens ────────────────────────────────────────────────────────────

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function generateToken() {
  return randomBytes(32).toString("base64url");
}

function sessionExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_DAYS);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Create a new session for a user. Returns the plaintext token (sent to browser).
 */
export function createSession(userId) {
  const token = generateToken();
  const hash = sha256Hex(token);
  const expiresAt = sessionExpiry();
  stmts.createSession.run(hash, userId, expiresAt);
  return token;
}

/**
 * Validate a session token from a cookie. Returns user row or null.
 */
export function validateSession(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const hash = sha256Hex(token);
    const row = stmts.getSession.get(hash);
    if (!row || !row.is_active) return null;
    return row;
  } catch {
    return null;
  }
}

/**
 * Destroy a session (logout).
 */
export function destroySession(token) {
  if (!token) return;
  stmts.deleteSession.run(sha256Hex(token));
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

const IS_PROD = process.env.NODE_ENV === "production";

export function setSessionCookie(res, token) {
  const flags = [
    `${COOKIE_NAME}=${token}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${SESSION_DAYS * 86400}`,
    IS_PROD ? "Secure" : null,
  ].filter(Boolean).join("; ");
  res.setHeader("Set-Cookie", flags);
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/**
 * Parse the __session cookie value from Cookie header.
 */
export function parseSessionCookie(req) {
  const header = req.headers["cookie"] ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

// ─── API keys ─────────────────────────────────────────────────────────────────

/**
 * Generate a new API key for a user. Returns plaintext key (shown once).
 */
export function generateApiKey(userId, label = "default") {
  const key = "gv_" + randomBytes(32).toString("base64url");
  const hash = sha256Hex(key);
  stmts.createApiKey.run(hash, userId, label);
  return key;
}

/**
 * Validate a Bearer API key. Returns user row or null.
 */
export function validateApiKey(key) {
  if (!key || typeof key !== "string") return null;
  try {
    const hash = sha256Hex(key);
    const row = stmts.getApiKey.get(hash);
    if (!row || !row.is_active) return null;
    return row;
  } catch {
    return null;
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Register a new user. Returns { ok, error, user }.
 * First registered user becomes admin (unless ADMIN_EMAIL is set).
 */
export async function registerUser(email, password) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) return { ok: false, error: "Invalid email address" };

  const passwordCheck = validatePasswordStrength(normalizedEmail, password);
  if (!passwordCheck.ok) {
    return { ok: false, error: passwordCheck.error };
  }
  const existing = stmts.getUserByEmail.get(normalizedEmail);
  if (existing) return { ok: false, error: "An account with that email already exists" };

  const passwordHash = await hashPassword(password);
  const userCount = stmts.listUsers.all().length;
  const role = userCount === 0 ? "admin" : "user";

  stmts.createUser.run(normalizedEmail, passwordHash, role);
  ensureAdminRole();

  const user = stmts.getUserByEmail.get(normalizedEmail);
  return { ok: true, user };
}

/**
 * Login an existing user. Returns { ok, error, user, token }.
 */
export async function loginUser(email, password) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const user = stmts.getUserByEmail.get(normalizedEmail);
  if (!user) {
    // Still run hash to prevent user enumeration via timing
    await hashPassword("dummy-timing-prevention");
    return { ok: false, error: "Invalid email or password" };
  }
  if (!user.is_active) return { ok: false, error: "Account is disabled" };

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return { ok: false, error: "Invalid email or password" };

  const token = createSession(user.id);
  return { ok: true, user, token };
}

/**
 * Login or create user from an SSO identity.
 */
export async function loginOrCreateSsoUser({ provider, subject, email }) {
  const normalizedProvider = String(provider ?? "").trim().toLowerCase();
  const normalizedSubject = String(subject ?? "").trim();
  const normalizedEmail = String(email ?? "").trim().toLowerCase();

  if (!normalizedProvider || !normalizedSubject || !EMAIL_RE.test(normalizedEmail)) {
    return { ok: false, error: "Invalid SSO identity payload" };
  }

  const linkedUser = stmts.getUserByProviderSubject.get(normalizedProvider, normalizedSubject);
  if (linkedUser) {
    if (!linkedUser.is_active) return { ok: false, error: "Account is disabled" };
    const token = createSession(linkedUser.id);
    return { ok: true, user: linkedUser, token };
  }

  const byEmail = stmts.getUserByEmail.get(normalizedEmail);
  if (byEmail) {
    if (!byEmail.is_active) return { ok: false, error: "Account is disabled" };
    if (byEmail.auth_provider && byEmail.auth_subject) {
      return { ok: false, error: "This account is linked to a different sign-in provider" };
    }
    stmts.linkUserAuthProvider.run(normalizedProvider, normalizedSubject, byEmail.id);
    const user = stmts.getUserById.get(byEmail.id);
    const token = createSession(user.id);
    return { ok: true, user, token };
  }

  const generatedPassword = `${randomBytes(24).toString("base64url")}Aa1!`;
  const passwordHash = await hashPassword(generatedPassword);
  const userCount = stmts.listUsers.all().length;
  const role = userCount === 0 ? "admin" : "user";
  stmts.createUser.run(normalizedEmail, passwordHash, role);
  const created = stmts.getUserByEmail.get(normalizedEmail);
  stmts.linkUserAuthProvider.run(normalizedProvider, normalizedSubject, created.id);
  ensureAdminRole();

  const user = stmts.getUserById.get(created.id);
  const token = createSession(user.id);
  return { ok: true, user, token };
}
