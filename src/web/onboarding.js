"use strict";

let currentUser = null;

const elStartFree = document.getElementById("ob-start-free");
const elAuthOk = document.getElementById("ob-auth-ok");
const elProjectId = document.getElementById("ob-project-id");
const elCmdPublish = document.getElementById("cmd-publish");
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
  if (elCmdPublish) {
    elCmdPublish.textContent = `node scripts/scanner-daemon.mjs --once --publish --project ${projectId} --server https://gravio.dev --api-key gv_your_api_key_here`;
  }
  if (elDashboardLink) {
    elDashboardLink.href = `/dashboard?project=${encodeURIComponent(projectId)}`;
  }
}

function setAuthStatusMessage(msg) {
  if (!elAuthOk) return;
  elAuthOk.textContent = msg;
  elAuthOk.removeAttribute("hidden");
}

function openAuthModal() {
  if (!elModalWrap) return;
  elModalWrap.removeAttribute("hidden");
}

function closeAuthModal() {
  if (!elModalWrap) return;
  elModalWrap.setAttribute("hidden", "");
}

function setAuthUi(user) {
  const pill = document.getElementById("ob-user-pill");
  const loginLink = document.getElementById("ob-login-link");
  const logoutBtn = document.getElementById("ob-logout");

  if (user) {
    if (pill) {
      pill.textContent = user.email;
      pill.removeAttribute("hidden");
    }
    if (loginLink) loginLink.hidden = true;
    if (logoutBtn) logoutBtn.removeAttribute("hidden");
    if (elStartFree) elStartFree.textContent = "Account connected";
    setAuthStatusMessage(`Signed in as ${user.email}. Continue with steps below.`);
  } else {
    if (pill) pill.setAttribute("hidden", "");
    if (loginLink) loginLink.hidden = false;
    if (logoutBtn) logoutBtn.setAttribute("hidden", "");
    if (elStartFree) elStartFree.textContent = "Create account or sign in";
  }
}

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

async function refreshAuthState() {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) {
      currentUser = null;
      setAuthUi(null);
      return;
    }
    currentUser = await res.json();
    setAuthUi(currentUser);
  } catch {
    currentUser = null;
    setAuthUi(null);
  }
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

elModalBackdrop?.addEventListener("click", closeAuthModal);
elModalClose?.addEventListener("click", closeAuthModal);

document.getElementById("ob-logout")?.addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  currentUser = null;
  setAuthUi(null);
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
    await refreshAuthState();
    closeAuthModal();
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
    await refreshAuthState();
    closeAuthModal();
  } catch {
    showError("ob-reg-error", "Network error — please try again");
  } finally {
    setLoading("ob-reg-submit", false, "Create account →");
  }
});

elProjectId?.addEventListener("input", updateProjectCommands);
updateProjectCommands();
refreshAuthState();

function setCopied(btn, copied) {
  const label = copied ? "Copied" : "Copy command";
  btn.textContent = label;
}

async function copyFromPre(preId, btn) {
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
