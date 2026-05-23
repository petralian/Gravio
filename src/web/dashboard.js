/**
 * dashboard.js — Gravio browser dashboard
 *
 * Two-view SPA:
 *   View 1 (projects): grid of project cards with score, trend, last scan
 *   View 2 (workspace): project detail with Overview / Scans / Recommendations tabs
 */

"use strict";

const $ = (id) => document.getElementById(id);

// ─── E2EE Decryption (Web Crypto API) ───
/** Derive key from API key using Web Crypto API (PBKDF2-SHA256). */
async function deriveKeyForDecryption(apiKey, saltHex) {
  const encoder = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(apiKey),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const keyBits = await window.crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 210000 },
    keyMaterial,
    256
  );
  return await window.crypto.subtle.importKey("raw", keyBits, "AES-GCM", false, ["decrypt"]);
}

/** Decrypt AES-256-GCM ciphertext. Expects: IV (12) + tag (16) + ciphertext (var). */
async function decryptAES256GCM(keyOrHex, combinedBase64) {
  try {
    const combined = Uint8Array.from(atob(combinedBase64), (c) => c.charCodeAt(0));
    if (combined.length < 12 + 16) throw new Error("Payload too short");
    const iv = combined.subarray(0, 12);
    const tag = combined.subarray(12, 28);
    const ciphertext = combined.subarray(28);

    let key = keyOrHex;
    // If string (64-char hex), convert to CryptoKey
    if (typeof keyOrHex === "string") {
      const keyBuf = new Uint8Array(keyOrHex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
      key = await window.crypto.subtle.importKey("raw", keyBuf, "AES-GCM", false, ["decrypt"]);
    }

    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      Buffer.concat([ciphertext, tag])
    );
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    throw new Error(`Decryption failed: ${err.message}`);
  }
}

/** Try to decrypt run envelope with saved E2EE keys. */
async function tryDecryptRun(envelope) {
  if (!envelope?.ciphertext || !envelope?.keyMode) return null;

  try {
    const keys = getE2EEKeys();
    for (const savedKey of keys) {
      try {
        let key = savedKey.key;
        if (envelope.keyMode === "api-key" && envelope.kdf?.saltHex) {
          key = await deriveKeyForDecryption(savedKey.key, envelope.kdf.saltHex);
        }
        const plaintext = await decryptAES256GCM(key, envelope.ciphertext);
        return JSON.parse(plaintext);
      } catch {
        // Try next key
      }
    }
  } catch (err) {
    console.warn("E2EE decryption error:", err);
  }
  return null;
}

function getE2EEKeys() {
  try {
    return Array.isArray(JSON.parse(localStorage.getItem("gravio_e2ee_keys") || "[]"))
      ? JSON.parse(localStorage.getItem("gravio_e2ee_keys") || "[]")
      : [];
  } catch {
    return [];
  }
}

/**
 * Auto-decrypt scans if they're encrypted envelopes and we have saved keys.
 * Returns the processed scans (decrypted or original).
 */
async function processScansForDecryption(scans) {
  if (!Array.isArray(scans) || scans.length === 0) return scans;

  const processed = [];
  for (const scan of scans) {
    // Check if this scan is an encrypted envelope
    if (scan?.ciphertext && scan?.keyMode) {
      try {
        const decrypted = await tryDecryptRun(scan);
        if (decrypted) {
          // Use decrypted data but preserve server-metadata
          processed.push({ ...decrypted, id: scan.id, publishedAt: scan.publishedAt });
        } else {
          // Decryption failed; use publicSummary if available
          processed.push(scan);
        }
      } catch (err) {
        console.warn(`Failed to decrypt scan ${scan.id}:`, err);
        processed.push(scan);
      }
    } else {
      // Not encrypted, pass through
      processed.push(scan);
    }
  }
  return processed;
}

const state = {
  user: null,
  projects: [],
  selectedProject: null,
  currentTab: "overview",
  selectedScanIds: new Set(),
  currentScans: [],
  selectedScanId: null,
  compareScanId: null,
  filterFrom: "",
  filterTo: "",
  scanDimFilter: "all",
  searchQuery: "",
  sortMode: "recent",
  cliToken: null,
};

// ─── DOM refs (all exist from page load) ───
const elProjGrid       = $("db-projects-grid");
const elProjEmpty      = $("db-projects-empty");
const elPhError        = $("db-ph-error");
const elWsError        = $("db-ws-error");
const elScanRows       = $("db-scan-rows");
const elOverviewInsights = $("db-ov-insights");
const elDeleteSelected = $("db-delete-selected");
const elDeleteConfirm  = $("db-delete-confirm");
const elConfirmDelete  = $("db-confirm-delete");
const elCancelDelete   = $("db-cancel-delete");
const elExportScans       = $("db-export-scans");
const elExportReport      = $("db-export-report");
const elExportReportHtml  = $("db-export-report-html");
const elScanDimFilter     = $("db-scan-dim-filter");
const elFilterFrom        = $("db-filter-from");
const elFilterTo          = $("db-filter-to");
const elFilterClear       = $("db-filter-clear");
const elScanDetail     = $("db-scan-detail");
const elScanDetailTitle = $("db-scan-detail-title");
const elScanDetailMeta = $("db-scan-detail-meta");
const elScanCompareSelect = $("db-scan-compare-select");
const elScanOverall = $("db-scan-overall");
const elScanToc = $("db-scan-toc");
const elScanMoscow = $("db-scan-moscow");
const elScanPassing = $("db-scan-passing");
const elScanNa = $("db-scan-na");
const elScanAssumptions = $("db-scan-assumptions");
const elScanRecList = $("db-scan-rec-list");
const elScanChecklistSummary = $("db-scan-checklist-summary");
const elScanChecklistList = $("db-scan-checklist-list");
const elScanNote = $("db-scan-note");
const elScanActions = $("db-scan-actions");
const elSaveScanContext = $("db-save-scan-context");
const elScanContextStatus = $("db-scan-context-status");

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

function getRequestedTabFromUrl() {
  const tab = new URLSearchParams(window.location.search).get("tab");
  const valid = ["overview", "scans", "runscans"];
  return valid.includes(tab) ? tab : null;
}

function setProjectInUrl(projectId, tabName = null) {
  const params = new URLSearchParams(window.location.search);
  params.set("project", projectId);
  if (tabName) params.set("tab", tabName);
  window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function setTabInUrl(tabName) {
  const params = new URLSearchParams(window.location.search);
  params.set("tab", tabName);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
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

function gateBadgeHtml(gateStatus) {
  if (!gateStatus) {
    return `<span class="db-gate-badge db-gate-none">—</span>`;
  }
  if (gateStatus.passed) {
    return `<span class="db-gate-badge db-gate-pass">✓ Pass</span>`;
  }
  const breachCount = (gateStatus.breaches ?? []).length;
  return `<span class="db-gate-badge db-gate-fail">✗ ${breachCount} breach${breachCount === 1 ? "" : "es"}</span>`;
}

function regressionBadgeHtml(regression) {
  if (!regression || regression.reason === "No baseline") {
    return `<span class="db-regression-badge db-regression-none">—</span>`;
  }
  if (regression.hasRegression) {
    return `<span class="db-regression-badge db-regression-down">↓ ${Math.abs(regression.delta).toFixed(1)}pt</span>`;
  }
  if (regression.delta > 0) {
    return `<span class="db-regression-badge db-regression-up">↑ +${regression.delta.toFixed(1)}pt</span>`;
  }
  return `<span class="db-regression-badge db-regression-none">— stable</span>`;
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

function getScanById(scanId) {
  return state.currentScans.find((s) => Number(s.id) === Number(scanId)) ?? null;
}

function scanRecommendations(scan) {
  const recs = scan?.recommendations;
  if (recs && typeof recs === "object" && !Array.isArray(recs) && Number(recs.version) >= 2) {
    const fromActions = Array.isArray(recs.actionPlan)
      ? recs.actionPlan.map((item) => item?.title).filter(Boolean)
      : [];
    const fromQuick = Array.isArray(recs.quickActions) ? recs.quickActions.filter(Boolean) : [];
    const merged = [...fromActions, ...fromQuick];
    return merged.slice(0, 8);
  }
  if (Array.isArray(recs)) return recs.slice(0, 8);
  return [];
}

function scanChecklist(scan) {
  const recs = scan?.recommendations;
  if (recs && typeof recs === "object" && !Array.isArray(recs) && Number(recs.version) >= 2 && Array.isArray(recs.readyChecklist)) {
    return recs.readyChecklist.map((item) => ({
      id: String(item?.id ?? item?.label ?? "item"),
      label: String(item?.label ?? "Checklist item"),
      passed: Boolean(item?.passed),
    }));
  }
  return [];
}

const DIM_ORDER = ["safety", "reliability", "evaluation", "observability", "governance", "agentic"];
const DIM_META = {
  safety: { label: "Safety", target: 90 },
  reliability: { label: "Reliability", target: 85 },
  evaluation: { label: "Evaluation", target: 85 },
  observability: { label: "Observability", target: 80 },
  governance: { label: "Governance", target: 80 },
  agentic: { label: "Agentic", target: 80 },
};

function toDimLabel(dim) {
  return DIM_META[dim]?.label ?? String(dim ?? "");
}

function normalizePriority(priority) {
  const p = String(priority ?? "").toLowerCase();
  if (p === "critical" || p === "high" || p === "medium" || p === "low") return p;
  return "medium";
}

function progressBarHtml(value) {
  if (!Number.isFinite(value)) {
    return `<div class="db-inline-bar"><div class="db-inline-fill" style="width:0%"></div></div><span class="db-inline-score">n/a</span>`;
  }
  const score = Math.max(0, Math.min(100, Math.round(value)));
  return `<div class="db-inline-bar"><div class="db-inline-fill" style="width:${score}%"></div></div><span class="db-inline-score">${score}</span>`;
}

function scanDimensionPlan(scan) {
  const recs = scan?.recommendations;
  if (recs && typeof recs === "object" && !Array.isArray(recs) && Array.isArray(recs.dimensionPlan)) {
    return recs.dimensionPlan;
  }
  return [];
}

function scanActionPlan(scan) {
  const recs = scan?.recommendations;
  if (recs && typeof recs === "object" && !Array.isArray(recs) && Array.isArray(recs.actionPlan)) {
    return recs.actionPlan;
  }
  return [];
}

function scanAssumptions(scan) {
  const assumptions = [
    "Analysis is based on this selected scan snapshot, not live unscanned code.",
    "Priority and score-impact estimates are directional and should be validated after fixes.",
    "Dimension targets follow Gravio ready-to-ship thresholds for this project type.",
  ];
  if (scan?.limitedDetails) {
    assumptions.push("Your current plan tier limits remediation depth; upgrade for complete playbooks.");
  }
  return assumptions;
}

function buildScanMarkdownReport({ projectId, scan, dimFilter }) {
  const actions = scanActionPlan(scan)
    .filter((item) => dimFilter === "all" || item.dimension === dimFilter);
  const dimensions = scanDimensionPlan(scan)
    .filter((item) => dimFilter === "all" || item.dimension === dimFilter);
  const checklist = scanChecklist(scan);
  const passing = checklist.filter((item) => item.passed);
  const naDimensions = dimensions.filter((d) => d.current === null || d.current === undefined);
  const byPriority = {
    critical: actions.filter((a) => normalizePriority(a.priority) === "critical"),
    high: actions.filter((a) => normalizePriority(a.priority) === "high"),
    medium: actions.filter((a) => normalizePriority(a.priority) === "medium"),
    low: actions.filter((a) => normalizePriority(a.priority) === "low"),
  };

  const lines = [];
  lines.push(`# Gravio Deep Scan Report — ${projectId}`);
  lines.push("");
  lines.push(`- Run: ${scan.runId ?? "run"}`);
  lines.push(`- Published: ${scan.publishedAt ?? "unknown"}`);
  lines.push(`- Overall score: ${formatScore(scan.overallScore)}/100 (${scan.rating ?? "Unknown"})`);
  lines.push(`- Dimension filter: ${dimFilter === "all" ? "All dimensions" : toDimLabel(dimFilter)}`);
  lines.push("");
  lines.push("## Table of contents");
  lines.push("- [Overall score summary](#overall-score-summary)");
  lines.push("- [Dimension score table](#dimension-score-table)");
  lines.push("- [MoSCoW priorities](#moscow-priorities)");
  lines.push("- [Passing checks summary](#passing-checks-summary)");
  lines.push("- [Not applicable](#not-applicable)");
  lines.push("- [Assumptions](#assumptions)");
  lines.push("");
  lines.push("## Overall score summary");
  lines.push(`- Current score: ${formatScore(scan.overallScore)}/100`);
  lines.push(`- Rating: ${scan.rating ?? "Unknown"}`);
  lines.push("");
  lines.push("## Dimension score table");
  lines.push("| Dimension | Score | Target | Gap |");
  lines.push("|---|---:|---:|---:|");
  for (const dim of dimensions) {
    const cur = Number.isFinite(dim.current) ? Math.round(dim.current) : null;
    const target = Number.isFinite(dim.target) ? Math.round(dim.target) : (DIM_META[dim.dimension]?.target ?? 80);
    const gap = cur === null ? "n/a" : Math.max(0, target - cur);
    lines.push(`| ${toDimLabel(dim.dimension)} | ${cur === null ? "n/a" : cur} | ${target} | ${gap} |`);
  }
  lines.push("");
  lines.push("## MoSCoW priorities");
  lines.push("");
  const tiers = [
    ["Must Have", byPriority.critical],
    ["Should Have", byPriority.high],
    ["Could Have", byPriority.medium],
    ["Won't Fix (now)", byPriority.low],
  ];
  for (const [label, items] of tiers) {
    lines.push(`### ${label}`);
    if (!items.length) {
      lines.push("- None");
      lines.push("");
      continue;
    }
    for (const item of items) {
      lines.push(`#### ${item.title ?? "Recommended action"}`);
      lines.push(`- Dimension: ${toDimLabel(item.dimension)}`);
      lines.push(`- Effort: ${item.effort ?? "unknown"}`);
      lines.push(`- Score impact: ${item.impact ?? item.expectedLift ?? "unknown"}`);
      lines.push(`- Why: ${item.why ?? ""}`);
      if (item.how) lines.push(`- How: ${item.how}`);
      const actionSteps = Array.isArray(item.actions) ? item.actions : [];
      for (const step of actionSteps) lines.push(`  - ${step}`);
      lines.push("");
    }
  }
  lines.push("## Passing checks summary");
  if (!passing.length) {
    lines.push("- No passing checks reported in this scan.");
  } else {
    for (const pass of passing) {
      lines.push(`- ${pass.label}`);
    }
  }
  lines.push("");
  lines.push("## Not applicable");
  if (!naDimensions.length) {
    lines.push("- No N/A dimensions for this filtered view.");
  } else {
    for (const item of naDimensions) {
      lines.push(`- ${toDimLabel(item.dimension)} marked as N/A for this project context.`);
    }
  }
  lines.push("");
  lines.push("## Assumptions");
  for (const item of scanAssumptions(scan)) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildScanHtmlReport({ projectId, scan, dimFilter }) {
  const markdown = buildScanMarkdownReport({ projectId, scan, dimFilter })
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gravio Deep Scan Report</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:980px;margin:0 auto;padding:32px;line-height:1.55;color:#0f172a}pre{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px}</style></head><body><pre>${markdown}</pre></body></html>`;
}

function downloadTextFile(fileName, text, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
}

function renderDeepScanSections(scan) {
  const dimFilter = state.scanDimFilter;
  const recs = scan?.recommendations;
  const dimensions = scanDimensionPlan(scan)
    .filter((item) => dimFilter === "all" || item.dimension === dimFilter);
  const actions = scanActionPlan(scan)
    .filter((item) => dimFilter === "all" || item.dimension === dimFilter);
  const checklist = scanChecklist(scan);
  const passing = checklist.filter((item) => item.passed);
  const naDimensions = dimensions.filter((item) => item.current === null || item.current === undefined);

  const tier = {
    critical: actions.filter((item) => normalizePriority(item.priority) === "critical"),
    high: actions.filter((item) => normalizePriority(item.priority) === "high"),
    medium: actions.filter((item) => normalizePriority(item.priority) === "medium"),
    low: actions.filter((item) => normalizePriority(item.priority) === "low"),
  };

  elScanOverall.innerHTML = `
    <p class="db-scan-detail-card-title">Overall score summary and dimensions</p>
    <p class="db-scan-overall-line">Score <strong>${formatScore(scan.overallScore)}/100</strong> · Rating <strong>${esc(scan.rating ?? "Unknown")}</strong> · Filter <strong>${esc(dimFilter === "all" ? "All dimensions" : toDimLabel(dimFilter))}</strong></p>
    ${dimensions.length ? `
      <table class="db-scan-dim-table">
        <thead><tr><th>Dimension</th><th>Progress</th><th>Target</th><th>Gap</th></tr></thead>
        <tbody>
          ${dimensions.map((item) => {
            const current = Number.isFinite(item.current) ? Math.round(item.current) : null;
            const target = Number.isFinite(item.target) ? Math.round(item.target) : (DIM_META[item.dimension]?.target ?? 80);
            const gap = current === null ? "n/a" : String(Math.max(0, target - current));
            return `<tr>
              <td>${esc(toDimLabel(item.dimension))}</td>
              <td>${progressBarHtml(current)}</td>
              <td>${target}</td>
              <td>${gap}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>` : `<p class="db-scan-rec-empty">No dimension plan data available for this scan.</p>`}
  `;

  elScanToc.innerHTML = `
    <p class="db-scan-detail-card-title">Table of contents</p>
    <nav class="db-scan-toc-list">
      <a href="#db-sec-moscow">MoSCoW priorities</a>
      <a href="#db-sec-passing">Passing checks summary</a>
      <a href="#db-sec-na">N/A section</a>
      <a href="#db-sec-assumptions">Assumptions</a>
    </nav>
  `;

  const renderTier = (label, cssClass, items) => `
    <div class="db-moscow-tier">
      <p class="db-moscow-tier-title ${cssClass}">${label}</p>
      ${items.length ? items.map((item) => `
        <article class="db-moscow-card">
          <div class="db-rec-action-head">
            <span class="db-priority-chip db-priority-${normalizePriority(item.priority)}">${esc(normalizePriority(item.priority))}</span>
            <span class="db-rec-dim-chip">${esc(toDimLabel(item.dimension))}</span>
            ${item.effort ? `<span class="db-effort-chip db-effort-${esc(item.effort)}">effort: ${esc(item.effort)}</span>` : ""}
            ${item.impact ? `<span class="db-impact-chip db-impact-${esc(item.impact)}">impact: ${esc(item.impact)}</span>` : ""}
          </div>
          <p class="db-rec-action-title">${esc(item.title ?? "Recommended action")}</p>
          ${item.why ? `<p class="db-rec-action-why">${esc(item.why)}</p>` : ""}
          ${item.how ? `<p class="db-rec-action-how">${esc(item.how)}</p>` : ""}
          ${Array.isArray(item.actions) && item.actions.length ? `<ul class="db-rec-bullets">${item.actions.map((step) => `<li>${esc(step)}</li>`).join("")}</ul>` : ""}
          ${Array.isArray(item.commands) && item.commands.length ? `<div class="db-rec-cmds">${item.commands.map((cmd) => `<code>${esc(cmd)}</code>`).join("")}</div>` : ""}
          ${item.fixPrompt ? `<button class="db-copy-prompt-btn" data-prompt="${esc(item.fixPrompt)}" type="button">Copy fix prompt for AI tool</button>` : ""}
        </article>`).join("") : `<p class="db-scan-rec-empty">No items in this tier for the selected filter.</p>`}
    </div>
  `;

  elScanMoscow.innerHTML = `
    <div id="db-sec-moscow"></div>
    <p class="db-scan-detail-card-title">MoSCoW priorities</p>
    ${renderTier("Must Have", "db-moscow-critical", tier.critical)}
    ${renderTier("Should Have", "db-moscow-high", tier.high)}
    ${renderTier("Could Have", "db-moscow-medium", tier.medium)}
    ${renderTier("Won't Fix (now)", "db-moscow-low", tier.low)}
  `;

  elScanPassing.innerHTML = `
    <div id="db-sec-passing"></div>
    <p class="db-scan-detail-card-title">Passing checks summary</p>
    ${passing.length ? `<ul class="db-scan-rec-list">${passing.map((item) => `<li>${esc(item.label)}</li>`).join("")}</ul>` : `<p class="db-scan-rec-empty">No passing checks reported in this scan.</p>`}
  `;

  elScanNa.innerHTML = `
    <div id="db-sec-na"></div>
    <p class="db-scan-detail-card-title">Not applicable</p>
    ${naDimensions.length ? `<ul class="db-scan-rec-list">${naDimensions.map((item) => `<li>${esc(toDimLabel(item.dimension))} is marked as N/A for this project context.</li>`).join("")}</ul>` : `<p class="db-scan-rec-empty">No N/A dimensions in this filtered view.</p>`}
  `;

  const assumptions = scanAssumptions(scan);
  elScanAssumptions.innerHTML = `
    <div id="db-sec-assumptions"></div>
    <p class="db-scan-detail-card-title">Assumptions</p>
    <ul class="db-scan-rec-list">${assumptions.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
  `;

  if (!recs || Number(recs.version) < 2) {
    elScanMoscow.innerHTML = `<p class="db-scan-detail-card-title">MoSCoW priorities</p><p class="db-scan-rec-empty">Detailed MoSCoW data is not available for this scan.</p>`;
  }
}

function setScanContextStatus(message, isError = false) {
  elScanContextStatus.textContent = message;
  elScanContextStatus.classList.toggle("db-scan-context-status-error", isError);
}

function buildCompareOptions(selectedScan) {
  const options = [`<option value="">Previous scan</option>`];
  for (const scan of state.currentScans) {
    if (Number(scan.id) === Number(selectedScan?.id)) continue;
    options.push(`<option value="${scan.id}">${esc(scan.runId ?? "run")} · ${formatDateRelative(scan.publishedAt)}</option>`);
  }
  elScanCompareSelect.innerHTML = options.join("");
}

function renderSelectedScanDetails() {
  const selected = getScanById(state.selectedScanId);
  if (!selected) {
    elScanDetail.setAttribute("hidden", "");
    return;
  }

  elScanDetail.removeAttribute("hidden");
  elScanDetailTitle.textContent = `Scan ${selected.runId ?? "run"}`;
  elScanDetailMeta.textContent = `${formatDateRelative(selected.publishedAt)} · score ${formatScore(selected.overallScore)} · ${selected.rating ?? "Unknown"}`;

  const recs = scanRecommendations(selected);
  if (recs.length === 0) {
    elScanRecList.innerHTML = `<li class="db-scan-rec-empty">No explicit recommendations for this scan.</li>`;
  } else {
    elScanRecList.innerHTML = recs.map((item) => `<li>${esc(item)}</li>`).join("");
  }

  buildCompareOptions(selected);
  let compare = getScanById(state.compareScanId);
  if (!compare) {
    const selectedIdx = state.currentScans.findIndex((s) => Number(s.id) === Number(selected.id));
    compare = state.currentScans[selectedIdx + 1] ?? null;
    state.compareScanId = compare?.id ?? null;
  }
  if (state.compareScanId) {
    elScanCompareSelect.value = String(state.compareScanId);
  } else {
    elScanCompareSelect.value = "";
  }

  const currentChecklist = scanChecklist(selected);
  const compareChecklist = scanChecklist(compare);
  const compareMap = new Map(compareChecklist.map((item) => [item.id, item.passed]));
  const completed = currentChecklist.filter((item) => item.passed).length;
  const newlyDone = currentChecklist.filter((item) => item.passed && compareMap.get(item.id) === false).map((item) => item.label);
  const compareLabel = compare ? `vs ${compare.runId ?? "previous"}` : "(no baseline selected)";
  elScanChecklistSummary.textContent = `${completed}/${currentChecklist.length || 0} checklist items complete ${compareLabel}`;

  if (currentChecklist.length === 0) {
    elScanChecklistList.innerHTML = `<li class="db-scan-checklist-empty">Checklist data not available for this scan tier.</li>`;
  } else {
    elScanChecklistList.innerHTML = currentChecklist.map((item) => {
      const wasPassed = compareMap.get(item.id) === true;
      const justDone = item.passed && !wasPassed;
      return `<li class="${item.passed ? "db-scan-check-pass" : "db-scan-check-fail"}">
        <span>${item.passed ? "✓" : "!"}</span>
        <span>${esc(item.label)}</span>
        <span>${justDone ? "new" : (item.passed ? "done" : "open")}</span>
      </li>`;
    }).join("");
  }

  renderDeepScanSections(selected);

  elScanNote.value = String(selected.context?.note ?? "");
  elScanActions.value = Array.isArray(selected.context?.actions) ? selected.context.actions.join("\n") : "";
  setScanContextStatus(selected.context?.updatedAt ? `Saved ${formatDateRelative(selected.context.updatedAt)}` : "", false);
}

function selectScan(scanId) {
  state.selectedScanId = Number(scanId);
  state.compareScanId = null;
  renderWorkspaceScans(state.currentScans);
  renderSelectedScanDetails();
}

async function saveSelectedScanContext() {
  const scan = getScanById(state.selectedScanId);
  if (!scan || !state.selectedProject) {
    setScanContextStatus("Select a scan first.", true);
    return;
  }

  const actions = String(elScanActions.value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);

  elSaveScanContext.disabled = true;
  const prevLabel = elSaveScanContext.textContent;
  elSaveScanContext.textContent = "Loading…";
  setScanContextStatus("");

  try {
    const res = await fetch("/api/scans/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scanId: scan.id,
        projectId: state.selectedProject,
        note: String(elScanNote.value ?? ""),
        actions,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      setScanContextStatus(body.error ?? "Failed to save context.", true);
      return;
    }
    scan.context = body.context ?? { note: "", actions: [], updatedAt: null };
    setScanContextStatus("Saved.", false);
    renderSelectedScanDetails();
  } catch {
    setScanContextStatus("Failed to save context.", true);
  } finally {
    elSaveScanContext.disabled = false;
    elSaveScanContext.textContent = prevLabel;
  }
}

async function triggerDownload(url, fallbackName) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const cd = String(res.headers.get("Content-Disposition") ?? "");
  const fileMatch = /filename=\"([^\"]+)\"/.exec(cd);
  const fileName = fileMatch?.[1] ?? fallbackName;
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
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
function switchTab(tabName, updateUrl = true) {
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
  if (updateUrl) {
    setTabInUrl(tabName);
  }
}

// ─── Workspace rendering ───
function renderWorkspace(projectId, payload) {
  const stats   = payload?.stats ?? {};
  const scans   = payload?.scans ?? [];
  const limited = Boolean(payload?.limitedDetails);

  state.selectedProject = projectId;
  state.currentScans    = scans;
  state.selectedScanIds.clear();
  state.selectedScanId = scans[0]?.id ?? null;
  state.compareScanId = null;
  state.scanDimFilter = "all";
  if (elScanDimFilter) elScanDimFilter.value = "all";

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
  renderSelectedScanDetails();
  
  // Check for requested tab from URL
  const requestedTab = getRequestedTabFromUrl();
  const initialTab = requestedTab || "overview";
  switchTab(initialTab, false);
  
  showView("workspace");
}

function getFilteredScans() {
  const from = state.filterFrom ? new Date(state.filterFrom + "T00:00:00Z") : null;
  const to   = state.filterTo   ? new Date(state.filterTo   + "T23:59:59Z") : null;
  if (!from && !to) return state.currentScans;
  return state.currentScans.filter((s) => {
    if (!s.publishedAt) return true;
    const dt = new Date(s.publishedAt);
    if (from && dt < from) return false;
    if (to   && dt > to)   return false;
    return true;
  });
}

function renderWorkspaceScans(scans) {
  state.selectedScanIds.clear();
  elDeleteConfirm.setAttribute("hidden", "");
  elDeleteSelected.textContent = "Delete selected";

  // Apply date filter
  const visible = scans === state.currentScans ? getFilteredScans() : scans;

  if (!visible.length) {
    elScanRows.innerHTML = `<tr><td colspan="8" style="color:var(--text-3);padding:16px">${
      state.filterFrom || state.filterTo ? "No scans in selected date range." : "No scans found."
    }</td></tr>`;
    return;
  }

  elScanRows.innerHTML = visible.map((s) => `
    <tr class="${Number(s.id) === Number(state.selectedScanId) ? "db-scan-row-active" : ""}">
      <td><input type="checkbox" data-scan-id="${s.id}" /></td>
      <td style="font-family:var(--font-mono);font-size:12px">${esc(s.runId ?? "run")}</td>
      <td title="${esc(formatDate(s.publishedAt))}">${formatDateRelative(s.publishedAt)}</td>
      <td class="${scoreColorClass(s.overallScore ?? 0)}">${formatScore(s.overallScore)}</td>
      <td><span class="db-rating-badge ${ratingBadgeClass(s.rating)}">${esc(s.rating ?? "Unknown")}</span></td>
      <td>${gateBadgeHtml(s.gateStatus)}</td>
      <td>${regressionBadgeHtml(s.regression)}</td>
      <td><button class="m-btn m-btn-outline m-btn-sm db-scan-view-btn" data-view-scan-id="${s.id}" type="button">View</button></td>
    </tr>`).join("");
}

function renderWorkspaceRunScans(projectId, hasScans) {
  const panel = $("db-tab-runscans");
  const pid   = esc(projectId);
  const token = state.cliToken ?? null;
  const tokenCmd = token
    ? `$env:GRAVIO_TOKEN='${token}'; node gravio.mjs`
    : `$env:GRAVIO_TOKEN='YOUR_API_KEY'; node gravio.mjs`;
  const tokenFoot = token
    ? `<p class="db-runscans-foot">Token auto-filled from your session.</p>`
    : `<p class="db-runscans-foot">Need your token? <a href="/settings" class="db-runscans-link">Settings &#8594;</a></p>`;

  const mergeOptions = state.projects
    .filter((p) => p.project_id !== projectId)
    .map((p) => `<option value="${esc(p.project_id)}">${esc(p.project_id)}</option>`)
    .join("");

  const primarySection = hasScans
    ? `<!-- Already scanned: just run again -->
       <div class="db-runscans-primary">
         <h3 class="db-runscans-h3">Run another scan</h3>
         <p class="db-runscans-p">From the folder where <code>gravio.mjs</code> lives. Auth is already saved.</p>
         <div class="db-runscans-cmd-row">
           <pre class="db-runscans-cmd" id="rs-cmd-scan">node gravio.mjs</pre>
           <button class="m-btn m-btn-outline m-btn-sm db-rs-copy" data-copy-id="rs-cmd-scan" type="button">Copy</button>
         </div>
       </div>

       <details class="db-runscans-details db-runscans-details-new-machine">
         <summary class="db-runscans-details-summary"><span class="db-runscans-details-badge">New machine or folder?</span></summary>
         <div class="db-runscans-steps">
           <div class="db-runscans-step">
             <div class="db-runscans-step-num">1</div>
             <div class="db-runscans-step-body">
               <h3 class="db-runscans-h3">Download the CLI</h3>
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
               <h3 class="db-runscans-h3">Connect &amp; scan</h3>
               <p class="db-runscans-p">One command — handles setup, auth, link to this project, and scan.</p>
               <div class="db-runscans-cmd-row">
                 <pre class="db-runscans-cmd" id="rs-cmd-auth">${tokenCmd}</pre>
                 <button class="m-btn m-btn-outline m-btn-sm db-rs-copy" data-copy-id="rs-cmd-auth" type="button">Copy</button>
               </div>
               ${tokenFoot}
             </div>
           </div>
         </div>
       </details>`
    : `<!-- No scans yet: first-time setup -->
       <div class="db-runscans-status db-runscans-warn">
         <span class="db-auth-badge db-auth-badge-warn">&#9888; No scans yet</span>
         <p class="db-runscans-status-text">Run the commands below to publish your first scan for this project.</p>
       </div>
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
             <h3 class="db-runscans-h3">Connect &amp; scan</h3>
             <p class="db-runscans-p">One command — handles setup, auth, links this folder to project <code>${pid}</code>, and runs your first scan.</p>
             <div class="db-runscans-cmd-row">
               <pre class="db-runscans-cmd" id="rs-cmd-auth">${tokenCmd}</pre>
               <button class="m-btn m-btn-outline m-btn-sm db-rs-copy" data-copy-id="rs-cmd-auth" type="button">Copy</button>
             </div>
             ${tokenFoot}
           </div>
         </div>
       </div>`;

  panel.innerHTML = `
    <div class="db-runscans">
      ${primarySection}

      <!-- ─ Advanced commands ─ -->
      <details class="db-cmd-ref-details">
        <summary class="db-cmd-ref-summary"><span class="db-cmd-ref-badge">Advanced commands</span></summary>
        <div class="db-cmd-ref">
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
      </details>

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

// ─── Score History Chart ─────────────────────────────────────────────────────

async function loadAndRenderScoreChart(projectId) {
  const el = $("db-ov-chart");
  if (!el) return;
  el.innerHTML = "";
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/score-history`);
    if (!res.ok) return;
    const { history } = await res.json();
    renderScoreChart(el, history);
  } catch {
    // Non-fatal: chart is enhancement only
  }
}

function renderScoreChart(container, history) {
  if (!Array.isArray(history) || history.length < 2) {
    container.innerHTML = `<p class="db-chart-empty">Not enough scan history to display a trend chart. Run at least 2 scans.</p>`;
    return;
  }

  const W = 640, H = 180, PAD = { top: 16, right: 20, bottom: 36, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const scores = history.map((r) => Number(r.overallScore));
  const minScore = Math.max(0, Math.min(...scores) - 5);
  const maxScore = Math.min(100, Math.max(...scores) + 5);
  const yRange = maxScore - minScore || 10;

  const xScale = (i) => PAD.left + (i / (history.length - 1)) * plotW;
  const yScale = (v) => PAD.top + plotH - ((v - minScore) / yRange) * plotH;

  const gridVals = [25, 50, 75, 100].filter((v) => v >= minScore - 5 && v <= maxScore + 5);

  const gridLines = gridVals.map((v) => {
    const y = yScale(v);
    return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}" class="db-chart-grid"/>
            <text x="${PAD.left - 6}" y="${(y + 4).toFixed(1)}" class="db-chart-label db-chart-label-y">${v}</text>`;
  }).join("");

  const points = history.map((r, i) => `${xScale(i).toFixed(1)},${yScale(Number(r.overallScore)).toFixed(1)}`).join(" ");

  const firstX = xScale(0).toFixed(1), lastX = xScale(history.length - 1).toFixed(1);
  const bottomY = (PAD.top + plotH).toFixed(1);
  const fillPoints = `${firstX},${bottomY} ${points} ${lastX},${bottomY}`;

  const labelIdxs = history.length <= 6
    ? history.map((_, i) => i)
    : [0, ...Array.from({ length: 4 }, (_, k) => Math.round((k + 1) * (history.length - 1) / 5)), history.length - 1];
  const uniqueLabelIdxs = [...new Set(labelIdxs)];

  const xLabels = uniqueLabelIdxs.map((i) => {
    const d = new Date(history[i].scannedAt);
    const label = Number.isNaN(d.valueOf()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`;
    return `<text x="${xScale(i).toFixed(1)}" y="${(H - 8).toFixed(1)}" class="db-chart-label db-chart-label-x">${label}</text>`;
  }).join("");

  const circles = history.map((r, i) => {
    const cx = xScale(i).toFixed(1), cy = yScale(Number(r.overallScore)).toFixed(1);
    const d = new Date(r.scannedAt);
    const dateStr = Number.isNaN(d.valueOf()) ? "" : d.toLocaleDateString();
    const commit = r.gitCommit;
    const tip = `Score: ${Math.round(r.overallScore)}${commit ? " · " + commit.slice(0, 7) : ""} · ${dateStr}`;
    return `<circle cx="${cx}" cy="${cy}" r="4" class="db-chart-dot"><title>${esc(tip)}</title></circle>`;
  }).join("");

  container.innerHTML = `
    <p class="db-subtitle" style="margin-bottom:8px">Score trend</p>
    <div class="db-chart-svg-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="db-chart-svg" role="img" aria-label="Score history chart">
        ${gridLines}
        <polygon points="${fillPoints}" class="db-chart-fill"/>
        <polyline points="${points}" class="db-chart-line"/>
        ${circles}
        ${xLabels}
      </svg>
    </div>`;
}

function renderWorkspaceRecs(scans) {
  const recList = elOverviewInsights;
  if (!recList) return;
  const latest = scans[0];
  const recs = latest?.recommendations;

  if (!latest || !recs) {
    recList.innerHTML = `<li class="db-recs-empty">No recommendations at this time. Keep scanning regularly to maintain trend visibility.</li>`;
    return;
  }

  if (recs && typeof recs === "object" && !Array.isArray(recs) && Number(recs.version) >= 2) {
    const statusClass = (status) => {
      const s = String(status ?? "").toLowerCase();
      if (s === "ready") return "db-dim-ready";
      if (s === "near") return "db-dim-near";
      if (s === "at-risk") return "db-dim-risk";
      return "db-dim-critical";
    };

    // ── Limited (free) tier: show per-dimension teasers + upgrade CTA ──
    if (recs.tier === "limited") {
      const dimPreviews = Array.isArray(recs.dimPreviews) ? recs.dimPreviews : [];
      recList.innerHTML = `
        <li class="db-rec-hero db-rec-hero-limited">
          <p class="db-rec-hero-title">${esc(recs.headline ?? "Upgrade for full remediation")}</p>
          <p class="db-rec-hero-text">${esc(recs.summary ?? "")}</p>
        </li>
        ${dimPreviews.length ? `
          <li class="db-rec-block">
            <p class="db-rec-block-title">Dimension snapshot</p>
            <div class="db-dim-preview-grid">
              ${dimPreviews.map((dim) => `
                <article class="db-dim-preview-card">
                  <div class="db-dim-head">
                    <span class="db-dim-name">${esc(dim.label ?? dim.dimension)}</span>
                    <span class="db-dim-status ${statusClass(dim.status)}">${esc(dim.status ?? "unknown")}</span>
                  </div>
                  <p class="db-dim-preview-score">${dim.current !== null ? `${dim.current}/100` : "—"}</p>
                  <p class="db-dim-preview-action">${esc(dim.topAction)}</p>
                  <span class="db-dim-preview-lock" aria-label="Full guidance requires upgrade">Full plan locked</span>
                </article>`).join("")}
            </div>
          </li>` : ""}
        <li class="db-rec-block db-rec-upgrade-cta">
          <div class="db-upgrade-box">
            <p class="db-upgrade-title">Unlock full remediation guidance</p>
            <p class="db-upgrade-body">Pro and Team plans include per-dimension action plans, priority rankings, fix commands, and a ready-to-ship checklist.</p>
            <a href="/settings" class="m-btn m-btn-neon m-btn-sm">View upgrade options →</a>
          </div>
        </li>
      `;
      return;
    }

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
                  ${item.effort ? `<span class="db-effort-chip db-effort-${esc(item.effort)}">effort: ${esc(item.effort)}</span>` : ""}
                  ${item.impact ? `<span class="db-impact-chip db-impact-${esc(item.impact)}">impact: ${esc(item.impact)}</span>` : ""}
                </div>
                <p class="db-rec-action-title">${esc(item.title ?? "Recommended action")}</p>
                <p class="db-rec-action-why">${esc(item.why ?? "")}</p>
                ${item.how ? `<p class="db-rec-action-how">${esc(item.how)}</p>` : ""}
                ${Array.isArray(item.actions) && item.actions.length ? `
                  <ul class="db-rec-bullets">
                    ${item.actions.map((step) => `<li>${esc(step)}</li>`).join("")}
                  </ul>` : ""}
                ${Array.isArray(item.commands) && item.commands.length ? `
                  <div class="db-rec-cmds">
                    ${item.commands.map((cmd) => `<code>${esc(cmd)}</code>`).join("")}
                  </div>` : ""}
                ${item.fixPrompt ? `
                  <button class="db-copy-prompt-btn" data-prompt="${esc(item.fixPrompt)}" type="button">Copy fix prompt</button>` : ""}
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

// ─── CLI token ───
async function fetchCliToken() {
  try {
    const res = await fetch("/api/keys/onboarding", { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json();
    return (typeof data?.key === "string") ? data.key : null;
  } catch {
    return null;
  }
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
  
  // Auto-decrypt any encrypted scans with saved keys
  if (Array.isArray(payload.scans)) {
    payload.scans = await processScansForDecryption(payload.scans);
  }
  
  renderWorkspace(projectId, payload);
  setProjectInUrl(projectId);
  loadAndRenderScoreChart(projectId);
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

  // Prompt pack: copy fix prompt to clipboard
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".db-copy-prompt-btn");
    if (!btn) return;
    const prompt = btn.dataset.prompt ?? "";
    navigator.clipboard.writeText(prompt).then(() => {
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      btn.disabled = true;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
    }).catch(() => {
      btn.textContent = "Copy failed";
      setTimeout(() => { btn.textContent = "Copy fix prompt"; }, 2000);
    });
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

  elScanRows.addEventListener("click", (e) => {
    const viewBtn = e.target.closest("[data-view-scan-id]");
    if (viewBtn) {
      selectScan(Number(viewBtn.dataset.viewScanId));
      return;
    }

    if (e.target.closest("input[type='checkbox']")) return;
    const row = e.target.closest("tr");
    if (!row) return;
    const btn = row.querySelector("[data-view-scan-id]");
    if (!btn) return;
    selectScan(Number(btn.dataset.viewScanId));
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

  elScanCompareSelect.addEventListener("change", (e) => {
    const val = Number(e.target.value);
    state.compareScanId = Number.isInteger(val) && val > 0 ? val : null;
    renderSelectedScanDetails();
  });

  elSaveScanContext.addEventListener("click", saveSelectedScanContext);

  // ─── Date-range filter ──────────────────────────────────────────────────
  function buildDateParams() {
    const params = new URLSearchParams();
    if (state.filterFrom) params.set("from", state.filterFrom);
    if (state.filterTo)   params.set("to",   state.filterTo);
    return params.toString() ? `&${params.toString()}` : "";
  }

  elFilterFrom.addEventListener("change", () => {
    state.filterFrom = elFilterFrom.value;
    renderWorkspaceScans(state.currentScans);
  });
  elFilterTo.addEventListener("change", () => {
    state.filterTo = elFilterTo.value;
    renderWorkspaceScans(state.currentScans);
  });
  elFilterClear.addEventListener("click", () => {
    state.filterFrom = "";
    state.filterTo = "";
    state.scanDimFilter = "all";
    elFilterFrom.value = "";
    elFilterTo.value = "";
    if (elScanDimFilter) elScanDimFilter.value = "all";
    renderWorkspaceScans(state.currentScans);
    renderSelectedScanDetails();
  });

  elScanDimFilter.addEventListener("change", () => {
    state.scanDimFilter = String(elScanDimFilter.value || "all");
    renderSelectedScanDetails();
  });
  // ───────────────────────────────────────────────────────────────────────

  elExportScans.addEventListener("click", async () => {
    if (!state.selectedProject) return;
    clearError(elWsError);
    elExportScans.disabled = true;
    const prev = elExportScans.textContent;
    elExportScans.textContent = "Loading…";
    try {
      await triggerDownload(
        `/api/projects/${encodeURIComponent(state.selectedProject)}/export/scans?format=csv${buildDateParams()}`,
        `gravio-scans-${state.selectedProject}.csv`,
      );
    } catch (err) {
      showError(elWsError, err.message);
    } finally {
      elExportScans.disabled = false;
      elExportScans.textContent = prev;
    }
  });

  elExportReport.addEventListener("click", async () => {
    if (!state.selectedProject || !state.selectedScanId) return;
    clearError(elWsError);
    elExportReport.disabled = true;
    const prev = elExportReport.textContent;
    elExportReport.textContent = "Loading…";
    try {
      const selected = getScanById(state.selectedScanId);
      if (!selected) throw new Error("Select a scan first.");
      const markdown = buildScanMarkdownReport({
        projectId: state.selectedProject,
        scan: selected,
        dimFilter: state.scanDimFilter,
      });
      const fileName = `gravio-scan-${selected.runId ?? selected.id}-${state.scanDimFilter}.md`;
      downloadTextFile(fileName, markdown, "text/markdown");
    } catch (err) {
      showError(elWsError, err.message);
    } finally {
      elExportReport.disabled = false;
      elExportReport.textContent = prev;
    }
  });

  elExportReportHtml.addEventListener("click", async () => {
    if (!state.selectedProject || !state.selectedScanId) return;
    clearError(elWsError);
    elExportReportHtml.disabled = true;
    const prev = elExportReportHtml.textContent;
    elExportReportHtml.textContent = "Loading…";
    try {
      const selected = getScanById(state.selectedScanId);
      if (!selected) throw new Error("Select a scan first.");
      const html = buildScanHtmlReport({
        projectId: state.selectedProject,
        scan: selected,
        dimFilter: state.scanDimFilter,
      });
      const fileName = `gravio-scan-${selected.runId ?? selected.id}-${state.scanDimFilter}.html`;
      downloadTextFile(fileName, html, "text/html");
    } catch (err) {
      showError(elWsError, err.message);
    } finally {
      elExportReportHtml.disabled = false;
      elExportReportHtml.textContent = prev;
    }
  });

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
      // After project loads, check for requested tab
      const requestedTab = getRequestedTabFromUrl();
      if (requestedTab) {
        setTimeout(() => switchTab(requestedTab, false), 0);
      }
    } else {
      showView("projects");
    }
  });
}

// ─── Init ───
async function init() {
  // Auth check — only this failure warrants a login redirect.
  let me;
  try {
    me = await fetch("/api/me");
  } catch {
    location.href = "/login?next=/dashboard";
    return;
  }
  if (!me.ok) {
    location.href = "/login?next=/dashboard";
    return;
  }
  state.user = await me.json();
  state.cliToken = await fetchCliToken();
  bindEvents();

  try {
    await loadProjects();
  } catch {
    showError(elWsError, "Failed to load projects. Please refresh.");
    return;
  }

  // Phase 4: billing banner (non-blocking)
  fetch("/api/billing/status").then(async (r) => {
    if (!r.ok) return;
    const d = await r.json();
    const BANNERS = {
      past_due: { cls: "db-billing-banner-warn",   msg: "⚠ Your last payment failed. Please update your payment method to avoid losing access. Go to Settings → Billing." },
      unpaid:   { cls: "db-billing-banner-danger", msg: "✕ Your subscription is unpaid after multiple failed attempts. Update your payment method in Settings → Billing." },
      expired:  { cls: "db-billing-banner-danger", msg: "✕ Your subscription has expired. Renew via Settings → Billing." },
    };
    const el = document.getElementById("db-billing-banner");
    const entry = BANNERS[String(d.status ?? "").toLowerCase()];
    if (el && entry) {
      el.className = `db-billing-banner ${entry.cls}`;
      el.textContent = entry.msg;
      el.removeAttribute("hidden");
    }
  }).catch(() => {});

  const requestedProject = getRequestedProjectFromUrl();
  if (requestedProject) {
    const hasProject = state.projects.some((p) => p.project_id === requestedProject);
    if (hasProject) {
      await openProject(requestedProject);
      // After project loads, check for requested tab
      const requestedTab = getRequestedTabFromUrl();
      if (requestedTab) {
        switchTab(requestedTab, false);
      }
    } else {
      showError(elPhError, `Project not found: ${requestedProject}`);
    }
    return;
  }

  if (state.projects.length === 1) {
    await openProject(state.projects[0].project_id);
  }
}

init();
