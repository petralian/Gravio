/**
 * crypto-e2ee.mjs — Zero-knowledge AES-256-GCM helpers
 *
 * All encryption happens on the caller's machine. The server receives and stores
 * ciphertext only — it has no access to keys and never decrypts.
 *
 * Wire format (base64-encoded binary):
 *   [ IV (12 bytes) | GCM auth-tag (16 bytes) | ciphertext (variable) ]
 *
 * Usage:
 *   const key = generateKey();                     // or deriveKey(passphrase, salt)
 *   const ct  = encrypt(key, JSON.stringify(run)); // → base64 string
 *   const pt  = decrypt(key, ct);                  // → original string
 */
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const PBKDF2_ITER = 210_000;

/**
 * Generate a random 256-bit encryption key.
 * @returns {string} 64-character lowercase hex string
 */
export function generateKey() {
  return randomBytes(KEY_BYTES).toString("hex");
}

/**
 * Generate a random salt for use with deriveKey.
 * @returns {string} 32-character lowercase hex string (16 bytes)
 */
export function generateSalt() {
  return randomBytes(16).toString("hex");
}

/**
 * Derive a 256-bit key from a passphrase + hex salt using PBKDF2-SHA-256.
 * The same passphrase + salt always produces the same key (deterministic).
 * Store the salt alongside the encrypted data so you can re-derive the key.
 *
 * @param {string} passphrase  — user-supplied passphrase (UTF-8)
 * @param {string} saltHex     — hex-encoded salt (use generateSalt() for new keys)
 * @returns {string} 64-character lowercase hex key
 */
export function deriveKey(passphrase, saltHex) {
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

/**
 * Encrypt a UTF-8 plaintext string with AES-256-GCM.
 * A fresh random IV is generated for every call — identical plaintexts produce
 * different ciphertexts (IND-CPA safe).
 *
 * @param {string} keyHex   — 64-char hex key (from generateKey or deriveKey)
 * @param {string} plaintext — UTF-8 string to encrypt
 * @returns {string} base64-encoded combined payload: IV + tag + ciphertext
 */
export function encrypt(keyHex, plaintext) {
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
  // Pack: iv | tag | ciphertext → single base64 blob
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypt a base64-encoded payload produced by encrypt().
 * Throws if the key is wrong or the ciphertext has been tampered with
 * (GCM auth-tag verification failure).
 *
 * @param {string} keyHex          — 64-char hex key used during encryption
 * @param {string} combinedBase64  — base64 payload from encrypt()
 * @returns {string} original UTF-8 plaintext
 */
export function decrypt(keyHex, combinedBase64) {
  if (typeof keyHex !== "string" || keyHex.length !== 64) {
    throw new TypeError("keyHex must be a 64-character hex string");
  }
  if (typeof combinedBase64 !== "string" || combinedBase64.length === 0) {
    throw new TypeError("combinedBase64 must be a non-empty string");
  }
  const combined = Buffer.from(combinedBase64, "base64");
  if (combined.length < IV_BYTES + TAG_BYTES) {
    throw new RangeError("Payload too short to be a valid encrypted blob");
  }
  const iv = combined.subarray(0, IV_BYTES);
  const tag = combined.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = combined.subarray(IV_BYTES + TAG_BYTES);
  const key = Buffer.from(keyHex, "hex");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
