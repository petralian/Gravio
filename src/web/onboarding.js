"use strict";
/**
 * Onboarding page — modal + project-name controller.
 * Header / sign-in / sign-out are owned by site-chrome.js.
 * This script listens for the "site:auth" event from the chrome and
 * updates the in-page CTA + status line accordingly.
 */

let currentUser = null;
let onboardingCliToken = null;

const elStartFree = document.getElementById("ob-start-free");
const elAuthOk = document.getElementById("ob-auth-ok");
const elProjectId = document.getElementById("ob-project-id");
const elCmdAuthorize = document.getElementById("cmd-authorize");
const elDashboardLink = document.getElementById("ob-dashboard-link");

const elModalWrap = document.getElementById("ob-auth-modal-wrap");
const elModalBackdrop = document.getElementById("ob-auth-backdrop");
const elModalClose = document.getElementById("ob-auth-close");
const tabLogin = document.getElementById("ob-tab-login");
const tabRegister = document.getElementById("ob-tab-register");
const panelLogin = document.getElementById("ob-panel-login");
const panelRegister = document.getElementById("ob-panel-register");

function getProjectId() {
  const raw = (elProjectId?.value ?? "").trim();
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "my-first-project";
}

function updateProjectCommands() {
  const projectId = getProjectId();
  const tokenPart = onboardingCliToken ?? "gv_sign_in_to_auto_fill_token";
  if (elCmdAuthorize) {
    elCmdAuthorize.textContent = `node gravio.mjs --authorize --target . --project ${projectId} --server https://gravio.dev --api-key ${tokenPart}`;
  }
  if (elDashboardLink) {
    elDashboardLink.href = `/dashboard?project=${encodeURIComponent(projectId)}`;
  }
}

async function fetchOnboardingCliToken() {
  try {
    const res = await fetch("/api/keys/onboarding", { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.key || typeof data.key !== "string") return null;
    return data.key;
  } catch {
    return null;
  }
}

function setAuthStatusMessage(msg) {
  if (!elAuthOk) return;
  elAuthOk.textContent = msg;
  elAuthOk.removeAttribute("hidden");
}

function clearAuthStatusMessage() {
  if (!elAuthOk) return;
  elAuthOk.textContent = "";
  elAuthOk.setAttribute("hidden", "");
}

function openAuthModal() {
  elModalWrap?.removeAttribute("hidden");
}

function closeAuthModal() {
  elModalWrap?.setAttribute("hidden", "");
}

async function loadExistingProjects() {
  const wrap = document.getElementById("ob-existing-projects");
  const pillsEl = document.getElementById("ob-project-pills");
  if (!wrap || !pillsEl) return;
  try {
    const res = await fetch("/api/runs/list");
    if (!res.ok) return;
    const data = await res.json();
    const projects = data.runs ?? [];
    if (projects.length === 0) { wrap.setAttribute("hidden", ""); return; }
    pillsEl.innerHTML = "";
    projects.forEach(({ project_id, scan_count }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ob-project-pill";
      btn.textContent = project_id;
      if (scan_count != null) {
        const count = document.createElement("span");
        count.style.cssText = "opacity:0.5;font-size:11px";
        count.textContent = `\u00b7 ${scan_count} scan${scan_count === 1 ? "" : "s"}`;
        btn.appendChild(count);
      }
      btn.addEventListener("click", () => {
        if (elProjectId) {
          elProjectId.value = project_id;
          updateProjectCommands();
        }
        document.querySelectorAll(".ob-project-pill").forEach((p) => p.classList.remove("ob-pill-active"));
        btn.classList.add("ob-pill-active");
      });
      pillsEl.appendChild(btn);
    });
    wrap.removeAttribute("hidden");
  } catch { /* non-critical, ignore */ }
}

async function applyAuthState(user) {
  currentUser = user;
  if (user) {
    onboardingCliToken = await fetchOnboardingCliToken();
    updateProjectCommands();
    await loadExistingProjects();
    if (elStartFree) elStartFree.textContent = "Account connected";
    if (onboardingCliToken) {
      setAuthStatusMessage(`Signed in as ${user.email}. Your Step 3 command is auto-filled with a user-bound auth token.`);
    } else {
      setAuthStatusMessage(`Signed in as ${user.email}. Continue with steps below.`);
    }
  } else {
    onboardingCliToken = null;
    updateProjectCommands();
    const wrap = document.getElementById("ob-existing-projects");
    if (wrap) wrap.setAttribute("hidden", "");
    if (elStartFree) elStartFree.textContent = "Create account or sign in";
    clearAuthStatusMessage();
  }
}

document.addEventListener("site:auth", (e) => {
  void applyAuthState(e.detail?.user ?? null);
});

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.removeAttribute("hidden");
}

function clearError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = "";
  el.setAttribute("hidden", "");
}

function setLoading(btnId, loading, defaultText) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? "Please wait…" : defaultText;
}

tabLogin?.addEventListener("click", () => {
  tabLogin.classList.add("auth-tab-active");
  tabLogin.setAttribute("aria-selected", "true");
  tabRegister.classList.remove("auth-tab-active");
  tabRegister.setAttribute("aria-selected", "false");
  panelLogin.removeAttribute("hidden");
  panelRegister.setAttribute("hidden", "");
});

tabRegister?.addEventListener("click", () => {
  tabRegister.classList.add("auth-tab-active");
  tabRegister.setAttribute("aria-selected", "true");
  tabLogin.classList.remove("auth-tab-active");
  tabLogin.setAttribute("aria-selected", "false");
  panelRegister.removeAttribute("hidden");
  panelLogin.setAttribute("hidden", "");
});

elStartFree?.addEventListener("click", () => {
  if (currentUser) {
    setAuthStatusMessage("You're signed in. Continue with steps 1-4 below.");
    return;
  }
  openAuthModal();
});

document.querySelectorAll(".ob-open-auth").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (currentUser) {
      setAuthStatusMessage("You're signed in. Continue with steps 1-4 below.");
      return;
    }
    openAuthModal();
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); btn.click(); }
  });
});

elModalBackdrop?.addEventListener("click", closeAuthModal);
elModalClose?.addEventListener("click", closeAuthModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAuthModal();
});

document.getElementById("ob-form-login")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError("ob-login-error");
  setLoading("ob-login-submit", true, "Sign in →");

  const email = document.getElementById("ob-login-email")?.value.trim();
  const password = document.getElementById("ob-login-password")?.value;

  try {
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError("ob-login-error", data.error ?? "Login failed");
      return;
    }
    closeAuthModal();
    if (window.siteChrome?.refresh) await window.siteChrome.refresh();
    else await applyAuthState({ email });
  } catch {
    showError("ob-login-error", "Network error — please try again");
  } finally {
    setLoading("ob-login-submit", false, "Sign in →");
  }
});

document.getElementById("ob-form-register")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError("ob-reg-error");
  setLoading("ob-reg-submit", true, "Create account →");

  const email = document.getElementById("ob-reg-email")?.value.trim();
  const password = document.getElementById("ob-reg-password")?.value;
  const confirm = document.getElementById("ob-reg-confirm")?.value;

  if (password !== confirm) {
    showError("ob-reg-error", "Passwords do not match");
    setLoading("ob-reg-submit", false, "Create account →");
    return;
  }

  try {
    const res = await fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError("ob-reg-error", data.error ?? "Registration failed");
      return;
    }
    closeAuthModal();
    if (window.siteChrome?.refresh) await window.siteChrome.refresh();
    else await applyAuthState({ email });
  } catch {
    showError("ob-reg-error", "Network error — please try again");
  } finally {
    setLoading("ob-reg-submit", false, "Create account →");
  }
});

elProjectId?.addEventListener("input", updateProjectCommands);
updateProjectCommands();

function setCopied(btn, copied) {
  const label = copied ? "Copied" : "Copy command";
  btn.textContent = label;
}

async function copyFromPre(preId, btn) {
  if (!currentUser) {
    openAuthModal();
    return;
  }
  const pre = document.getElementById(preId);
  if (!pre) return;
  const text = pre.textContent.trim();
  try {
    await navigator.clipboard.writeText(text);
    setCopied(btn, true);
    setTimeout(() => setCopied(btn, false), 1200);
  } catch {
    setCopied(btn, true);
    setTimeout(() => setCopied(btn, false), 1200);
  }
}

document.querySelectorAll("[data-copy-id]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const preId = btn.getAttribute("data-copy-id");
    copyFromPre(preId, btn);
  });
});
