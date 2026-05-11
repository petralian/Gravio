"use strict";
/**
 * Onboarding page — modal + smart command controller.
 * Header / sign-in / sign-out are owned by site-chrome.js.
 * This script listens for the "site:auth" event from the chrome and
 * updates the in-page CTA + status line accordingly.
 */

let currentUser = null;
let onboardingCliToken = null;
const PASSWORD_POLICY_HINT = "Use at least 12 characters with uppercase, lowercase, number, and symbol.";

const elStartFree = document.getElementById("ob-start-free");
const elAuthOk = document.getElementById("ob-auth-ok");
const elCmdSmartStart = document.getElementById("cmd-smartstart");

const elModalWrap = document.getElementById("ob-auth-modal-wrap");
const elModalBackdrop = document.getElementById("ob-auth-backdrop");
const elModalClose = document.getElementById("ob-auth-close");
const tabLogin = document.getElementById("ob-tab-login");
const tabRegister = document.getElementById("ob-tab-register");
const panelLogin = document.getElementById("ob-panel-login");
const panelRegister = document.getElementById("ob-panel-register");

function updateSmartCommand() {
  const tokenPart = onboardingCliToken ?? "gv_sign_in_to_auto_fill_token";
  if (elCmdSmartStart) {
    elCmdSmartStart.textContent = `$env:GRAVIO_TOKEN='${tokenPart}'; node gravio.mjs`;
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

async function applyAuthState(user) {
  currentUser = user;
  if (user) {
    onboardingCliToken = await fetchOnboardingCliToken();
    updateSmartCommand();
    if (elStartFree) elStartFree.textContent = "Account connected";
    if (onboardingCliToken) {
      setAuthStatusMessage(`Signed in as ${user.email}. Your Step 2 command is auto-filled with a user-bound token.`);
    } else {
      setAuthStatusMessage(`Signed in as ${user.email}. Continue with steps below.`);
    }
  } else {
    onboardingCliToken = null;
    updateSmartCommand();
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

function validateStrongPassword(email, password) {
  if (!password || password.length < 12) return "Password must be at least 12 characters";
  if (/\s/.test(password)) return "Password cannot contain spaces";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return PASSWORD_POLICY_HINT;
  }
  const local = String(email ?? "").trim().toLowerCase().split("@")[0] ?? "";
  if (local.length >= 3 && password.toLowerCase().includes(local)) {
    return "Password cannot include your email name.";
  }
  return "";
}

async function setupSsoButtons() {
  try {
    const res = await fetch("/auth/sso/providers", { method: "GET" });
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.google) return;
    ["ob-login-sso-google", "ob-register-sso-google"].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.removeAttribute("hidden");
    });
  } catch {
    // Keep SSO buttons hidden if provider discovery fails.
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
    setAuthStatusMessage("You're signed in. Continue with the steps below.");
    return;
  }
  openAuthModal();
});

document.querySelectorAll(".ob-open-auth").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (currentUser) {
      setAuthStatusMessage("You're signed in. Continue with the steps below.");
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

  const passwordError = validateStrongPassword(email, password);
  if (passwordError) {
    showError("ob-reg-error", passwordError);
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

updateSmartCommand();

function setCopied(btn, copied) {
  const label = copied ? "Copied" : "Copy command";
  btn.textContent = label;
}

async function copyFromPre(preId, btn) {
  if (btn?.dataset.authOnlyCopy === "true" && !currentUser) {
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

void setupSsoButtons();
