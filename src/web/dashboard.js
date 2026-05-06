/**
 * dashboard.js — Gravio browser dashboard
 *
 * Two-view SPA:
 *   View 1 (projects): grid of project cards with score, trend, last scan
 *   View 2 (workspace): project detail with Overview / Scans / Recommendations tabs
 */

"use strict";

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  projects: [],
  selectedProject: null,
  currentTab: "overview",
  selectedScanIds: new Set(),
  currentScans: [],
  searchQuery: "",
  sortMode: "recent",
};

// ─── DOM refs (all exist from page load) ───
const elProjGrid       = $("db-projects-grid");
const elProjEmpty      = $("db-projects-empty");
const elPhError        = $("db-ph-error");
const elWsError        = $("db-ws-error");
const elScanRows       = $("db-scan-rows");
const elDeleteSelected = $("db-delete-selected");
const elDeleteConfirm  = $("db-delete-confirm");
const elConfirmDelete  = $("db-confirm-delete");
const elCancelDelete   = $("db-cancel-delete");

// ─── Utilities ───
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

function formatScore(score) {
  return Number.isFinite(score) ? String(Math.round(score)) : "—";
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.valueOf()) ? "—" : d.toLocaleString();
}

function formatDateRelative(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.valueOf())) return "—";
  const diffMs  = Date.now() - d.valueOf();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1)  return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24)  return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

function getRequestedProjectFromUrl() {
  const id = new URLSearchParams(window.location.search).get("project");
  if (!id) return null;
  return String(id).trim();
}

function setProjectInUrl(projectId) {
  const params = new URLSearchParams(window.location.search);
  params.set("project", projectId);
  window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function clearProjectFromUrl() {
  window.history.pushState(null, "", window.location.pathname);
}

function scoreColorClass(score) {
  if (!Number.isFinite(score)) return "";
  if (score >= 90) return "db-score-hi";
  if (score >= 70) return "db-score-mid";
  if (score >= 50) return "db-score-warn";
  return "db-score-lo";
}

function ratingToScoreClass(rating) {
  const r = String(rating ?? "").toLowerCase();
  if (r === "excellent" || r === "good") return "db-score-hi";
  if (r === "fair") return "db-score-mid";
  if (r === "poor" || r === "failing") return "db-score-lo";
  return "";
}

function ratingBadgeClass(rating) {
  const r = String(rating ?? "").toLowerCase();
  if (r === "excellent") return "db-rating-excellent";
  if (r === "good")      return "db-rating-good";
  if (r === "fair")      return "db-rating-fair";
  if (r === "poor")      return "db-rating-poor";
  if (r === "failing")   return "db-rating-failing";
  return "db-rating-unknown";
}

function trendBadgeHtml(direction, delta) {
  if (!direction || direction === "stable") {
    return `<span class="db-trend-badge db-trend-stable">— stable</span>`;
  }
  if (direction === "up") {
    return `<span class="db-trend-badge db-trend-up">↑ +${delta}</span>`;
  }
  return `<span class="db-trend-badge db-trend-down">↓ ${delta}</span>`;
}

function showError(el, msg) {
  el.textContent = msg;
  el.removeAttribute("hidden");
}

function clearError(el) {
  el.textContent = "";
  el.setAttribute("hidden", "");
}

// ─── Views ───
function showView(name) {
  if (name === "projects") {
    $("db-view-projects").removeAttribute("hidden");
    $("db-view-workspace").setAttribute("hidden", "");
  } else {
    $("db-view-projects").setAttribute("hidden", "");
    $("db-view-workspace").removeAttribute("hidden");
  }
}

// ─── Projects home ───
function filterAndSort(projects, query, sort) {
  let list = projects.slice();
  if (query) {
    const q = query.toLowerCase();
    list = list.filter((p) => p.project_id.toLowerCase().includes(q));
  }
  if (sort === "name") {
    list.sort((a, b) => a.project_id.localeCompare(b.project_id));
  } else if (sort === "score-asc") {
    list.sort((a, b) => Number(a.latest_score ?? -1) - Number(b.latest_score ?? -1));
  } else if (sort === "score-desc") {
    list.sort((a, b) => Number(b.latest_score ?? -1) - Number(a.latest_score ?? -1));
  } else {
    list.sort((a, b) => String(b.last_scan_at).localeCompare(String(a.last_scan_at)));
  }
  return list;
}

function renderProjectsGrid(projects) {
  const list = filterAndSort(projects, state.searchQuery, state.sortMode);

  if (!list.length) {
    elProjGrid.innerHTML = "";
    if (projects.length === 0) {
      elProjEmpty.removeAttribute("hidden");
    } else {
      elProjGrid.innerHTML = `<p style="color:var(--text-3);font-size:14px">No projects match your search.</p>`;
      elProjEmpty.setAttribute("hidden", "");
    }
    return;
  }

  elProjEmpty.setAttribute("hidden", "");

  elProjGrid.innerHTML = list.map((p) => {
    const rating       = p.latest_rating ?? "Unknown";
    const rawScore     = Number(p.latest_score);
    const score        = Number.isFinite(rawScore) ? Math.round(rawScore) : null;
    const scoreDisplay = score !== null ? String(score) : "—";
    const colorClass   = score !== null ? scoreColorClass(score) : ratingToScoreClass(rating);
    const isAlert      = ["poor", "failing"].includes(String(rating).toLowerCase());
    const scanCount    = Number(p.scan_count ?? 0);

    return `
      <button class="db-proj-card${isAlert ? " db-proj-card-alert" : ""}" type="button" data-project="${esc(p.project_id)}">
        <div class="db-proj-card-top">
          <span class="db-proj-card-name">${esc(p.project_id)}</span>
          <span class="db-rating-badge ${esc(ratingBadgeClass(rating))}">${esc(rating)}</span>
        </div>
        <div class="db-proj-card-score-row">
          <span class="db-proj-card-score ${esc(colorClass)}">${esc(scoreDisplay)}</span>
          ${score !== null ? `<span class="db-proj-card-score-denom">/100</span>` : ""}
        </div>
        <div class="db-proj-card-meta">
          <span>${scanCount} scan${scanCount === 1 ? "" : "s"}</span>
          <span class="db-proj-meta-sep">·</span>
          <span>${formatDateRelative(p.last_scan_at)}</span>
        </div>
      </button>
    `;
  }).join("");

  // Always append the "Add project" card at the end
  elProjGrid.insertAdjacentHTML("beforeend", `
    <a class="db-proj-card db-proj-card-new" href="/onboarding" aria-label="Add a new project">
      <span class="db-proj-card-new-icon" aria-hidden="true">+</span>
      <span class="db-proj-card-new-label">Add project</span>
      <span class="db-proj-card-new-sub">Set up the CLI in a new folder</span>
    </a>
  `);
}

// ─── Workspace tabs ───
function switchTab(tabName) {
  state.currentTab = tabName;
  document.querySelectorAll(".db-tab").forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle("db-tab-active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".db-tab-panel").forEach((panel) => {
    if (panel.id === `db-tab-${tabName}`) {
      panel.removeAttribute("hidden");
    } else {
      panel.setAttribute("hidden", "");
    }
  });
}

// ─── Workspace rendering ───
function renderWorkspace(projectId, payload) {
  const stats   = payload?.stats ?? {};
  const scans   = payload?.scans ?? [];
  const limited = Boolean(payload?.limitedDetails);

  state.selectedProject = projectId;
  state.currentScans    = scans;
  state.selectedScanIds.clear();

  // Hero
  $("db-ws-project-name").textContent = projectId;
  const scanCount = stats.totalScans ?? scans.length ?? 0;
  $("db-ws-scan-count").textContent = `${scanCount} scan${scanCount === 1 ? "" : "s"}`;

  const latest = scans[0];
  $("db-ws-last-scan").textContent = latest
    ? `last scan ${formatDateRelative(latest.publishedAt)}`
    : "no scans yet";

  const latestScore = latest?.overallScore;
  const scoreEl = $("db-ws-score");
  scoreEl.textContent = formatScore(latestScore);
  scoreEl.className = `db-ws-score-value ${scoreColorClass(latestScore ?? 0)}`;

  const ratingStr = latest?.rating ?? "Unknown";
  $("db-ws-badges").innerHTML =
    trendBadgeHtml(stats.trendDirection, stats.trendDelta) +
    ` <span class="db-rating-badge ${ratingBadgeClass(ratingStr)}">${esc(ratingStr)}</span>`;

  // Overview tab
  $("db-ov-total").textContent = String(scanCount);
  $("db-ov-best").textContent  = formatScore(stats.bestScore);
  $("db-ov-avg").textContent   = formatScore(stats.averageScore);

  if (!latest) {
    $("db-ov-summary").innerHTML = `<p style="color:var(--text-3);font-size:14px">No scans found for this project yet.</p>`;
    $("db-ov-recent").innerHTML  = "";
  } else {
    const scoreText  = Number.isFinite(latest.overallScore)
      ? `Latest score: <strong>${Math.round(latest.overallScore)}</strong> (${esc(latest.rating)}).`
      : `Latest rating: <strong>${esc(latest.rating)}</strong>.`;
    const limitedText = limited ? " Detailed remediation is available on Pro/Team." : "";
    $("db-ov-summary").innerHTML = `
      <div class="db-ov-summary-box">
        <p class="db-ov-summary-text">${scoreText}${limitedText}</p>
      </div>`;

    const recent = scans.slice(0, 5);
    $("db-ov-recent").innerHTML = `
      <p class="db-subtitle" style="margin-top:24px">Recent scans</p>
      <div class="db-scan-table-wrap">
        <table class="db-scan-table">
          <thead><tr><th>Run</th><th>Published</th><th>Score</th><th>Rating</th></tr></thead>
          <tbody>
            ${recent.map((s) => `
              <tr>
                <td style="font-family:var(--font-mono);font-size:12px">${esc(s.runId ?? "run")}</td>
                <td>${formatDateRelative(s.publishedAt)}</td>
                <td class="${scoreColorClass(s.overallScore ?? 0)}">${formatScore(s.overallScore)}</td>
                <td><span class="db-rating-badge ${ratingBadgeClass(s.rating)}">${esc(s.rating ?? "Unknown")}</span></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  renderWorkspaceScans(scans);
  renderWorkspaceRecs(scans);
  renderWorkspaceRunScans(projectId, scans.length > 0);
  switchTab("overview");
  showView("workspace");
}

function renderWorkspaceScans(scans) {
  state.selectedScanIds.clear();
  elDeleteConfirm.setAttribute("hidden", "");

  if (!scans.length) {
    elScanRows.innerHTML = `<tr><td colspan="5" style="color:var(--text-3);padding:16px">No scans found.</td></tr>`;
    return;
  }

  elScanRows.innerHTML = scans.map((s) => `
    <tr>
      <td><input type="checkbox" data-scan-id="${s.id}" /></td>
      <td style="font-family:var(--font-mono);font-size:12px">${esc(s.runId ?? "run")}</td>
      <td title="${esc(formatDate(s.publishedAt))}">${formatDateRelative(s.publishedAt)}</td>
      <td class="${scoreColorClass(s.overallScore ?? 0)}">${formatScore(s.overallScore)}</td>
      <td><span class="db-rating-badge ${ratingBadgeClass(s.rating)}">${esc(s.rating ?? "Unknown")}</span></td>
    </tr>`).join("");
}

function renderWorkspaceRunScans(projectId, hasScans) {
  const panel = $("db-tab-runscans");
  const pid   = esc(projectId);
  const mergeOptions = state.projects
    .filter((p) => p.project_id !== projectId)
    .map((p) => `<option value="${esc(p.project_id)}">${esc(p.project_id)}</option>`)
    .join("");

  const statusHtml = hasScans
    ? `<div class="db-runscans-status db-runscans-ok">
         <span class="db-auth-badge db-auth-badge-ok">&#10003; Auth completed</span>
         <p class="db-runscans-status-text">This project has been scanned before. On a new machine or folder? Re-run Step&nbsp;2 to re-authorize.</p>
       </div>`
    : `<div class="db-runscans-status db-runscans-warn">
         <span class="db-auth-badge db-auth-badge-warn">&#9888; No scans yet</span>
         <p class="db-runscans-status-text">Complete the steps below to authorize and publish your first scan.</p>
       </div>`;

  panel.innerHTML = `
    <div class="db-runscans">
      ${statusHtml}

      <!-- ─ Primary flow ─ -->
      <div class="db-runscans-steps">

        <div class="db-runscans-step">
          <div class="db-runscans-step-num">1</div>
          <div class="db-runscans-step-body">
            <h3 class="db-runscans-h3">Download the CLI</h3>
            <p class="db-runscans-p">Save <code>gravio.mjs</code> to your project folder if you don&#39;t have it already.</p>
            <p class="db-runscans-platform">Windows (PowerShell)</p>
            <div class="db-runscans-cmd-row">
              <pre class="db-runscans-cmd" id="rs-cmd-dl-win">Invoke-WebRequest https://gravio.dev/cli/gravio.mjs -OutFile gravio.mjs</pre>
              <button class="m-btn m-btn-outline m-btn-sm db-rs-copy" data-copy-id="rs-cmd-dl-win" type="button">Copy</button>
            </div>
            <p class="db-runscans-platform">macOS / Linux</p>
            <div class="db-runscans-cmd-row">
              <pre class="db-runscans-cmd" id="rs-cmd-dl-mac">curl -fsSL https://gravio.dev/cli/gravio.mjs -o gravio.mjs</pre>
              <button class="m-btn m-btn-outline m-btn-sm db-rs-copy" data-copy-id="rs-cmd-dl-mac" type="button">Copy</button>
            </div>
          </div>
        </div>

        <div class="db-runscans-step">
          <div class="db-runscans-step-num">2</div>
          <div class="db-runscans-step-body">
            <h3 class="db-runscans-h3">First-time connect &amp; scan</h3>
            <p class="db-runscans-p">Auto-runs setup, auth, link, scan, and publish in one command.</p>
            <div class="db-runscans-cmd-row">
              <pre class="db-runscans-cmd" id="rs-cmd-auth">node gravio.mjs --token YOUR_API_KEY</pre>
              <button class="m-btn m-btn-outline m-btn-sm db-rs-copy" data-copy-id="rs-cmd-auth" type="button">Copy</button>
            </div>
            <p class="db-runscans-foot">Need your key? <a href="/settings" class="db-runscans-link">Settings &#8594;</a></p>
          </div>
        </div>

        <div class="db-runscans-step">
          <div class="db-runscans-step-num">3</div>
          <div class="db-runscans-step-body">
            <h3 class="db-runscans-h3">Subsequent scans</h3>
            <p class="db-runscans-p">From the same folder — auth and link are already saved.</p>
            <div class="db-runscans-cmd-row">
              <pre class="db-runscans-cmd" id="rs-cmd-scan">node gravio.mjs</pre>
              <button class="m-btn m-btn-outline m-btn-sm db-rs-copy" data-copy-id="rs-cmd-scan" type="button">Copy</button>
            </div>
          </div>
        </div>

      </div>

      <!-- ─ Advanced commands ─ -->
      <div class="db-cmd-ref">
        <p class="db-cmd-ref-heading">Advanced commands</p>
        <p class="db-runscans-p" style="margin-bottom:14px">Run these from the folder containing <code>gravio.mjs</code>. Use <code>node gravio.mjs --help</code> to see this list in your terminal.</p>

        <div class="db-cmd-ref-list">

          <div class="db-cmd-ref-item">
            <div class="db-cmd-ref-meta">
              <span class="db-cmd-ref-name">doctor</span>
              <span class="db-cmd-ref-purpose">Show setup / auth / link status and repair suggestions.</span>
            </div>
            <div class="db-runscans-cmd-row">
              <pre class="db-runscans-cmd" id="rs-cmd-doctor">node gravio.mjs doctor</pre>
              <button class="m-btn m-btn-outline m-btn-sm db-rs-copy" data-copy-id="rs-cmd-doctor" type="button">Copy</button>
            </div>
          </div>

          <div class="db-cmd-ref-item">
            <div class="db-cmd-ref-meta">
              <span class="db-cmd-ref-name">link</span>
              <span class="db-cmd-ref-purpose">Relink this folder to an existing project if the local link file was removed.</span>
            </div>
            <div class="db-runscans-cmd-row">
              <pre class="db-runscans-cmd" id="rs-cmd-link">node gravio.mjs link --project ${pid}</pre>
              <button class="m-btn m-btn-outline m-btn-sm db-rs-copy" data-copy-id="rs-cmd-link" type="button">Copy</button>
            </div>
          </div>

          <div class="db-cmd-ref-item">
            <div class="db-cmd-ref-meta">
              <span class="db-cmd-ref-name">rename</span>
              <span class="db-cmd-ref-purpose">Rename the current linked project. Or use the form below.</span>
            </div>
            <div class="db-runscans-cmd-row">
              <pre class="db-runscans-cmd" id="rs-cmd-rename">node gravio.mjs rename &lt;new-name&gt;</pre>
              <button class="m-btn m-btn-outline m-btn-sm db-rs-copy" data-copy-id="rs-cmd-rename" type="button">Copy</button>
            </div>
          </div>

          <div class="db-cmd-ref-item">
            <div class="db-cmd-ref-meta">
              <span class="db-cmd-ref-name">merge</span>
              <span class="db-cmd-ref-purpose">Guided merge helper. Best finalized using the controls below.</span>
            </div>
            <div class="db-runscans-cmd-row">
              <pre class="db-runscans-cmd" id="rs-cmd-merge">node gravio.mjs merge --to &lt;destination-id&gt;</pre>
              <button class="m-btn m-btn-outline m-btn-sm db-rs-copy" data-copy-id="rs-cmd-merge" type="button">Copy</button>
            </div>
          </div>

          <div class="db-cmd-ref-item">
            <div class="db-cmd-ref-meta">
              <span class="db-cmd-ref-name">logout</span>
              <span class="db-cmd-ref-purpose">Clear local auth and project link from this folder.</span>
            </div>
            <div class="db-runscans-cmd-row">
              <pre class="db-runscans-cmd" id="rs-cmd-logout">node gravio.mjs logout</pre>
              <button class="m-btn m-btn-outline m-btn-sm db-rs-copy" data-copy-id="rs-cmd-logout" type="button">Copy</button>
            </div>
          </div>

        </div>
      </div>

      <!-- ─ Project management ─ -->
      <div class="db-cmd-ref" style="margin-top:32px">
        <p class="db-cmd-ref-heading">Project management</p>

        <div class="db-runscans-p" style="margin-bottom:6px">Rename project: <code>${pid}</code></div>
        <div class="db-runscans-cmd-row" style="margin-bottom:18px">
          <input id="rs-rename-input" class="db-search-input" type="text" value="${pid}" autocomplete="off" spellcheck="false" />
          <button class="m-btn m-btn-outline m-btn-sm" id="rs-rename-btn" type="button">Rename</button>
        </div>

        <div class="db-runscans-p" style="margin-bottom:6px">Merge <code>${pid}</code> into another project (moves all scans):</div>
        <div class="db-runscans-cmd-row">
          <select id="rs-merge-to" class="db-sort-select" ${mergeOptions ? "" : "disabled"}>
            <option value="">Choose destination project</option>
            ${mergeOptions}
          </select>
          <button class="m-btn m-btn-outline m-btn-sm" id="rs-merge-btn" type="button" ${mergeOptions ? "" : "disabled"}>Merge</button>
        </div>
        ${mergeOptions ? "" : `<p class="db-runscans-foot">You need at least two projects to use merge.</p>`}
      </div>

    </div>
  `;
}

async function renameCurrentProject(newProjectId) {
  const fromProjectId = state.selectedProject;
  const toProjectId = String(newProjectId ?? "").trim();
  clearError(elWsError);
  if (!fromProjectId || !isValidProjectId(toProjectId)) {
    showError(elWsError, "Enter a valid project id.");
    return;
  }
  if (fromProjectId === toProjectId) {
    showError(elWsError, "Project id is unchanged.");
    return;
  }

  const res = await fetch("/api/projects/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromProjectId, toProjectId }),
  });
  const body = await res.json();
  if (!res.ok) {
    showError(elWsError, body.error ?? "Rename failed.");
    return;
  }

  await loadProjects();
  await openProject(toProjectId);
  switchTab("runscans");
}

async function mergeCurrentProject(destinationProjectId) {
  const sourceProjectId = state.selectedProject;
  const to = String(destinationProjectId ?? "").trim();
  clearError(elWsError);
  if (!sourceProjectId || !isValidProjectId(to)) {
    showError(elWsError, "Choose a valid destination project.");
    return;
  }
  if (sourceProjectId === to) {
    showError(elWsError, "Choose a different destination project.");
    return;
  }

  const res = await fetch("/api/projects/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceProjectId, destinationProjectId: to }),
  });
  const body = await res.json();
  if (!res.ok) {
    showError(elWsError, body.error ?? "Merge failed.");
    return;
  }

  await loadProjects();
  await openProject(to);
  switchTab("runscans");
}

function renderWorkspaceRecs(scans) {
  const recList = $("db-recs-list");
  const latest = scans[0];
  const recs = latest?.recommendations;

  if (!latest || !recs) {
    recList.innerHTML = `<li class="db-recs-empty">No recommendations at this time. Keep scanning regularly to maintain trend visibility.</li>`;
    return;
  }

  if (recs && typeof recs === "object" && !Array.isArray(recs) && Number(recs.version) >= 2) {
    const quickActions = Array.isArray(recs.quickActions) ? recs.quickActions : [];
    const actionPlan = Array.isArray(recs.actionPlan) ? recs.actionPlan : [];
    const dimensionPlan = Array.isArray(recs.dimensionPlan) ? recs.dimensionPlan : [];
    const readyChecklist = Array.isArray(recs.readyChecklist) ? recs.readyChecklist : [];

    const priorityClass = (priority) => {
      const p = String(priority ?? "").toLowerCase();
      if (p === "critical") return "db-priority-critical";
      if (p === "high") return "db-priority-high";
      if (p === "medium") return "db-priority-medium";
      return "db-priority-low";
    };

    const statusClass = (status) => {
      const s = String(status ?? "").toLowerCase();
      if (s === "ready") return "db-dim-ready";
      if (s === "near") return "db-dim-near";
      if (s === "at-risk") return "db-dim-risk";
      return "db-dim-critical";
    };

    recList.innerHTML = `
      <li class="db-rec-hero">
        <p class="db-rec-hero-title">${esc(recs.headline ?? "Remediation plan")}</p>
        <p class="db-rec-hero-text">${esc(recs.summary ?? "")}</p>
      </li>
      ${quickActions.length ? `
        <li class="db-rec-block">
          <p class="db-rec-block-title">Quick wins</p>
          <ul class="db-rec-bullets">
            ${quickActions.map((item) => `<li>${esc(item)}</li>`).join("")}
          </ul>
        </li>` : ""}
      ${actionPlan.length ? `
        <li class="db-rec-block">
          <p class="db-rec-block-title">Priority actions</p>
          <div class="db-rec-action-grid">
            ${actionPlan.map((item) => `
              <article class="db-rec-action-card">
                <div class="db-rec-action-head">
                  <span class="db-priority-chip ${priorityClass(item.priority)}">${esc(item.priority ?? "medium")}</span>
                  <span class="db-rec-dim-chip">${esc(item.dimension ?? "general")}</span>
                </div>
                <p class="db-rec-action-title">${esc(item.title ?? "Recommended action")}</p>
                <p class="db-rec-action-why">${esc(item.why ?? "")}</p>
                ${Array.isArray(item.actions) && item.actions.length ? `
                  <ul class="db-rec-bullets">
                    ${item.actions.map((step) => `<li>${esc(step)}</li>`).join("")}
                  </ul>` : ""}
                ${Array.isArray(item.commands) && item.commands.length ? `
                  <div class="db-rec-cmds">
                    ${item.commands.map((cmd) => `<code>${esc(cmd)}</code>`).join("")}
                  </div>` : ""}
              </article>`).join("")}
          </div>
        </li>` : ""}
      ${dimensionPlan.length ? `
        <li class="db-rec-block">
          <p class="db-rec-block-title">Dimension roadmap</p>
          <div class="db-dim-grid">
            ${dimensionPlan.map((dim) => `
              <article class="db-dim-card">
                <div class="db-dim-head">
                  <span class="db-dim-name">${esc(dim.label ?? dim.dimension ?? "Dimension")}</span>
                  <span class="db-dim-status ${statusClass(dim.status)}">${esc(dim.status ?? "at-risk")}</span>
                </div>
                <p class="db-dim-scores">${esc(String(dim.current ?? "—"))}/100 -> target ${esc(String(dim.target ?? "—"))}</p>
                <p class="db-dim-summary">${esc(dim.summary ?? "")}</p>
              </article>`).join("")}
          </div>
        </li>` : ""}
      ${readyChecklist.length ? `
        <li class="db-rec-block">
          <p class="db-rec-block-title">Ready-to-ship checklist</p>
          <ul class="db-ready-list">
            ${readyChecklist.map((item) => `
              <li class="${item.passed ? "db-ready-pass" : "db-ready-fail"}">
                <span class="db-ready-icon" aria-hidden="true">${item.passed ? "✓" : "!"}</span>
                <span class="db-ready-label">${esc(item.label ?? "Gate")}</span>
                <span class="db-ready-score">${esc(String(item.current ?? "—"))}/${esc(String(item.target ?? "—"))}</span>
              </li>`).join("")}
          </ul>
        </li>` : ""}
    `;
    return;
  }

  const recMap = new Map();
  for (const s of scans.slice(0, 10)) {
    for (const r of (s.recommendations ?? [])) {
      const key = String(r);
      recMap.set(key, (recMap.get(key) ?? 0) + 1);
    }
  }

  if (!recMap.size) {
    recList.innerHTML = `<li class="db-recs-empty">No recommendations at this time. Keep scanning regularly to maintain trend visibility.</li>`;
    return;
  }

  const sorted = [...recMap.entries()].sort((a, b) => b[1] - a[1]);
  recList.innerHTML = sorted.map(([rec, count]) => `
    <li class="db-rec-item">
      <span class="db-rec-text">${esc(rec)}</span>
      ${count > 1 ? `<span class="db-rec-freq">seen in ${count} scans</span>` : ""}
    </li>`).join("");
}

// ─── Data loaders ───
async function loadProjects() {
  const res = await fetch("/api/runs/list");
  if (!res.ok) throw new Error("Failed to load projects");
  const data = await res.json();
  state.projects = data.runs ?? [];
  renderProjectsGrid(state.projects);
}

async function openProject(projectId) {
  clearError(elWsError);
  clearError(elPhError);
  if (!isValidProjectId(projectId)) {
    showError(elPhError, "Invalid project ID.");
    return;
  }
  const res = await fetch(`/api/runs/${encodeURIComponent(projectId)}/history`);
  if (res.status === 404) {
    showError(elPhError, `Project not found: ${projectId}`);
    return;
  }
  if (!res.ok) {
    showError(elPhError, `Failed to load project (${res.status}).`);
    return;
  }
  const payload = await res.json();
  renderWorkspace(projectId, payload);
  setProjectInUrl(projectId);
}

async function deleteSelectedScans() {
  clearError(elWsError);
  const ids = Array.from(state.selectedScanIds);
  if (!state.selectedProject || !ids.length) {
    showError(elWsError, "Select at least one scan to delete.");
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
      showError(elWsError, body.error ?? "Failed to delete scans.");
      return;
    }
    elDeleteConfirm.setAttribute("hidden", "");
    await openProject(state.selectedProject);
  } finally {
    elConfirmDelete.disabled = false;
  }
}

// ─── Events ───
function bindEvents() {
  elProjGrid.addEventListener("click", (e) => {
    const card = e.target.closest("[data-project]");
    if (!card) return;
    openProject(card.dataset.project);
  });

  $("db-back-btn").addEventListener("click", () => {
    state.selectedProject = null;
    clearProjectFromUrl();
    showView("projects");
  });

  document.querySelectorAll(".db-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  $("db-search").addEventListener("input", (e) => {
    state.searchQuery = e.target.value.trim();
    renderProjectsGrid(state.projects);
  });

  $("db-sort").addEventListener("change", (e) => {
    state.sortMode = e.target.value;
    renderProjectsGrid(state.projects);
  });

  elScanRows.addEventListener("change", (e) => {
    const cb = e.target.closest("input[type='checkbox'][data-scan-id]");
    if (!cb) return;
    const id = Number(cb.dataset.scanId);
    if (!Number.isInteger(id)) return;
    if (cb.checked) state.selectedScanIds.add(id);
    else state.selectedScanIds.delete(id);
    elDeleteConfirm.setAttribute("hidden", "");
    const n = state.selectedScanIds.size;
    elDeleteSelected.textContent = n > 0 ? `Delete selected (${n})` : "Delete selected";
  });

  elDeleteSelected.addEventListener("click", () => {
    clearError(elWsError);
    if (state.selectedScanIds.size === 0) {
      showError(elWsError, "Select at least one scan first.");
      return;
    }
    elDeleteConfirm.removeAttribute("hidden");
  });

  elCancelDelete.addEventListener("click", () => {
    elDeleteConfirm.setAttribute("hidden", "");
  });

  elConfirmDelete.addEventListener("click", deleteSelectedScans);

  // Copy buttons in the Run Scans tab (panel persists; content is re-rendered per project)
  $("db-tab-runscans").addEventListener("click", (e) => {
    const renameBtn = e.target.closest("#rs-rename-btn");
    if (renameBtn) {
      const val = $("rs-rename-input")?.value ?? "";
      renameCurrentProject(val);
      return;
    }

    const mergeBtn = e.target.closest("#rs-merge-btn");
    if (mergeBtn) {
      if (mergeBtn.dataset.confirming !== "true") {
        mergeBtn.dataset.confirming = "true";
        mergeBtn.textContent = "Confirm merge";
        setTimeout(() => {
          if (mergeBtn.dataset.confirming === "true") {
            delete mergeBtn.dataset.confirming;
            mergeBtn.textContent = "Merge into destination";
          }
        }, 4000);
        return;
      }

      delete mergeBtn.dataset.confirming;
      mergeBtn.textContent = "Merge into destination";
      const to = $("rs-merge-to")?.value ?? "";
      mergeCurrentProject(to);
      return;
    }

    const btn = e.target.closest(".db-rs-copy");
    if (!btn) return;
    const pre = document.getElementById(btn.dataset.copyId);
    if (!pre) return;
    navigator.clipboard?.writeText(pre.textContent).catch(() => {});
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1600);
  });

  window.addEventListener("popstate", () => {
    const projectId = getRequestedProjectFromUrl();
    if (projectId) {
      openProject(projectId);
    } else {
      showView("projects");
    }
  });
}

// ─── Init ───
async function init() {
  try {
    const me = await fetch("/api/me");
    if (!me.ok) {
      location.href = "/login?next=/dashboard";
      return;
    }
    state.user = await me.json();
    bindEvents();
    await loadProjects();

    const requestedProject = getRequestedProjectFromUrl();
    if (requestedProject) {
      const hasProject = state.projects.some((p) => p.project_id === requestedProject);
      if (hasProject) {
        await openProject(requestedProject);
      } else {
        showError(elPhError, `Project not found: ${requestedProject}`);
      }
      return;
    }

    if (state.projects.length === 1) {
      await openProject(state.projects[0].project_id);
    }
  } catch {
    location.href = "/login?next=/dashboard";
  }
}

init();
