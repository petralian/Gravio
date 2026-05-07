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

function showBillingError(msg) {
  const el = $("st-billing-error");
  if (!el) return;
  el.textContent = msg;
  el.removeAttribute("hidden");
}

function clearBillingError() {
  const el = $("st-billing-error");
  if (!el) return;
  el.textContent = "";
  el.setAttribute("hidden", "");
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString([], { dateStyle: "medium" });
}

function planBadgeHtml(plan) {
  const p = String(plan ?? "free").toLowerCase();
  return `<span class="st-plan-badge st-plan-${p}">${p.toUpperCase()}</span>`;
}

function statusPillHtml(status) {
  const s = String(status ?? "none").toLowerCase();
  const label = s === "none" ? "No subscription" : s.replace(/_/g, " ");
  return `<span class="st-status-pill st-status-${s}">${label}</span>`;
}

function renderBillingCard(data) {
  const plan      = String(data.plan ?? "free").toLowerCase();
  const status    = String(data.status ?? "none").toLowerCase();
  const cancelled = Boolean(data.cancelled);

  $("st-billing-plan").innerHTML     = planBadgeHtml(plan);
  $("st-billing-status").innerHTML   = statusPillHtml(status);
  $("st-billing-seats").textContent  = String(data.seats ?? 1);

  const renewEl = $("st-billing-renews");
  renewEl.textContent   = fmtDate(data.renewsAt);
  renewEl.title         = data.renewsAt ?? "";

  // Cancels-at-period-end warning
  const warnEl = $("st-billing-cancel-warn");
  if (cancelled && status === "active") {
    warnEl.removeAttribute("hidden");
  } else {
    warnEl.setAttribute("hidden", "");
  }

  // Portal link
  const manage = $("st-billing-manage");
  if (manage && data.portalUrl) {
    manage.setAttribute("href", data.portalUrl);
  }

  // Seats adjuster (team plan only, active subscription)
  const seatsAdj = $("st-seats-adjuster");
  if (plan === "team" && status === "active") {
    seatsAdj.removeAttribute("hidden");
    $("st-seats-input").value = String(data.seats ?? 2);
  } else {
    seatsAdj.setAttribute("hidden", "");
  }

  // Cancel / Resume buttons
  const canCancel = status === "active" && !cancelled;
  const canResume = status === "active" && cancelled;
  $("st-billing-cancel").toggleAttribute("hidden", !canCancel);
  $("st-billing-resume").toggleAttribute("hidden", !canResume);

  // Always hide the confirm bar on re-render
  $("st-cancel-confirm").setAttribute("hidden", "");
}

async function loadBillingStatus() {
  clearBillingError();
  const res = await fetch("/api/billing/status");
  const data = await res.json();
  if (!res.ok) {
    showBillingError(data.error ?? "Failed to load billing status.");
    return;
  }
  renderBillingCard(data);
}

// ─── Billing actions ───

function onCancelClick() {
  // Two-step: first click shows confirmation bar, hides cancel button
  $("st-billing-cancel").setAttribute("hidden", "");
  $("st-cancel-confirm").removeAttribute("hidden");
}

function onCancelNo() {
  $("st-cancel-confirm").setAttribute("hidden", "");
  $("st-billing-cancel").removeAttribute("hidden");
}

async function onCancelYes() {
  const btn = $("st-cancel-yes");
  btn.disabled = true;
  btn.textContent = "Cancelling…";
  clearBillingError();
  try {
    const res  = await fetch("/api/billing/cancel", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      showBillingError(data.error ?? "Failed to cancel subscription.");
      $("st-cancel-confirm").setAttribute("hidden", "");
      $("st-billing-cancel").removeAttribute("hidden");
      return;
    }
    await loadBillingStatus();
  } catch {
    showBillingError("Network error — please try again.");
    $("st-cancel-confirm").setAttribute("hidden", "");
    $("st-billing-cancel").removeAttribute("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Yes, cancel";
  }
}

async function onResumePlan() {
  const btn = $("st-billing-resume");
  btn.disabled = true;
  btn.textContent = "Resuming…";
  clearBillingError();
  try {
    const res  = await fetch("/api/billing/resume", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      showBillingError(data.error ?? "Failed to resume subscription.");
      return;
    }
    await loadBillingStatus();
  } catch {
    showBillingError("Network error — please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Resume plan";
  }
}

async function onAdjustSeats() {
  const seatsEl  = $("st-seats-input");
  const btn      = $("st-seats-save");
  const errorEl  = $("st-seats-error");
  const seats    = Number(seatsEl.value);
  errorEl.setAttribute("hidden", "");

  if (!Number.isInteger(seats) || seats < 2 || seats > 10) {
    errorEl.textContent = "Seats must be between 2 and 10.";
    errorEl.removeAttribute("hidden");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Updating…";
  clearBillingError();
  try {
    const res  = await fetch("/api/billing/seats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seats }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error ?? "Failed to update seats.";
      errorEl.removeAttribute("hidden");
      return;
    }
    await loadBillingStatus();
  } catch {
    errorEl.textContent = "Network error — please try again.";
    errorEl.removeAttribute("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Update seats";
  }
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

// ─── Password change ───

function showPwError(msg) {
  const el = $("st-pw-error");
  el.textContent = msg;
  el.removeAttribute("hidden");
  $("st-pw-success").setAttribute("hidden", "");
}

function showPwSuccess() {
  $("st-pw-success").removeAttribute("hidden");
  $("st-pw-error").setAttribute("hidden", "");
  $("st-pw-current").value = "";
  $("st-pw-new").value = "";
  $("st-pw-confirm").value = "";
}

async function onPasswordSave() {
  $("st-pw-error").setAttribute("hidden", "");
  $("st-pw-success").setAttribute("hidden", "");

  const currentPassword = $("st-pw-current")?.value ?? "";
  const newPassword = $("st-pw-new").value;
  const confirmPassword = $("st-pw-confirm").value;

  if (!newPassword) { showPwError("New password is required."); return; }
  if (newPassword !== confirmPassword) { showPwError("New passwords do not match."); return; }

  const btn = $("st-pw-save");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const res = await fetch("/auth/password/change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPassword || undefined, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) { showPwError(data.error ?? "Failed to update password."); return; }
    showPwSuccess();
  } catch {
    showPwError("Network error — please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Update password";
  }
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

    if (user.plan === "team" || user.role === "admin") {
      $("st-e2ee-section")?.removeAttribute("hidden");
    }

    // Hide current-password field for SSO-only users
    if (user.authProvider) {
      $("st-pw-current-wrap")?.setAttribute("hidden", "");
    }

    await loadBillingStatus();
    await loadApiKeys();

    $("st-gen-key")?.addEventListener("click", onGenerateKey);
    $("st-keys-list")?.addEventListener("click", onRevokeKeyClick);
    $("st-pw-save")?.addEventListener("click", onPasswordSave);
    $("st-billing-cancel")?.addEventListener("click", onCancelClick);
    $("st-cancel-yes")?.addEventListener("click", onCancelYes);
    $("st-cancel-no")?.addEventListener("click", onCancelNo);
    $("st-billing-resume")?.addEventListener("click", onResumePlan);
    $("st-seats-save")?.addEventListener("click", onAdjustSeats);

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
