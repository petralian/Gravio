/**
 * settings.js — Gravio account settings page
 *
 * Handles API key management and (for pro/team/admin) the E2EE decrypt tool.
 */

"use strict";

const $ = (id) => document.getElementById(id);

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function isValidProjectId(id) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);
}

function showError(msg) {
  const el = $("st-keys-error");
  el.textContent = msg;
  el.removeAttribute("hidden");
}

function clearError() {
  const el = $("st-keys-error");
  el.textContent = "";
  el.setAttribute("hidden", "");
}

// ─── API Keys ───

async function loadApiKeys() {
  const res = await fetch("/api/keys");
  if (!res.ok) return;
  const { keys } = await res.json();
  renderKeyList(keys ?? []);
}

function renderKeyList(keys) {
  const list = $("st-keys-list");
  if (!keys.length) {
    list.innerHTML = `<li class="db-key-empty">No API keys yet. Generate one above — it will be auto-filled next time you open onboarding.</li>`;
    return;
  }
  list.innerHTML = keys.map((k) => `
    <li class="db-key-item">
      <span class="db-key-label">${esc(k.label)}</span>
      <span class="db-key-created">${new Date(k.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
      <button class="m-btn m-btn-outline m-btn-sm st-revoke-btn" style="border-color:rgba(255,77,77,0.35);color:#ff7080" data-key-id="${k.id}" type="button">Revoke</button>
    </li>
  `).join("");
}

async function onGenerateKey() {
  const raw = $("st-key-label").value.trim() || "default";
  const btn = $("st-gen-key");
  btn.disabled = true;
  clearError();
  try {
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: raw }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error ?? "Failed to generate API key.");
      return;
    }
    $("st-new-key-value").textContent = data.key;
    $("st-new-key-banner").removeAttribute("hidden");
    $("st-key-label").value = "";
    renderKeyList(data.keys ?? []);
  } finally {
    btn.disabled = false;
  }
}

function onRevokeKeyClick(e) {
  const btn = e.target.closest("[data-key-id]");
  if (!btn) return;

  // Two-step inline confirmation (Destructive Action Rule)
  if (btn.dataset.confirming !== "true") {
    btn.dataset.confirming = "true";
    btn.textContent = "Confirm revoke";
    btn.style.setProperty("border-color", "var(--danger)");
    btn.style.setProperty("color", "var(--danger)");
    setTimeout(() => {
      if (btn.dataset.confirming) {
        delete btn.dataset.confirming;
        btn.textContent = "Revoke";
        btn.style.removeProperty("border-color");
        btn.style.removeProperty("color");
      }
    }, 4000);
    return;
  }

  delete btn.dataset.confirming;
  btn.disabled = true;
  fetch(`/api/keys/${btn.dataset.keyId}`, { method: "DELETE" }).then(() => loadApiKeys());
}

// ─── E2EE helpers (runs entirely in-browser, key never sent to server) ───

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Invalid hex value");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKeyHex(passphrase, saltHex, iterations = 210000) {
  const enc         = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits        = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations }, keyMaterial, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function defaultSaltForProject(projectId) {
  const bytes  = new TextEncoder().encode(`gravio-api-key:${projectId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function decryptEnvelope(envelope, keyHex) {
  const payload     = base64ToBytes(envelope.ciphertext ?? "");
  const iv          = payload.slice(0, 12);
  const tag         = payload.slice(12, 28);
  const ciphertext  = payload.slice(28);
  const cipherWithTag = new Uint8Array(ciphertext.length + tag.length);
  cipherWithTag.set(ciphertext, 0);
  cipherWithTag.set(tag, ciphertext.length);
  const key   = await crypto.subtle.importKey("raw", hexToBytes(keyHex), { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, cipherWithTag);
  return JSON.parse(new TextDecoder().decode(plain));
}

async function loadOptionalE2EE() {
  const projectId = String($("st-e2ee-project").value ?? "").trim();
  const apiKey    = String($("st-e2ee-key").value ?? "").trim();
  if (!isValidProjectId(projectId)) {
    showError("Enter a valid project ID.");
    return;
  }
  if (!apiKey.startsWith("gv_")) {
    showError("Enter a valid API key (gv_...).");
    return;
  }

  const out = $("st-e2ee-output");
  out.value = "Loading\u2026";

  const res  = await fetch(`/api/runs/${encodeURIComponent(projectId)}`);
  const body = await res.json();
  if (!res.ok) {
    out.value = JSON.stringify(body, null, 2);
    return;
  }

  if (!body?.run?.format || body.run.format !== "gravio-run-v1") {
    out.value = JSON.stringify(body.run, null, 2);
    return;
  }

  const saltHex    = String(body.run?.kdf?.saltHex ?? await defaultSaltForProject(projectId)).toLowerCase();
  const iterations = Number(body.run?.kdf?.iterations ?? 210000);
  const keyHex     = await deriveKeyHex(apiKey, saltHex, iterations);
  const decrypted  = await decryptEnvelope(body.run, keyHex);
  out.value = JSON.stringify(decrypted, null, 2);
}

// ─── Init ───

async function init() {
  try {
    const me = await fetch("/api/me");
    if (!me.ok) {
      location.href = "/login?next=/settings";
      return;
    }
    const user = await me.json();

    if (user.plan === "pro" || user.plan === "team" || user.role === "admin") {
      $("st-e2ee-section")?.removeAttribute("hidden");
    }

    await loadApiKeys();

    $("st-gen-key")?.addEventListener("click", onGenerateKey);
    $("st-keys-list")?.addEventListener("click", onRevokeKeyClick);

    $("st-copy-key")?.addEventListener("click", async () => {
      const val = $("st-new-key-value").textContent;
      await navigator.clipboard?.writeText(val);
      $("st-copy-key").textContent = "Copied!";
      setTimeout(() => { $("st-copy-key").textContent = "Copy"; }, 1600);
    });

    $("st-e2ee-load")?.addEventListener("click", loadOptionalE2EE);
  } catch {
    location.href = "/login?next=/settings";
  }
}

init();
