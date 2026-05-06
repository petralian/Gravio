/**
 * dashboard.js — Gravio browser dashboard
 *
 * Decrypts run payloads entirely client-side using the Web Cryptography API.
 * Nothing is sent to the server — only the encrypted blob is fetched.
 *
 * Wire format (must match src/core/crypto-e2ee.mjs exactly):
 *   base64( IV[12] | tag[16] | ciphertext[n] )
 *
 * WebCrypto AES-GCM decrypt expects data = ciphertext || tag (tag at end).
 * We repack before calling subtle.decrypt.
 *
 * PBKDF2 parameters (must match crypto-e2ee.mjs):
 *   algorithm: SHA-256, iterations: 210_000, keyLength: 256 bits
 */

"use strict";

/* ─── constants (must mirror crypto-e2ee.mjs) ─── */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PBKDF2_ITER = 210_000;
const KEY_BITS = 256;

/* ─── element handles ─── */
const $ = (id) => document.getElementById(id);

const elProjectId    = $("db-project-id");
const elKeyHex       = $("db-key-hex");
const elPassphrase   = $("db-passphrase");

/* ─── Auth guard + user bar ─────────────────────────────────────────────────── */
let currentUser = null;

(async () => {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) {
      location.href = "/login?next=/dashboard";
      return;
    }
    currentUser = await res.json();
    // Header user pill + logout are managed by site-chrome.js (shared header).
    // Load projects and API keys
    loadProjects();
    loadApiKeys();
  } catch {
    location.href = "/login?next=/dashboard";
  }
})();

/* ─── Projects list ──────────────────────────────────────────────────────────── */
async function loadProjects() {
  try {
    const res = await fetch("/api/runs/list");
    if (!res.ok) return;
    const { runs } = await res.json();
    const section = $("db-projects-section");
    const list = $("db-projects-list");
    if (runs.length === 0) {
      list.innerHTML = `<li class="db-project-empty">No runs published yet. Run the daemon with <code>--publish</code> to see your projects here.</li>`;
    } else {
      list.innerHTML = runs.map((r) => `
        <li class="db-project-item">
          <button class="db-project-btn" type="button" data-project="${esc(r.project_id)}">
            <span class="db-project-id">${esc(r.project_id)}</span>
            <span class="db-project-date">${new Date(r.published_at).toLocaleString()}</span>
          </button>
        </li>
      `).join("");
      list.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-project]");
        if (!btn) return;
        elProjectId.value = btn.dataset.project;
        document.getElementById("form-section").scrollIntoView({ behavior: "smooth" });
        elProjectId.focus();
      });
    }
    section.removeAttribute("hidden");
  } catch { /* silently ignore — projects section is supplemental */ }
}

function esc(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ─── API keys ─────────────────────────────────────────────────────────────── */
async function loadApiKeys() {
  try {
    const res = await fetch("/api/keys");
    if (!res.ok) return;
    const { keys } = await res.json();
    renderKeyList(keys);
    $("db-apikeys-section").removeAttribute("hidden");
  } catch { /* silently ignore */ }
}

function renderKeyList(keys) {
  const list = $("db-keys-list");
  if (!keys || keys.length === 0) {
    list.innerHTML = `<li class="db-key-empty">No API keys yet. Generate one above to use with the CLI.</li>`;
    return;
  }
  list.innerHTML = keys.map((k) => `
    <li class="db-key-item">
      <span class="db-key-label">${esc(k.label)}</span>
      <span class="db-key-created">${new Date(k.created_at).toLocaleDateString()}</span>
      <button class="adm-act-btn adm-act-danger" data-key-id="${k.id}" type="button">Revoke</button>
    </li>
  `).join("");
  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-key-id]");
    if (!btn) return;
    if (!confirm("Revoke this API key? The CLI will stop working until you use a new key.")) return;
    btn.disabled = true;
    await fetch(`/api/keys/${btn.dataset.keyId}`, { method: "DELETE" });
    loadApiKeys();
  }, { once: true });
}

$("db-gen-key").addEventListener("click", async () => {
  const label = $("db-key-label").value.trim() || "default";
  const btn = $("db-gen-key");
  btn.disabled = true;
  try {
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error ?? "Failed"); return; }
    // Show new key banner
    const banner = $("db-new-key-banner");
    $("db-new-key-value").textContent = data.key;
    banner.removeAttribute("hidden");
    $("db-key-label").value = "";
    renderKeyList(data.keys);
  } finally {
    btn.disabled = false;
  }
});

$("db-copy-key").addEventListener("click", () => {
  const val = $("db-new-key-value").textContent;
  navigator.clipboard?.writeText(val).then(() => {
    $("db-copy-key").textContent = "Copied!";
    setTimeout(() => { $("db-copy-key").textContent = "Copy"; }, 2000);
  });
});


const elSalt         = $("db-salt");
const elError        = $("db-error");
const elSubmit       = $("db-submit");
const elSubmitLabel  = $("db-submit-label");
const elResults      = $("db-results");
const elFormSection  = $("form-section");

const elScoreValue   = $("db-score-value");
const elPassBadge    = $("db-pass-badge");
const elRunId        = $("db-run-id");
const elPublishedAt  = $("db-published-at");
const elWpr          = $("db-wpr");
const elSafety       = $("db-safety");
const elCritical     = $("db-critical");
const elGates        = $("db-gates");
const elDimensions   = $("db-dimensions");
const elRawJson      = $("db-raw-json");
const elReload       = $("db-reload");

/* ─── key mode toggle ─── */
const modeHexBtn       = $("mode-hex");
const modePassBtn      = $("mode-passphrase");
const panelHex         = $("panel-hex");
const panelPassphrase  = $("panel-passphrase");

let keyMode = "hex"; // "hex" | "passphrase"

modeHexBtn.addEventListener("click", () => {
  keyMode = "hex";
  modeHexBtn.classList.add("db-mode-active");   modeHexBtn.setAttribute("aria-pressed", "true");
  modePassBtn.classList.remove("db-mode-active"); modePassBtn.setAttribute("aria-pressed", "false");
  panelHex.classList.remove("db-panel-hidden");
  panelPassphrase.classList.add("db-panel-hidden");
});

modePassBtn.addEventListener("click", () => {
  keyMode = "passphrase";
  modePassBtn.classList.add("db-mode-active");   modePassBtn.setAttribute("aria-pressed", "true");
  modeHexBtn.classList.remove("db-mode-active"); modeHexBtn.setAttribute("aria-pressed", "false");
  panelPassphrase.classList.remove("db-panel-hidden");
  panelHex.classList.add("db-panel-hidden");
});

/* ─── helpers ─── */

/**
 * Convert a hex string to Uint8Array.
 * @param {string} hex
 * @returns {Uint8Array}
 */
function hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new Error("Hex string has odd length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Decode a base64 string to Uint8Array (browser-safe).
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToBytes(b64) {
  const bstr = atob(b64);
  const out = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) out[i] = bstr.charCodeAt(i);
  return out;
}

/**
 * Validate a project ID. Mirror of server isValidProjectId().
 * @param {string} id
 * @returns {boolean}
 */
function isValidProjectId(id) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);
}

/* ─── WebCrypto operations ─── */

/**
 * Import a raw 32-byte (64-char hex) key for AES-256-GCM decryption.
 * @param {string} keyHex  — 64-char hex string
 * @returns {Promise<CryptoKey>}
 */
async function importAesKey(keyHex) {
  const keyBytes = hexToBytes(keyHex);
  if (keyBytes.length !== 32) throw new Error("Key must be exactly 32 bytes (64 hex chars)");
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
}

/**
 * Derive an AES-256-GCM key from a passphrase + salt using PBKDF2.
 * Parameters mirror crypto-e2ee.mjs: SHA-256, 210_000 iterations.
 *
 * @param {string} passphrase
 * @param {string} saltHex   — hex-encoded salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveAesKeyFromPassphrase(passphrase, saltHex) {
  const saltBytes = hexToBytes(saltHex);
  const passphraseBytes = new TextEncoder().encode(passphrase);

  const baseKey = await crypto.subtle.importKey(
    "raw",
    passphraseBytes,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PBKDF2_ITER,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["decrypt"],
  );
}

/**
 * Decrypt a base64 payload using the wire format from crypto-e2ee.mjs.
 *
 * Wire format: base64( IV[12] | tag[16] | ciphertext[n] )
 * WebCrypto AES-GCM expects: data = ciphertext || tag (tag appended at end).
 *
 * @param {CryptoKey} cryptoKey — AES-GCM CryptoKey with decrypt usage
 * @param {string}    base64Blob
 * @returns {Promise<string>} decrypted UTF-8 plaintext
 */
async function decryptBlob(cryptoKey, base64Blob) {
  const combined = base64ToBytes(base64Blob);

  if (combined.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Payload too short — may be corrupted");
  }

  const iv         = combined.slice(0, IV_BYTES);
  const tag        = combined.slice(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = combined.slice(IV_BYTES + TAG_BYTES);

  // WebCrypto AES-GCM: data must be ciphertext followed by auth tag
  const data = new Uint8Array(ciphertext.length + TAG_BYTES);
  data.set(ciphertext, 0);
  data.set(tag, ciphertext.length);

  let plainBuffer;
  try {
    plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      cryptoKey,
      data,
    );
  } catch {
    throw new Error("Decryption failed — wrong key or tampered data");
  }

  return new TextDecoder().decode(plainBuffer);
}

/* ─── UI state helpers ─── */

function showError(msg) {
  elError.textContent = msg;
  elError.removeAttribute("hidden");
  elSubmitLabel.textContent = "Decrypt & load scorecard →";
  elSubmit.disabled = false;
}

function clearError() {
  elError.setAttribute("hidden", "");
  elError.textContent = "";
}

function setLoading(loading) {
  elSubmit.disabled = loading;
  elSubmitLabel.textContent = loading ? "Decrypting…" : "Decrypt & load scorecard →";
}

/* ─── Score rendering ─── */

/**
 * Render the scorecard section from a decrypted run JSON string.
 * @param {string} plaintext
 * @param {string} publishedAt  — ISO string from the publish response
 */
function renderScorecard(plaintext, publishedAt) {
  let run;
  try {
    run = JSON.parse(plaintext);
  } catch {
    throw new Error("Decrypted data is not valid JSON — was it encrypted correctly?");
  }

  /* ── score banner ── */
  const score = run?.summary?.overallScore ?? run?.score ?? null;
  const passed = run?.summary?.passed ?? run?.passed ?? null;
  const runId = run?.runId ?? "unknown";

  if (score !== null) {
    elScoreValue.textContent = score;
    elScoreValue.style.color = score >= 80 ? "var(--neon-green)" : score >= 50 ? "var(--neon-cyan)" : "#ff4466";
  } else {
    elScoreValue.textContent = "—";
  }

  if (passed !== null) {
    elPassBadge.textContent = passed ? "PASSED" : "FAILED";
    elPassBadge.className = "badge " + (passed ? "badge-pass" : "badge-fail");
  }

  elRunId.textContent = `Run: ${runId}`;
  elPublishedAt.textContent = publishedAt ? `Published: ${new Date(publishedAt).toLocaleString()}` : "";

  /* ── top metrics ── */
  const dims = run?.scorecard?.dimensions ?? run?.dimensions ?? {};
  const wpr = dims?.["workflow-pass-rate"] ?? null;
  const safety = dims?.["safety"] ?? null;
  const critical = run?.summary?.criticalFailures ?? null;

  elWpr.textContent      = wpr !== null ? `${wpr}` : "—";
  elSafety.textContent   = safety !== null ? `${safety}` : "—";
  elCritical.textContent = critical !== null ? `${critical}` : "—";

  /* ── gates ── */
  elGates.innerHTML = "";
  const gates = run?.summary?.gates ?? run?.gates ?? [];
  if (gates.length > 0) {
    for (const gate of gates) {
      const li = document.createElement("li");
      li.className = "gate-item";
      const icon = gate.passed ? "✓" : "✗";
      const cls  = gate.passed ? "t-pass" : "t-fail";
      li.innerHTML = `
        <span class="${cls} gate-icon">${icon}</span>
        <span class="gate-name">${escapeHtml(gate.name)}</span>
        <span class="gate-detail">${escapeHtml(gate.detail ?? "")}</span>
      `;
      elGates.appendChild(li);
    }
  } else {
    elGates.innerHTML = `<li class="gate-empty">No gate data found in this run.</li>`;
  }

  /* ── dimensions ── */
  elDimensions.innerHTML = "";
  if (typeof dims === "object" && Object.keys(dims).length > 0) {
    for (const [name, value] of Object.entries(dims)) {
      const scoreNum = typeof value === "number" ? value : null;
      const clr = scoreNum === null ? "var(--neon-cyan)" : scoreNum >= 80 ? "var(--neon-green)" : scoreNum >= 50 ? "var(--neon-cyan)" : "#ff4466";
      const card = document.createElement("div");
      card.className = "dim-card";
      card.innerHTML = `
        <div class="dim-name">${escapeHtml(name)}</div>
        <div class="dim-score" style="color:${clr}">${scoreNum !== null ? scoreNum : "—"}</div>
      `;
      elDimensions.appendChild(card);
    }
  } else {
    elDimensions.innerHTML = `<div class="dim-empty">No dimension scores found in this run.</div>`;
  }

  /* ── raw JSON ── */
  elRawJson.value = JSON.stringify(run, null, 2);

  /* ── show results, hide form ── */
  elFormSection.style.display = "none";
  elResults.removeAttribute("hidden");
  elResults.scrollIntoView({ behavior: "smooth", block: "start" });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── main handler ─── */

elSubmit.addEventListener("click", async () => {
  clearError();
  setLoading(true);

  try {
    /* validate project id */
    const projectId = elProjectId.value.trim();
    if (!projectId) throw new Error("Project ID is required");
    if (!isValidProjectId(projectId)) throw new Error("Invalid project ID — use letters, numbers, hyphens and underscores only");

    /* resolve key */
    let cryptoKey;
    if (keyMode === "hex") {
      const keyHex = elKeyHex.value.trim();
      if (!keyHex) throw new Error("Encryption key is required");
      if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("Key must be exactly 64 hexadecimal characters");
      cryptoKey = await importAesKey(keyHex);
    } else {
      const passphrase = elPassphrase.value;
      const saltHex = elSalt.value.trim();
      if (!passphrase) throw new Error("Passphrase is required");
      if (!saltHex) throw new Error("Salt is required when using passphrase mode");
      if (!/^[0-9a-fA-F]+$/.test(saltHex) || saltHex.length % 2 !== 0) {
        throw new Error("Salt must be a valid hex string");
      }
      cryptoKey = await deriveAesKeyFromPassphrase(passphrase, saltHex);
    }

    /* fetch encrypted run from server */
    const res = await fetch(`/api/runs/${encodeURIComponent(projectId)}`);
    if (res.status === 404) throw new Error(`No published run found for project "${projectId}"`);
    if (!res.ok) throw new Error(`Server error ${res.status} fetching run`);

    const body = await res.json();
    if (!body?.ciphertext) throw new Error("Server response missing ciphertext");

    /* decrypt entirely in browser */
    const plaintext = await decryptBlob(cryptoKey, body.ciphertext);

    /* render */
    renderScorecard(plaintext, body.publishedAt ?? null);

  } catch (err) {
    showError(err.message ?? "An unexpected error occurred");
  } finally {
    setLoading(false);
  }
});

/* reload button */
elReload.addEventListener("click", () => {
  elResults.setAttribute("hidden", "");
  elFormSection.style.display = "";
  clearError();
  elSubmitLabel.textContent = "Decrypt & load scorecard →";
  elSubmit.disabled = false;
  elProjectId.focus();
});

/* enter key on inputs */
[elProjectId, elKeyHex, elPassphrase, elSalt].forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") elSubmit.click();
  });
});
