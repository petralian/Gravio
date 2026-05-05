"use strict";

/* ─── auth guard ─── */
(async () => {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) { location.href = "/login?next=/dp"; return; }
    const me = await res.json();
    if (me.role !== "admin") { location.href = "/dashboard"; return; }
    loadAdminData();
  } catch {
    location.href = "/login?next=/dp";
  }
})();

/* ─── logout ─── */
document.getElementById("adm-logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  location.href = "/login";
});

/* ─── helpers ─── */
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/* ─── main data load ─── */
async function loadAdminData() {
  try {
    const res = await fetch("/api/admin/users");
    if (!res.ok) throw new Error("Failed to load admin data");
    const { users, runCounts, recentRuns } = await res.json();

    // Stats
    document.getElementById("stat-users").textContent = users.length;
    document.getElementById("stat-runs").textContent =
      Object.values(runCounts).reduce((a, b) => a + b, 0);
    document.getElementById("stat-active").textContent =
      users.filter((u) => u.is_active).length;

    // Users table
    const tbody = document.getElementById("adm-users-body");
    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="adm-empty">No users yet.</td></tr>`;
    } else {
      tbody.innerHTML = users.map((u) => `
        <tr data-user-id="${u.id}" class="${u.is_active ? "" : "adm-row-disabled"}">
          <td class="adm-mono">${u.id}</td>
          <td>${esc(u.email)}</td>
          <td><span class="adm-role-badge adm-role-${esc(u.role)}">${esc(u.role)}</span></td>
          <td>${runCounts[u.id] ?? 0}</td>
          <td><span class="adm-status ${u.is_active ? "adm-status-active" : "adm-status-disabled"}">${u.is_active ? "Active" : "Disabled"}</span></td>
          <td class="adm-mono">${fmtDate(u.created_at)}</td>
          <td class="adm-actions">
            ${u.is_active
              ? `<button class="adm-act-btn adm-act-warn" data-action="disable" data-id="${u.id}" type="button">Disable</button>`
              : `<button class="adm-act-btn adm-act-ok" data-action="enable" data-id="${u.id}" type="button">Enable</button>`}
            <button class="adm-act-btn adm-act-danger" data-action="delete" data-id="${u.id}" type="button">Delete</button>
          </td>
        </tr>
      `).join("");
    }

    // Recent runs table
    const runsTbody = document.getElementById("adm-runs-body");
    if (recentRuns.length === 0) {
      runsTbody.innerHTML = `<tr><td colspan="3" class="adm-empty">No runs published yet.</td></tr>`;
    } else {
      runsTbody.innerHTML = recentRuns.map((r) => `
        <tr>
          <td class="adm-mono">${esc(r.project_id)}</td>
          <td>${esc(r.email ?? "—")}</td>
          <td class="adm-mono">${fmtDate(r.published_at)}</td>
        </tr>
      `).join("");
    }

    // Action handlers
    document.getElementById("adm-users-body").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const { action, id } = btn.dataset;

      if (action === "delete") {
        if (!confirm(`Delete user #${id}? This removes all their runs and cannot be undone.`)) return;
      }

      btn.disabled = true;
      try {
        const r = await fetch(`/api/admin/users/${id}/${action}`, { method: "POST" });
        if (!r.ok) throw new Error("Action failed");
        loadAdminData(); // refresh
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });

  } catch (err) {
    document.getElementById("adm-users-body").innerHTML =
      `<tr><td colspan="7" class="adm-error">${esc(err.message)}</td></tr>`;
  }
}
