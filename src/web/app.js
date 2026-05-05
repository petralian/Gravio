const evaluateBtn = document.getElementById("evaluate-btn");
const runTextarea = document.getElementById("run-json");
const prevTextarea = document.getElementById("prev-json");
const errorMsg = document.getElementById("error-msg");
const resultsSection = document.getElementById("results");
const validationList = document.getElementById("validation-list");
const rawResult = document.getElementById("raw-result");

const loadMinimalBtn = document.getElementById("load-minimal-btn");
const loadRealisticBtn = document.getElementById("load-realistic-btn");
const loadPrevBtn = document.getElementById("load-prev-btn");
const formatRunBtn = document.getElementById("format-run-btn");
const formatPrevBtn = document.getElementById("format-prev-btn");
const clearRunBtn = document.getElementById("clear-run-btn");
const runFileInput = document.getElementById("run-file");
const generateFromBuilderBtn = document.getElementById("generate-from-builder-btn");

const SAMPLE_MINIMAL = {
  runId: "sample-minimal-001",
  scorecard: {
    safety: 92,
    reliability: 88,
    evaluation: 86,
    observability: 84,
    governance: 90,
  },
  workflowResults: [
    { id: "session-bootstrap", status: "pass" },
    { id: "verification-suite", status: "pass" },
    { id: "trace-capture", status: "pass" },
  ],
  adversarialResults: [
    { id: "llm01", status: "pass" },
    { id: "llm02", status: "pass" },
  ],
};

const SAMPLE_REALISTIC = {
  runId: "sample-realistic-2026-05-05",
  scorecard: {
    safety: 95,
    reliability: 90,
    evaluation: 90,
    observability: 89,
    governance: 95,
  },
  workflowResults: [
    { id: "session-bootstrap", status: "pass" },
    { id: "skill-gating", status: "pass" },
    { id: "edit-discipline", status: "pass" },
    { id: "verification-suite", status: "pass" },
    { id: "docs-and-changelog", status: "pass" },
    { id: "deploy-lock-gate", status: "pass" },
    { id: "health-check", status: "pass" },
    { id: "trace-capture", status: "pass" },
    { id: "open-loop-update", status: "pass" },
    { id: "self-improvement", status: "pass" },
    { id: "git-tag-on-version-bump", status: "pass" },
    { id: "migration-safety-check", status: "pass" },
    { id: "secret-scan", status: "pass" },
    { id: "lint-clean", status: "pass" },
  ],
  adversarialResults: [
    { id: "llm01", status: "pass" },
    { id: "llm02", status: "pass" },
    { id: "llm03", status: "pass" },
    { id: "llm04", status: "pass" },
    { id: "llm05", status: "pass" },
    { id: "llm06", status: "pass" },
    { id: "llm07", status: "pass" },
    { id: "llm08", status: "pass" },
    { id: "llm09", status: "pass" },
    { id: "llm10", status: "pass" },
  ],
};

const SAMPLE_PREVIOUS = {
  summary: {
    overallScore: 89,
  },
};

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.hidden = false;
  resultsSection.hidden = true;
}

function clearError() {
  errorMsg.textContent = "";
  errorMsg.hidden = true;
}

function showValidationErrors(errors) {
  if (errors.length === 0) {
    validationList.hidden = true;
    validationList.innerHTML = "";
    return;
  }

  validationList.hidden = false;
  validationList.innerHTML = "";
  for (const err of errors) {
    const li = document.createElement("li");
    li.textContent = err;
    validationList.appendChild(li);
  }
}

function formatIntoTextarea(textarea, data) {
  textarea.value = JSON.stringify(data, null, 2);
}

function readJsonFromTextarea(textarea, fieldName) {
  const raw = textarea.value.trim();
  if (!raw) {
    throw new Error(fieldName + " is empty.");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON in " + fieldName + ".");
  }
}

function validateRun(run) {
  const errors = [];
  if (!run || typeof run !== "object") {
    errors.push("Run JSON must be an object.");
    return errors;
  }

  if (!run.runId || typeof run.runId !== "string") {
    errors.push("Missing runId (string).");
  }

  const scorecard = run.scorecard;
  const dims = ["safety", "reliability", "evaluation", "observability", "governance"];
  if (!scorecard || typeof scorecard !== "object") {
    errors.push("Missing scorecard object.");
  } else {
    for (const dim of dims) {
      const val = scorecard[dim];
      if (typeof val !== "number" || Number.isNaN(val)) {
        errors.push("scorecard." + dim + " must be a number.");
        continue;
      }
      if (val < 0 || val > 100) {
        errors.push("scorecard." + dim + " must be between 0 and 100.");
      }
    }
  }

  if (!Array.isArray(run.workflowResults) || run.workflowResults.length === 0) {
    errors.push("workflowResults must be a non-empty array.");
  }

  if (!Array.isArray(run.adversarialResults) || run.adversarialResults.length === 0) {
    errors.push("adversarialResults must be a non-empty array.");
  }

  return errors;
}

function buildRunFromBuilder() {
  const runId = document.getElementById("builder-run-id").value.trim() || "manual-run";
  const safety = Number(document.getElementById("builder-safety").value);
  const reliability = Number(document.getElementById("builder-reliability").value);
  const evaluation = Number(document.getElementById("builder-evaluation").value);
  const observability = Number(document.getElementById("builder-observability").value);
  const governance = Number(document.getElementById("builder-governance").value);

  const workflowTotal = Math.max(1, Number(document.getElementById("builder-workflow-total").value));
  const workflowPass = Math.max(0, Math.min(workflowTotal, Number(document.getElementById("builder-workflow-pass").value)));

  const advTotal = Math.max(1, Number(document.getElementById("builder-adv-total").value));
  const advFail = Math.max(0, Math.min(advTotal, Number(document.getElementById("builder-adv-fail").value)));

  const workflowResults = [];
  for (let i = 1; i <= workflowTotal; i += 1) {
    workflowResults.push({
      id: "workflow-" + String(i).padStart(2, "0"),
      status: i <= workflowPass ? "pass" : "fail",
    });
  }

  const adversarialResults = [];
  for (let i = 1; i <= advTotal; i += 1) {
    adversarialResults.push({
      id: "llm" + String(i).padStart(2, "0"),
      status: i <= advFail ? "fail" : "pass",
    });
  }

  return {
    runId,
    scorecard: { safety, reliability, evaluation, observability, governance },
    workflowResults,
    adversarialResults,
  };
}

async function importJsonFile(file, targetTextarea) {
  if (!file) return;
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    targetTextarea.value = JSON.stringify(parsed, null, 2);
    clearError();
    showValidationErrors([]);
  } catch {
    showError("Imported file is not valid JSON.");
  }
}

function renderResults(data) {
  document.getElementById("score-value").textContent = data.score.toFixed(2);

  const badge = document.getElementById("pass-badge");
  badge.textContent = data.passed ? "PASS" : "FAIL";
  badge.className = "badge " + (data.passed ? "pass" : "fail");

  document.getElementById("wpr").textContent = data.workflowPassRate + "%";
  document.getElementById("safety").textContent = data.safetyScore;
  document.getElementById("critical").textContent = data.criticalFailures;

  const gatesList = document.getElementById("gates-list");
  gatesList.innerHTML = "";
  for (const gate of data.gates) {
    const li = document.createElement("li");
    li.className = "gate-item" + (gate.passed ? "" : " fail");
    li.innerHTML = `
      <span class="gate-icon">${gate.passed ? "OK" : "X"}</span>
      <span class="gate-label">${gate.label}</span>
      <span class="gate-actual">${gate.actual}</span>
    `;
    gatesList.appendChild(li);
  }

  const grid = document.getElementById("dimensions-grid");
  grid.innerHTML = "";
  for (const [name, dim] of Object.entries(data.dimensions)) {
    const card = document.createElement("div");
    card.className = "dim-card";
    card.innerHTML = `
      <div class="dim-name">${name}</div>
      <div class="dim-score">${dim.raw}</div>
      <div class="dim-weight">${(dim.weight * 100).toFixed(0)}% weight</div>
    `;
    grid.appendChild(card);
  }

  rawResult.value = JSON.stringify(data, null, 2);

  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

loadMinimalBtn.addEventListener("click", () => {
  formatIntoTextarea(runTextarea, SAMPLE_MINIMAL);
  clearError();
  showValidationErrors([]);
});

loadRealisticBtn.addEventListener("click", () => {
  formatIntoTextarea(runTextarea, SAMPLE_REALISTIC);
  clearError();
  showValidationErrors([]);
});

loadPrevBtn.addEventListener("click", () => {
  formatIntoTextarea(prevTextarea, SAMPLE_PREVIOUS);
});

formatRunBtn.addEventListener("click", () => {
  try {
    const parsed = readJsonFromTextarea(runTextarea, "Run JSON");
    formatIntoTextarea(runTextarea, parsed);
    clearError();
  } catch (err) {
    showError(err.message);
  }
});

formatPrevBtn.addEventListener("click", () => {
  try {
    const parsed = readJsonFromTextarea(prevTextarea, "Previous Run JSON");
    formatIntoTextarea(prevTextarea, parsed);
    clearError();
  } catch (err) {
    showError(err.message);
  }
});

clearRunBtn.addEventListener("click", () => {
  runTextarea.value = "";
  clearError();
  showValidationErrors([]);
});

runFileInput.addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  await importJsonFile(file, runTextarea);
});

generateFromBuilderBtn.addEventListener("click", () => {
  const built = buildRunFromBuilder();
  formatIntoTextarea(runTextarea, built);
  clearError();
  showValidationErrors([]);
});

evaluateBtn.addEventListener("click", async () => {
  clearError();
  showValidationErrors([]);

  let run;
  try {
    run = readJsonFromTextarea(runTextarea, "Run JSON");
  } catch (err) {
    showError(err.message);
    return;
  }

  const validationErrors = validateRun(run);
  if (validationErrors.length > 0) {
    showValidationErrors(validationErrors);
    showError("Run JSON shape is invalid. Fix the listed fields and try again.");
    return;
  }

  let previous = null;
  const prevVal = prevTextarea.value.trim();
  if (prevVal) {
    try {
      previous = JSON.parse(prevVal);
    } catch {
      showError("Invalid JSON in Previous Run JSON field.");
      return;
    }
  }

  try {
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run, previous }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error ?? "Server error");
      return;
    }
    renderResults(data);
  } catch (err) {
    showError("Request failed: " + err.message);
  }
});

// Preload samples so first-time users can evaluate immediately.
formatIntoTextarea(runTextarea, SAMPLE_REALISTIC);
formatIntoTextarea(prevTextarea, SAMPLE_PREVIOUS);
