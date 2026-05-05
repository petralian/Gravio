"use strict";

/* ─── Auth state detection ─── */
let currentUser = null;

(async () => {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return; // not logged in
    currentUser = await res.json();
    // Adapt header for logged-in user
    const pill = document.getElementById("ob-user-pill");
    pill.textContent = currentUser.email;
    pill.removeAttribute("hidden");
    const loginLink = document.getElementById("ob-login-link");
    if (loginLink) loginLink.hidden = true;
    const logoutBtn = document.getElementById("ob-logout");
    if (logoutBtn) {
      logoutBtn.removeAttribute("hidden");
      logoutBtn.addEventListener("click", async () => {
        await fetch("/auth/logout", { method: "POST" });
        location.href = "/login";
      });
    }
    // Adapt hero CTAs for logged-in user
    const signupCta = document.getElementById("ob-signup-cta");
    const dashboardCta = document.getElementById("ob-dashboard-cta");
    if (signupCta) signupCta.hidden = true;
    if (dashboardCta) dashboardCta.removeAttribute("hidden");
  } catch {
    // silently fail if auth check fails
  }
})();

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
