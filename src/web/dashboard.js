/**
 * dashboard.js — Gravio browser dashboard
 *
 * Loads encrypted run envelopes from the server and decrypts them in-browser.
 */

"use strict";

const $ = (id) => document.getElementById(id);

"use strict";

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  projects: [],
  selectedProject: null,
  selectedScanIds: new Set(),
  currentScans: [],
};

const elError = $("db-error");
const elProjectList = $("db-projects-list");
const elProjectSection = $("db-projects-section");
const elProjectDetail = $("db-project-detail");
const elScanRows = $("db-scan-rows");
const elDeleteSelected = $("db-delete-selected");
const elDeleteConfirm = $("db-delete-confirm");
const elConfirmDelete = $("db-confirm-delete");
const elCancelDelete = $("db-cancel-delete");

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
  elError.textContent = msg;
  elError.removeAttribute("hidden");
}

function clearError() {
  elError.textContent = "";
  elError.setAttribute("hidden", "");
}

function formatScore(score) {
  return Number.isFinite(score) ? String(Math.round(score)) : "—";
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.valueOf()) ? "—" : d.toLocaleString();
}

function trendLabel(direction, delta) {
  if (!Number.isFinite(delta)) return "stable";
  if (direction === "up") return `up +${delta}`;
  if (direction === "down") return `down ${delta}`;
  return "stable 0";
}

function renderOverview(projects) {
  const projectCount = projects.length;
  const totalScans = projects.reduce((acc, p) => acc + Number(p.scan_count ?? 0), 0);
  const sorted = [...projects].sort((a, b) => String(b.last_scan_at).localeCompare(String(a.last_scan_at)));
  const lastScanAt = sorted[0]?.last_scan_at ?? null;

  $("db-project-count").textContent = String(projectCount);
  $("db-scan-count").textContent = String(totalScans);
  $("db-last-scan").textContent = formatDate(lastScanAt);
}

function renderProjects(projects) {
  if (!projects.length) {
    elProjectList.innerHTML = `<li class="db-project-empty">No cloud scans yet. Run node gravio.mjs --once in a project to publish your first scan.</li>`;
    elProjectSection.removeAttribute("hidden");
    return;
  }

  elProjectList.innerHTML = projects.map((p) => `
    <li class="db-project-item">
      <button class="db-project-btn" type="button" data-project="${esc(p.project_id)}">
        <span class="db-project-id">${esc(p.project_id)}</span>
        <span class="db-project-date">${formatDate(p.last_scan_at)} · ${Number(p.scan_count ?? 0)} scans · ${esc(p.latest_rating ?? "Unknown")}</span>
      </button>
    </li>
  `).join("");
  elProjectSection.removeAttribute("hidden");
}

function renderHistory(projectId, payload) {
  const stats = payload?.stats ?? {};
  const scans = payload?.scans ?? [];
  const limited = Boolean(payload?.limitedDetails);

  state.selectedProject = projectId;
  state.currentScans = scans;
  state.selectedScanIds.clear();

  $("db-selected-project").textContent = projectId;
  $("db-detail-total").textContent = String(stats.totalScans ?? scans.length ?? 0);
  $("db-detail-best").textContent = formatScore(stats.bestScore);
  $("db-detail-avg").textContent = formatScore(stats.averageScore);
  $("db-detail-trend").textContent = trendLabel(stats.trendDirection, stats.trendDelta);

  const latest = scans[0];
  if (!latest) {
    $("db-summary-text").textContent = "No scans found for this project.";
    $("db-recommendations").innerHTML = "";
    elScanRows.innerHTML = `<tr><td colspan="5" class="db-project-empty">No scans found.</td></tr>`;
    elProjectDetail.removeAttribute("hidden");
    return;
  }

  const scoreText = Number.isFinite(latest.overallScore) ? `Latest score: ${Math.round(latest.overallScore)} (${latest.rating}).` : `Latest rating: ${latest.rating}.`;
  const limitedText = limited ? " Detailed remediation is available on Pro/Team." : "";
  $("db-summary-text").textContent = `${scoreText} Last scan at ${formatDate(latest.publishedAt)}.${limitedText}`;

  const recs = [];
  for (const s of scans.slice(0, 3)) {
    for (const r of (s.recommendations ?? [])) {
      if (!recs.includes(r)) recs.push(r);
    }
  }
  if (!recs.length) recs.push("Keep scanning regularly to maintain trend visibility.");
  $("db-recommendations").innerHTML = recs.map((r) => `<li>${esc(r)}</li>`).join("");

  elScanRows.innerHTML = scans.map((s) => `
    <tr>
      <td><input type="checkbox" data-scan-id="${s.id}" /></td>
      <td>${esc(s.runId ?? "run")}</td>
      <td>${formatDate(s.publishedAt)}</td>
      <td>${formatScore(s.overallScore)}</td>
      <td>${esc(s.rating ?? "Unknown")}</td>
    </tr>
  `).join("");

  elProjectDetail.removeAttribute("hidden");
  elProjectDetail.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadProjects() {
  const res = await fetch("/api/runs/list");
  if (!res.ok) throw new Error("Failed to load projects");
  const data = await res.json();
  state.projects = data.runs ?? [];
  renderOverview(state.projects);
  renderProjects(state.projects);
}

async function loadProjectHistory(projectId) {
  clearError();
  if (!isValidProjectId(projectId)) {
    showError("Invalid project ID.");
    return;
  }
  const res = await fetch(`/api/runs/${encodeURIComponent(projectId)}/history`);
  if (res.status === 404) {
    showError("Project not found.");
    return;
  }
  if (!res.ok) {
    showError(`Failed to load project history (${res.status}).`);
    return;
  }
  const payload = await res.json();
  renderHistory(projectId, payload);
}

async function deleteSelectedScans() {
  clearError();
  const ids = Array.from(state.selectedScanIds);
  if (!state.selectedProject || !ids.length) {
    showError("Select at least one scan to delete.");
    return;
  }

  elConfirmDelete.disabled = true;
  try {
    const res = await fetch("/api/runs/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: state.selectedProject, scanIds: ids }),
    });
    const body = await res.json();
    if (!res.ok) {
      showError(body.error ?? "Failed to delete scans.");
      return;
    }

    elDeleteConfirm.setAttribute("hidden", "");
    await loadProjectHistory(state.selectedProject);
    await loadProjects();
  } finally {
    elConfirmDelete.disabled = false;
  }
}

async function loadApiKeys() {
  const res = await fetch("/api/keys");
  if (!res.ok) return;
  const { keys } = await res.json();
  renderKeyList(keys ?? []);
  $("db-apikeys-section").removeAttribute("hidden");
}

function renderKeyList(keys) {
  const list = $("db-keys-list");
  if (!keys.length) {
    list.innerHTML = `<li class="db-key-empty">No API keys yet. Generate one above to use with the CLI.</li>`;
    return;
  }
  list.innerHTML = keys.map((k) => `
    <li class="db-key-item">
      <span class="db-key-label">${esc(k.label)}</span>
      <span class="db-key-created">${new Date(k.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
      <button class="adm-act-btn adm-act-danger" data-key-id="${k.id}" type="button">Revoke</button>
    </li>
  `).join("");
}

async function onGenerateKey() {
  const raw = $("db-key-label").value.trim() || "default";
  const btn = $("db-gen-key");
  btn.disabled = true;
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
    $("db-new-key-value").textContent = data.key;
    $("db-new-key-banner").removeAttribute("hidden");
    $("db-key-label").value = "";
    renderKeyList(data.keys ?? []);
  } finally {
    btn.disabled = false;
  }
}

async function onRevokeKeyClick(e) {
  const btn = e.target.closest("[data-key-id]");
  if (!btn) return;
  if (!confirm("Revoke this API key? The CLI will stop working until you use a new key.")) return;
  btn.disabled = true;
  await fetch(`/api/keys/${btn.dataset.keyId}`, { method: "DELETE" });
  await loadApiKeys();
}

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
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations }, keyMaterial, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function defaultSaltForProject(projectId) {
  const bytes = new TextEncoder().encode(`gravio-api-key:${projectId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function decryptEnvelope(envelope, keyHex) {
  const payload = base64ToBytes(envelope.ciphertext ?? "");
  const iv = payload.slice(0, 12);
  const tag = payload.slice(12, 28);
  const ciphertext = payload.slice(28);
  const cipherWithTag = new Uint8Array(ciphertext.length + tag.length);
  cipherWithTag.set(ciphertext, 0);
  cipherWithTag.set(tag, ciphertext.length);
  const key = await crypto.subtle.importKey("raw", hexToBytes(keyHex), { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, cipherWithTag);
  return JSON.parse(new TextDecoder().decode(plain));
}

async function loadOptionalE2EE() {
  const projectId = String($("db-e2ee-project").value ?? "").trim();
  const apiKey = String($("db-e2ee-key").value ?? "").trim();
  if (!isValidProjectId(projectId)) {
    showError("Enter a valid project ID for E2EE load.");
    return;
  }
  if (!apiKey.startsWith("gv_")) {
    showError("Enter a valid API key for E2EE load.");
    return;
  }

  const out = $("db-e2ee-output");
  out.value = "Loading...";
  const res = await fetch(`/api/runs/${encodeURIComponent(projectId)}`);
  const body = await res.json();
  if (!res.ok) {
    out.value = JSON.stringify(body, null, 2);
    return;
  }

  if (!body?.run?.format || body.run.format !== "gravio-run-v1") {
    out.value = JSON.stringify(body.run, null, 2);
    return;
  }

  const saltHex = String(body.run?.kdf?.saltHex ?? await defaultSaltForProject(projectId)).toLowerCase();
  const iterations = Number(body.run?.kdf?.iterations ?? 210000);
  const keyHex = await deriveKeyHex(apiKey, saltHex, iterations);
  const decrypted = await decryptEnvelope(body.run, keyHex);
  out.value = JSON.stringify(decrypted, null, 2);
}

function bindEvents() {
  elProjectList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-project]");
    if (!btn) return;
    loadProjectHistory(btn.dataset.project);
  });

  elScanRows.addEventListener("change", (e) => {
    const cb = e.target.closest("input[type='checkbox'][data-scan-id]");
    if (!cb) return;
    const id = Number(cb.dataset.scanId);
    if (!Number.isInteger(id)) return;
    if (cb.checked) state.selectedScanIds.add(id);
    else state.selectedScanIds.delete(id);
    elDeleteConfirm.setAttribute("hidden", "");
  });

  elDeleteSelected.addEventListener("click", () => {
    clearError();
    if (state.selectedScanIds.size === 0) {
      showError("Select at least one scan first.");
      return;
    }
    elDeleteConfirm.removeAttribute("hidden");
  });

  elCancelDelete.addEventListener("click", () => {
    elDeleteConfirm.setAttribute("hidden", "");
  });

  elConfirmDelete.addEventListener("click", deleteSelectedScans);

  $("db-gen-key")?.addEventListener("click", onGenerateKey);
  $("db-keys-list")?.addEventListener("click", onRevokeKeyClick);

  $("db-copy-key")?.addEventListener("click", async () => {
    const val = $("db-new-key-value").textContent;
    await navigator.clipboard?.writeText(val);
    $("db-copy-key").textContent = "Copied!";
    setTimeout(() => { $("db-copy-key").textContent = "Copy"; }, 1600);
  });

  $("db-e2ee-load")?.addEventListener("click", loadOptionalE2EE);
}

async function init() {
  try {
    const me = await fetch("/api/me");
    if (!me.ok) {
      location.href = "/login?next=/dashboard";
      return;
    }
    state.user = await me.json();
    if (state.user.plan === "pro" || state.user.plan === "team" || state.user.role === "admin") {
      $("db-e2ee-section")?.removeAttribute("hidden");
    }

    bindEvents();
    await Promise.all([loadProjects(), loadApiKeys()]);
  } catch {
    location.href = "/login?next=/dashboard";
  }
}

init();
    }
