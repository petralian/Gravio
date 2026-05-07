"use strict";

const PASSWORD_POLICY_HINT = "Use at least 12 characters with uppercase, lowercase, number, and symbol.";

/* ─── tab switching ─── */
const tabLogin    = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const panelLogin  = document.getElementById("panel-login");
const panelReg    = document.getElementById("panel-register");

tabLogin.addEventListener("click", () => {
  tabLogin.classList.add("auth-tab-active");    tabLogin.setAttribute("aria-selected", "true");
  tabRegister.classList.remove("auth-tab-active"); tabRegister.setAttribute("aria-selected", "false");
  panelLogin.removeAttribute("hidden");
  panelReg.setAttribute("hidden", "");
});

tabRegister.addEventListener("click", () => {
  tabRegister.classList.add("auth-tab-active");  tabRegister.setAttribute("aria-selected", "true");
  tabLogin.classList.remove("auth-tab-active");  tabLogin.setAttribute("aria-selected", "false");
  panelReg.removeAttribute("hidden");
  panelLogin.setAttribute("hidden", "");
});

/* ─── helpers ─── */
function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.removeAttribute("hidden");
}
function clearError(id) {
  const el = document.getElementById(id);
  el.textContent = "";
  el.setAttribute("hidden", "");
}
function setLoading(btnId, loading, defaultText) {
  const btn = document.getElementById(btnId);
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

    const next = new URLSearchParams(location.search).get("next");
    const href = next && next.startsWith("/")
      ? `/auth/sso/google/start?next=${encodeURIComponent(next)}`
      : "/auth/sso/google/start";
    ["login-sso-google", "register-sso-google"].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.setAttribute("href", href);
      btn.removeAttribute("hidden");
    });
  } catch {
    // Ignore provider detection failures and keep SSO buttons hidden.
  }
}

function showSsoCallbackErrorIfPresent() {
  const code = new URLSearchParams(location.search).get("authError");
  if (!code) return;
  const map = {
    sso_not_configured: "Google SSO is not configured yet.",
    sso_state_invalid: "Sign-in expired. Please try Google sign-in again.",
    sso_token_exchange_failed: "Google sign-in failed during token exchange.",
    sso_token_missing: "Google sign-in response was incomplete.",
    sso_profile_failed: "Could not load your Google profile.",
    sso_email_unverified: "Google account email must be verified.",
    sso_signin_denied: "Sign-in was denied for this account.",
    sso_unexpected_error: "Unexpected Google sign-in error. Please try again.",
  };
  showError("login-error", map[code] ?? "Google sign-in failed. Please try again.");
}

/* ─── redirect after auth ─── */
function redirectAfterAuth(role) {
  const next = new URLSearchParams(location.search).get("next");
  if (next && next.startsWith("/")) {
    location.href = next;
  } else if (role === "admin") {
    location.href = "/dp";
  } else {
    location.href = "/dashboard";
  }
}

/* ─── login ─── */
document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError("login-error");
  setLoading("login-submit", true, "Sign in →");

  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  try {
    const res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError("login-error", data.error ?? "Login failed");
      return;
    }
    redirectAfterAuth(data.role);
  } catch {
    showError("login-error", "Network error — please try again");
  } finally {
    setLoading("login-submit", false, "Sign in →");
  }
});

/* ─── register ─── */
document.getElementById("form-register").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError("reg-error");

  const email    = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  const confirm  = document.getElementById("reg-confirm").value;

  if (password !== confirm) {
    showError("reg-error", "Passwords do not match");
    return;
  }

  const passwordError = validateStrongPassword(email, password);
  if (passwordError) {
    showError("reg-error", passwordError);
    return;
  }

  setLoading("reg-submit", true, "Create account →");

  try {
    const res = await fetch("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError("reg-error", data.error ?? "Registration failed");
      return;
    }
    redirectAfterAuth(data.role);
  } catch {
    showError("reg-error", "Network error — please try again");
  } finally {
    setLoading("reg-submit", false, "Create account →");
  }
});

void setupSsoButtons();
showSsoCallbackErrorIfPresent();
