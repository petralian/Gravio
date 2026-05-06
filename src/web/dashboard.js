/**
 * dashboard.js — Gravio browser dashboard
 *
 * Loads scorecard run data from the server (auth-gated).
 * Rendering happens in the browser from the JSON payload.
 */

"use strict";

const $ = (id) => document.getElementById(id);

const elProjectId    = $("db-project-id");

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
      list.innerHTML = `<li class="db-project-empty">No runs published yet. Run <code>node gravio.mjs --once --publish ...</code> to see your projects here.</li>`;
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
        // Auto-load the project on click
        loadProject(btn.dataset.project);
      });
    }
    section.removeAttribute("hidden");
  } catch { /* silently ignore — projects section is supplemental */ }
}

function esc(str) {

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

/* ─── helpers ─── */

function isValidProjectId(id) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── UI state helpers ─── */

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

/* ─── Score rendering ─── */

const DIM_LABELS = {
  safety:        "Safety",
  reliability:   "Reliability",
  evaluation:    "Evaluation",
  observability: "Observability",
  governance:    "Governance",
};

function scoreColor(score) {
  if (score >= 90) return "var(--neon-green)";
  if (score >= 70) return "var(--neon-cyan)";
  if (score >= 50) return "var(--neon-cyan)";
  return "#ff4466";
}

function barWidth(score) {
  return Math.max(0, Math.min(100, Math.round(score))) + "%";
}

/**
 * Render the scorecard section from a run object.
 * @param {object} run
 * @param {string|null} publishedAt
 */
function renderScorecard(run, publishedAt) {
  /* ── score banner ── */
  const score  = run?.summary?.overallScore ?? null;
  const runId  = run?.runId ?? "unknown";
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

  /* ── top metrics ── */
  const wpr      = run?.summary?.workflowPassRate ?? null;
  const safety   = run?.scorecard?.safety ?? null;
  const critical = (run?.adversarialResults ?? []).filter((a) => a.status === "fail").length;

  elWpr.textContent      = wpr !== null ? `${(wpr * 100).toFixed(0)}%` : "—";
  elSafety.textContent   = safety !== null ? `${Math.round(safety)}` : "—";
  elCritical.textContent = `${critical}`;

  /* ── dimensions as score bars ── */
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
        <div class="dim-name">${escapeHtml(DIM_LABELS[key] ?? key)}</div>
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

  /* ── checks (workflowResults or gate list) ── */
  elGates.innerHTML = "";
  const checks = run?.workflowResults ?? [];
  if (checks.length > 0) {
    for (const check of checks) {
      const passed = check.status === "pass";
      const li = document.createElement("li");
      li.className = "gate-item";
      const icon = passed ? "✓" : "✗";
      const cls  = passed ? "t-pass" : "t-fail";
      li.innerHTML = `
        <span class="${cls} gate-icon">${icon}</span>
        <span class="gate-name">${escapeHtml(check.id)}</span>
      `;
      elGates.appendChild(li);
    }
  } else {
    elGates.innerHTML = `<li class="gate-empty">No check data found in this run.</li>`;
  }

  /* ── raw JSON ── */
  elRawJson.value = JSON.stringify(run, null, 2);

  /* ── show results, hide form ── */
  elFormSection.style.display = "none";
  elResults.removeAttribute("hidden");
  elResults.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ─── Load project by ID ─── */

async function loadProject(projectId) {
  clearError();
  setLoading(true);
  elProjectId.value = projectId;

  try {
    if (!isValidProjectId(projectId)) throw new Error("Invalid project ID — use letters, numbers, hyphens and underscores only");

    const res = await fetch(`/api/runs/${encodeURIComponent(projectId)}`);
    if (res.status === 404) throw new Error(`No published run found for project "${projectId}"`);
    if (!res.ok) throw new Error(`Server error ${res.status} fetching run`);

    const body = await res.json();
    if (!body?.run) throw new Error("Server response missing run data");

    renderScorecard(body.run, body.publishedAt ?? null);
  } catch (err) {
    showError(err.message ?? "An unexpected error occurred");
  } finally {
    setLoading(false);
  }
}

/* ─── Form submit ─── */

elSubmit.addEventListener("click", () => {
  const projectId = elProjectId.value.trim();
  if (!projectId) { showError("Project ID is required"); return; }
  loadProject(projectId);
});

elProjectId.addEventListener("keydown", (e) => {
  if (e.key === "Enter") elSubmit.click();
});

/* ─── Reload button ─── */

elReload.addEventListener("click", () => {
  elResults.setAttribute("hidden", "");
  elFormSection.style.display = "";
  clearError();
  elProjectId.focus();
});
