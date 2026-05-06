"use strict";
/**
 * Site chrome loader — single source of truth for header + footer.
 * Each page includes <div data-site-header></div> and <div data-site-footer></div>
 * placeholders. This script fetches the partials, injects them, then wires
 * auth state (Sign in / Sign out + user pill) and active-nav highlighting.
 */

(async function siteChrome() {
  const headerHost = document.querySelector("[data-site-header]");
  const footerHost = document.querySelector("[data-site-footer]");

  async function inject(host, url) {
    if (!host) return;
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) return;
      host.innerHTML = await res.text();
    } catch {
      // network/file error — leave placeholder empty rather than crash the page
    }
  }

  await Promise.all([
    inject(headerHost, "/partials/header.html"),
    inject(footerHost, "/partials/footer.html"),
  ]);

  // Active nav highlight — match the current path against data-nav attributes.
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  document.querySelectorAll("[data-nav]").forEach((el) => {
    const target = el.getAttribute("data-nav");
    if (target === path) {
      el.classList.add("m-nav-active");
      el.setAttribute("aria-current", "page");
    }
  });

  // Auth state — toggle data-auth-only / data-anon-only blocks.
  function setAuth(user) {
    document.querySelectorAll("[data-auth-only]").forEach((el) => {
      if (user) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
    });
    document.querySelectorAll("[data-anon-only]").forEach((el) => {
      if (user) el.setAttribute("hidden", "");
      else el.removeAttribute("hidden");
    });
    document.querySelectorAll(".sc-user-pill").forEach((el) => {
      el.textContent = user ? user.email : "";
    });
    // Notify other scripts (e.g. onboarding modal) that auth state changed.
    document.dispatchEvent(new CustomEvent("site:auth", { detail: { user } }));
  }

  async function refresh() {
    try {
      const res = await fetch("/api/me", { cache: "no-cache" });
      if (!res.ok) { setAuth(null); return null; }
      const user = await res.json();
      setAuth(user);
      return user;
    } catch {
      setAuth(null);
      return null;
    }
  }

  document.addEventListener("click", async (e) => {
    const target = e.target.closest(".sc-logout");
    if (!target) return;
    e.preventDefault();
    try {
      await fetch("/auth/logout", { method: "POST" });
    } catch { /* ignore */ }
    setAuth(null);
    // Dashboard requires auth — bounce home on sign out.
    if (path === "/dashboard") {
      window.location.href = "/";
    }
  });

  // Expose for pages that need to refresh after login (onboarding modal).
  window.siteChrome = { refresh, setAuth };

  await refresh();
})();
