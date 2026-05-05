/**
 * tests/crypto-e2ee.test.mjs
 * Unit tests for src/core/crypto-e2ee.mjs
 * Run: node --test tests/crypto-e2ee.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKey, generateSalt, deriveKey, encrypt, decrypt } from "../src/core/crypto-e2ee.mjs";

describe("generateKey", () => {
  it("returns a 64-character lowercase hex string", () => {
    const key = generateKey();
    assert.strictEqual(typeof key, "string");
    assert.strictEqual(key.length, 64);
    assert.match(key, /^[0-9a-f]{64}$/);
  });

  it("produces a unique key on every call", () => {
    assert.notStrictEqual(generateKey(), generateKey());
  });
});

describe("generateSalt", () => {
  it("returns a 32-character hex string (16 bytes)", () => {
    const salt = generateSalt();
    assert.strictEqual(typeof salt, "string");
    assert.strictEqual(salt.length, 32);
    assert.match(salt, /^[0-9a-f]{32}$/);
  });

  it("produces a unique salt on every call", () => {
    assert.notStrictEqual(generateSalt(), generateSalt());
  });
});

describe("deriveKey", () => {
  it("is deterministic: same passphrase + salt produces same key", () => {
    const salt = generateSalt();
    assert.strictEqual(deriveKey("my-passphrase", salt), deriveKey("my-passphrase", salt));
  });

  it("produces different keys for different passphrases", () => {
    const salt = generateSalt();
    assert.notStrictEqual(deriveKey("pass-A", salt), deriveKey("pass-B", salt));
  });

  it("produces different keys for different salts", () => {
    assert.notStrictEqual(
      deriveKey("same-pass", generateSalt()),
      deriveKey("same-pass", generateSalt())
    );
  });

  it("throws for empty passphrase", () => {
    assert.throws(() => deriveKey("", generateSalt()), TypeError);
  });

  it("throws for invalid saltHex", () => {
    assert.throws(() => deriveKey("passphrase", "not-hex!"), TypeError);
  });
});

describe("encrypt / decrypt", () => {
  it("roundtrip: decrypt(encrypt(plaintext)) === plaintext", () => {
    const key = generateKey();
    const plaintext = JSON.stringify({ runId: "test-run", score: 97, passed: true });
    assert.strictEqual(decrypt(key, encrypt(key, plaintext)), plaintext);
  });

  it("encrypts to a non-empty base64 string different from plaintext", () => {
    const key = generateKey();
    const plaintext = "hello world";
    const ct = encrypt(key, plaintext);
    assert.ok(ct.length > 0);
    assert.notStrictEqual(ct, plaintext);
  });

  it("produces different ciphertext on each call (random IV)", () => {
    const key = generateKey();
    const plaintext = "same input every time";
    assert.notStrictEqual(encrypt(key, plaintext), encrypt(key, plaintext));
  });

  it("throws when decrypting with the wrong key", () => {
    const key = generateKey();
    const wrongKey = generateKey();
    const ct = encrypt(key, "secret payload");
    assert.throws(() => decrypt(wrongKey, ct));
  });

  it("throws when ciphertext is truncated / tampered", () => {
    const key = generateKey();
    const ct = encrypt(key, "data");
    // Corrupt by slicing off end bytes
    assert.throws(() => decrypt(key, ct.slice(0, ct.length - 4)));
  });

  it("works with empty string plaintext", () => {
    const key = generateKey();
    assert.strictEqual(decrypt(key, encrypt(key, "")), "");
  });

  it("works with large JSON payload", () => {
    const key = generateKey();
    const large = JSON.stringify({ data: "x".repeat(50_000), nested: { a: 1 } });
    assert.strictEqual(decrypt(key, encrypt(key, large)), large);
  });
});

describe("deriveKey + encrypt / decrypt roundtrip", () => {
  it("passphrase-derived key can encrypt and decrypt", () => {
    const salt = generateSalt();
    const key = deriveKey("my-secure-passphrase", salt);
    const plaintext = "zero-knowledge by design";
    assert.strictEqual(decrypt(key, encrypt(key, plaintext)), plaintext);
  });
});
