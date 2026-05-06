/**
 * dashboard.js — Gravio browser dashboard
 *
 * Loads encrypted run envelopes from the server and decrypts them in-browser.
 */

"use strict";

const $ = (id) => document.getElementById(id);

const elProjectId = $("db-project-id");
const elError = $("db-error");
const elSubmit = $("db-submit");
const elSubmitLabel = $("db-submit-label");
const elResults = $("db-results");
const elFormSection = $("form-section");

const elScoreValue = $("db-score-value");
const elPassBadge = $("db-pass-badge");
const elRunId = $("db-run-id");
const elPublishedAt = $("db-published-at");
const elWpr = $("db-wpr");
const elSafety = $("db-safety");
const elCritical = $("db-critical");
const elGates = $("db-gates");
const elDimensions = $("db-dimensions");
const elRawJson = $("db-raw-json");
const elReload = $("db-reload");

const elModeHex = $("mode-hex");
const elModePassphrase = $("mode-passphrase");
const elModeApi = $("mode-api");
const elPanelHex = $("panel-hex");
const elPanelPassphrase = $("panel-passphrase");
const elPanelApi = $("panel-api");
const elKeyHex = $("db-key-hex");
const elPassphrase = $("db-passphrase");
const elSalt = $("db-salt");
const elApiKey = $("db-api-key");

let currentUser = null;
let keyMode = "api";

const DIM_LABELS = {
  safety: "Safety",
  reliability: "Reliability",
  evaluation: "Evaluation",
  observability: "Observability",
  governance: "Governance",
};

(async () => {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) {
      location.href = "/login?next=/dashboard";
      return;
    }
    currentUser = await res.json();
    loadProjects();
    loadApiKeys();
  } catch {
    location.href = "/login?next=/dashboard";
  }
})();

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function showError(msg) {
  elError.textContent = msg;
  elError.removeAttribute("hidden");
  elSubmitLabel.textContent = "Load scorecard →";
  elSubmit.disabled = false;
}

function clearError() {
  elError.setAttribute("hidden", "");
  elError.textContent = "";
}

function setLoading(loading) {
  elSubmit.disabled = loading;
  elSubmitLabel.textContent = loading ? "Loading…" : "Load scorecard →";
}

function isValidProjectId(id) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);
}

function scoreColor(score) {
  if (score >= 90) return "var(--neon-green)";
  if (score >= 70) return "var(--neon-cyan)";
  if (score >= 50) return "var(--neon-cyan)";
  return "#ff4466";
}

function barWidth(score) {
  return Math.max(0, Math.min(100, Math.round(score))) + "%";
}

function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Invalid hex value");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
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
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: hexToBytes(saltHex),
      iterations,
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

function defaultSaltForProject(projectId) {
  const input = `gravio-api-key:${projectId}`;
  const bytes = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", bytes).then((buf) => bytesToHex(new Uint8Array(buf)));
}

async function decryptEnvelope(envelope, keyHex) {
  if (!envelope || envelope.format !== "gravio-run-v1") {
    throw new Error("Unsupported run envelope format");
  }
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error("Invalid encryption key");
  }

  const payload = base64ToBytes(envelope.ciphertext ?? "");
  if (payload.length < 28) {
    throw new Error("Encrypted payload is invalid or truncated");
  }

  const iv = payload.slice(0, 12);
  const tag = payload.slice(12, 28);
  const ciphertext = payload.slice(28);
  const cipherWithTag = new Uint8Array(ciphertext.length + tag.length);
  cipherWithTag.set(ciphertext, 0);
  cipherWithTag.set(tag, ciphertext.length);

  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(keyHex.toLowerCase()),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    cipherWithTag
  );
  const text = new TextDecoder().decode(plain);
  return JSON.parse(text);
}

function setMode(mode) {
  keyMode = mode;

  elModeHex?.classList.toggle("db-mode-active", mode === "hex");
  elModePassphrase?.classList.toggle("db-mode-active", mode === "passphrase");
  elModeApi?.classList.toggle("db-mode-active", mode === "api");

  if (elModeHex) elModeHex.setAttribute("aria-pressed", String(mode === "hex"));
  if (elModePassphrase) elModePassphrase.setAttribute("aria-pressed", String(mode === "passphrase"));
  if (elModeApi) elModeApi.setAttribute("aria-pressed", String(mode === "api"));

  elPanelHex?.classList.toggle("db-panel-hidden", mode !== "hex");
  elPanelPassphrase?.classList.toggle("db-panel-hidden", mode !== "passphrase");
  elPanelApi?.classList.toggle("db-panel-hidden", mode !== "api");
}

if (elModeHex) elModeHex.addEventListener("click", () => setMode("hex"));
if (elModePassphrase) elModePassphrase.addEventListener("click", () => setMode("passphrase"));
if (elModeApi) elModeApi.addEventListener("click", () => setMode("api"));
setMode("api");

async function resolveKeyHex(envelope, projectId) {
  if (envelope.keyMode === "raw-key" || keyMode === "hex") {
    const key = String(elKeyHex?.value ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("Enter a valid 64-character hex key");
    return key;
  }

  if (keyMode === "passphrase") {
    const pass = String(elPassphrase?.value ?? "");
    if (!pass) throw new Error("Enter your passphrase");
    const saltHex = String(elSalt?.value ?? envelope?.kdf?.saltHex ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(saltHex)) throw new Error("Enter a valid hex salt");
    const iterations = Number(envelope?.kdf?.iterations ?? 210000);
    return deriveKeyHex(pass, saltHex, iterations);
  }

  const apiKey = String(elApiKey?.value ?? "").trim();
  if (!apiKey.startsWith("gv_")) throw new Error("Enter a valid API key (gv_...)");
  const saltHex = String(envelope?.kdf?.saltHex ?? await defaultSaltForProject(projectId)).toLowerCase();
  const iterations = Number(envelope?.kdf?.iterations ?? 210000);
  return deriveKeyHex(apiKey, saltHex, iterations);
}

async function loadProjects() {
  try {
    const res = await fetch("/api/runs/list");
    if (!res.ok) return;
    const { runs } = await res.json();
    const section = $("db-projects-section");
    const list = $("db-projects-list");
    if (!runs || runs.length === 0) {
      list.innerHTML = `<li class="db-project-empty">No cloud scans yet. Run <code>node gravio.mjs --once</code> to publish your next scan.</li>`;
    } else {
      list.innerHTML = runs.map((r) => `
        <li class="db-project-item">
          <button class="db-project-btn" type="button" data-project="${esc(r.project_id)}">
            <span class="db-project-id">${esc(r.project_id)}</span>
            <span class="db-project-date">${new Date(r.published_at).toLocaleString()}</span>
          </button>
        </li>
      `).join("");
      list.onclick = (e) => {
        const btn = e.target.closest("[data-project]");
        if (!btn) return;
        loadProject(btn.dataset.project);
      };
    }
    section.removeAttribute("hidden");
  } catch {
    // supplemental section
  }
}

async function loadApiKeys() {
  try {
    const res = await fetch("/api/keys");
    if (!res.ok) return;
    const { keys } = await res.json();
    renderKeyList(keys);
    $("db-apikeys-section").removeAttribute("hidden");
  } catch {
    // supplemental section
  }
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
      <span class="db-key-created">${new Date(k.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
      <button class="adm-act-btn adm-act-danger" data-key-id="${k.id}" type="button">Revoke</button>
    </li>
  `).join("");

  list.onclick = async (e) => {
    const btn = e.target.closest("[data-key-id]");
    if (!btn) return;
    if (!confirm("Revoke this API key? The CLI will stop working until you use a new key.")) return;
    btn.disabled = true;
    await fetch(`/api/keys/${btn.dataset.keyId}`, { method: "DELETE" });
    loadApiKeys();
  };
}

$("db-gen-key")?.addEventListener("click", async () => {
  const raw = $("db-key-label").value.trim() || "default";
  const btn = $("db-gen-key");
  btn.disabled = true;
  try {
    const existingRes = await fetch("/api/keys");
    let existingLabels = new Set();
    if (existingRes.ok) {
      const { keys } = await existingRes.json();
      existingLabels = new Set((keys ?? []).map((k) => k.label));
    }

    let label = raw;
    if (existingLabels.has(label)) {
      let n = 2;
      while (existingLabels.has(`${raw} ${n}`)) n += 1;
      label = `${raw} ${n}`;
    }

    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error ?? "Failed");
      return;
    }

    const banner = $("db-new-key-banner");
    $("db-new-key-value").textContent = data.key;
    banner.removeAttribute("hidden");
    if (elApiKey && !elApiKey.value) elApiKey.value = data.key;
    $("db-key-label").value = "";
    renderKeyList(data.keys);
  } finally {
    btn.disabled = false;
  }
});

$("db-copy-key")?.addEventListener("click", () => {
  const val = $("db-new-key-value").textContent;
  navigator.clipboard?.writeText(val).then(() => {
    $("db-copy-key").textContent = "Copied!";
    setTimeout(() => {
      $("db-copy-key").textContent = "Copy";
    }, 2000);
  });
});

function renderScorecard(run, publishedAt) {
  const score = run?.summary?.overallScore ?? null;
  const runId = run?.runId ?? "unknown";
  const passed = score !== null ? score >= 87 : null;

  if (score !== null) {
    elScoreValue.textContent = Math.round(score);
    elScoreValue.style.color = scoreColor(score);
  } else {
    elScoreValue.textContent = "—";
  }

  if (passed !== null) {
    elPassBadge.textContent = passed ? "PASSED" : "FAILED";
    elPassBadge.className = "badge " + (passed ? "badge-pass" : "badge-fail");
  } else {
    elPassBadge.textContent = "";
  }

  elRunId.textContent = `Run: ${runId}`;
  elPublishedAt.textContent = publishedAt ? `Published: ${new Date(publishedAt).toLocaleString()}` : "";

  const wpr = run?.summary?.workflowPassRate ?? null;
  const safety = run?.scorecard?.safety ?? null;
  const critical = (run?.adversarialResults ?? []).filter((a) => a.status === "fail").length;

  elWpr.textContent = wpr !== null ? `${(wpr * 100).toFixed(0)}%` : "—";
  elSafety.textContent = safety !== null ? `${Math.round(safety)}` : "—";
  elCritical.textContent = `${critical}`;

  elDimensions.innerHTML = "";
  const scorecard = run?.scorecard ?? {};
  const dimKeys = ["safety", "reliability", "evaluation", "observability", "governance"];
  const hasDims = dimKeys.some((k) => scorecard[k] !== undefined);

  if (hasDims) {
    for (const key of dimKeys) {
      const val = scorecard[key];
      if (val === undefined) continue;
      const col = scoreColor(val);
      const card = document.createElement("div");
      card.className = "dim-card";
      card.innerHTML = `
        <div class="dim-name">${esc(DIM_LABELS[key] ?? key)}</div>
        <div class="dim-bar-wrap">
          <div class="dim-bar" style="width:${barWidth(val)};background:${col}"></div>
        </div>
        <div class="dim-score" style="color:${col}">${Math.round(val)}</div>
      `;
      elDimensions.appendChild(card);
    }
  } else {
    elDimensions.innerHTML = `<div class="dim-empty">No dimension scores found in this run.</div>`;
  }

  elGates.innerHTML = "";
  if (run?.limitedDetails) {
    elGates.innerHTML = `<li class="gate-empty">Upgrade to Pro or Team to unlock detailed fix guidance and remediation checks.</li>`;
    elDimensions.innerHTML = `<div class="dim-empty">Free tier shows a generic rating only.</div>`;
    elRawJson.value = JSON.stringify({ summary: run.summary, runId: run.runId, limitedDetails: true }, null, 2);
    elFormSection.style.display = "none";
    elResults.removeAttribute("hidden");
    elResults.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const checks = run?.workflowResults ?? [];
  if (checks.length > 0) {
    for (const check of checks) {
      const ok = check.status === "pass";
      const li = document.createElement("li");
      li.className = "gate-item";
      const icon = ok ? "✓" : "✗";
      const cls = ok ? "t-pass" : "t-fail";
      li.innerHTML = `
        <span class="${cls} gate-icon">${icon}</span>
        <span class="gate-name">${esc(check.id)}</span>
      `;
      elGates.appendChild(li);
    }
  } else {
    elGates.innerHTML = `<li class="gate-empty">No check data found in this run.</li>`;
  }

  elRawJson.value = JSON.stringify(run, null, 2);
  elFormSection.style.display = "none";
  elResults.removeAttribute("hidden");
  elResults.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadProject(projectId) {
  clearError();
  setLoading(true);
  elProjectId.value = projectId;

  try {
    if (!isValidProjectId(projectId)) {
      throw new Error("Invalid project ID — use letters, numbers, hyphens and underscores only");
    }

    const res = await fetch(`/api/runs/${encodeURIComponent(projectId)}`);
    if (res.status === 404) throw new Error(`No published run found for project \"${projectId}\"`);
    if (!res.ok) throw new Error(`Server error ${res.status} fetching run`);

    const body = await res.json();
    if (!body?.run) throw new Error("Server response missing run data");

    let run = body.run;
    if (run?.format === "gravio-run-v1") {
      const keyHex = await resolveKeyHex(run, projectId);
      run = await decryptEnvelope(run, keyHex);
    }

    renderScorecard(run, body.publishedAt ?? null);
  } catch (err) {
    showError(err.message ?? "An unexpected error occurred");
  } finally {
    setLoading(false);
  }
}

elSubmit?.addEventListener("click", () => {
  const projectId = elProjectId.value.trim();
  if (!projectId) {
    showError("Project ID is required");
    return;
  }
  loadProject(projectId);
});

elProjectId?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") elSubmit.click();
});

elReload?.addEventListener("click", () => {
  elResults.setAttribute("hidden", "");
  elFormSection.style.display = "";
  clearError();
  elProjectId.focus();
});
