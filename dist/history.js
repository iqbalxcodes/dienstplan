// ======================================================
// history.ts — audit trail viewer.
//   Manager : read-only
//   Admin   : read + delete single entries + CSV export
// Features:
//   - sortable columns (server-side ordering)
//   - drag-resizable column widths (persisted per browser)
//   - expandable detail rows pushing rows below down
//   - full-text-ish search + action-type filter
//   - adaptive rows-per-page following viewport height
//   - CSV export of everything matching current filters
// ======================================================
import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, authReady, isManager, isAdmin } from "./auth.js";
import { logActivity } from "./activityLog.js";
const WIDTH_KEY = "history_col_widths_v1";
const COLUMNS = [
    { key: "time", label: "Time", sortable: true, dbKey: "created_at", width: 200 },
    { key: "member", label: "Member", sortable: true, dbKey: "memberships(full_name)", width: 150 },
    { key: "action", label: "Action", sortable: true, dbKey: "action", width: 180 },
    { key: "summary", label: "Summary", sortable: true, dbKey: "summary", width: 360 }
];
const ACTION_LABELS = {
    "attendance.check_in": "Check In",
    "attendance.check_out": "Check Out",
    "settings.update": "Settings Changed",
    "crew.add": "Crew Added",
    "crew.update": "Crew Updated",
    "crew.deactivate": "Crew Deactivated",
    "crew.reactivate": "Crew Reactivated",
    "crew.role_changed": "Role Changed",
    "shift.reschedule": "Shift Moved",
    "shift.change_approved": "Shift Change Approved",
    "time.manual_edit": "Manual Time Edit",
    "auth.login": "Login",
    "auth.logout": "Logout",
    "recovery.sent": "Recovery Sent",
    "export.performed": "Data Exported"
};
function actionClass(action) {
    if (action.startsWith("attendance."))
        return "act-attendance";
    if (action.startsWith("settings."))
        return "act-settings";
    if (action.startsWith("crew."))
        return "act-crew";
    if (action.startsWith("shift."))
        return "act-shift";
    if (action.startsWith("auth."))
        return "act-auth";
    if (action.startsWith("export."))
        return "act-export";
    return "act-system";
}
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
// ---- state ----
let rows = [];
let currentPage = 1;
let rowsPerPage = 20;
let totalCount = 0;
let activeSearch = "";
let filterAction = "all";
let filterMember = "all";
let activeSortColumn = "time";
let sortDir = { time: "desc" };
let expandedId = null;
let colWidths = {};
let resizeDebounce;
document.addEventListener("DOMContentLoaded", async () => {
    await authReady;
    if (!currentOrg || !isManager()) {
        document.querySelector(".table-container").innerHTML =
            `<p class="auth-error" style="margin:24px;">Manager access required.</p>`;
        return;
    }
    loadColWidths();
    applyColgroup();
    renderHeader();
    wireRoleHint();
    wireSearchEnter();
    void populateUserFilter();
    void refresh();
    window.addEventListener("resize", () => {
        clearTimeout(resizeDebounce);
        resizeDebounce = window.setTimeout(() => {
            const target = calculateRowsPerPage();
            if (target !== rowsPerPage && target > 0) {
                rowsPerPage = target;
                void refresh();
            }
        }, 300);
    });
});
function wireRoleHint() {
    const hint = document.getElementById("roleHint");
    if (hint) {
        hint.textContent = isAdmin()
            ? "Admin mode: you may delete entries from the expanded view."
            : "Read-only view.";
    }
}
async function populateUserFilter() {
    const sel = document.getElementById("userFilter");
    if (!sel || !currentOrg)
        return;
    const { data, error } = await supabaseClient
        .from("memberships")
        .select("id, full_name")
        .eq("organization_id", currentOrg.id)
        .order("full_name");
    if (error || !data)
        return;
    sel.innerHTML = `<option value="all">All users</option>` +
        data.map(m => `<option value="${m.id}">${escapeHtml(m.full_name)}</option>`).join("");
}
function changeUser(value) {
    filterMember = value;
    currentPage = 1;
    expandedId = null;
    void refresh();
}
function wireSearchEnter() {
    const input = document.getElementById("searchInput");
    input?.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault();
            onSearch(input.value);
        }
    });
}
// ---------------- queries ----------------
function baseQuery(forCount = false) {
    let q = supabaseClient
        .from("activity_log")
        .select("*, memberships:actor_membership_id(full_name)", forCount ? { count: "exact", head: true } : undefined)
        .eq("organization_id", currentOrg.id);
    if (filterMember !== "all") {
        q = q.eq("actor_membership_id", filterMember);
    }
    const kw = activeSearch.trim();
    if (kw) {
        q = q.or(`summary.ilike.%${kw}%,action.ilike.%${kw}%`);
    }
    return q;
}
async function refresh() {
    // total count for pagination
    const countRes = await baseQuery(true);
    totalCount = countRes.count ?? 0;
    clampCurrentPage();
    let q = baseQuery(false);
    const def = COLUMNS.find(c => c.key === activeSortColumn);
    if (def?.sortable && def.dbKey) {
        q = q.order(def.dbKey, { ascending: sortDir[activeSortColumn] === "asc" });
    }
    const from = (currentPage - 1) * rowsPerPage;
    q = q.range(from, from + rowsPerPage - 1);
    const { data, error } = await q;
    if (error) {
        console.error(error);
        return;
    }
    rows = data ?? [];
    expandedId = null; // collapse details across page changes
    renderBody();
    renderPaginationBar();
}
// ---------------- header ----------------
function renderHeader() {
    const row = document.getElementById("historyHeaderRow");
    if (!row)
        return;
    row.innerHTML = "";
    COLUMNS.forEach((col, i) => {
        const th = document.createElement("th");
        th.dataset.sortable = String(col.sortable);
        th.style.width = (colWidths[i] ?? col.width) + "px";
        const arrow = activeSortColumn === col.key
            ? (sortDir[col.key] === "asc" ? " \u25b2" : " \u25bc")
            : "";
        const label = document.createElement("span");
        label.className = "col-header-label";
        label.textContent = col.label + arrow;
        if (col.sortable) {
            label.addEventListener("click", e => {
                e.stopPropagation();
                sortBy(col.key);
            });
        }
        const handle = document.createElement("span");
        handle.className = "col-resize-handle";
        wireResizer(handle, i);
        th.appendChild(label);
        th.appendChild(handle);
        row.appendChild(th);
    });
}
function sortBy(key) {
    const def = COLUMNS.find(c => c.key === key);
    if (!def?.sortable)
        return;
    sortDir[key] = sortDir[key] === "asc" ? "desc" : "asc";
    activeSortColumn = key;
    currentPage = 1;
    renderHeader(); // refresh arrow indicators
    void refresh();
}
// ---------------- resizable columns ----------------
function loadColWidths() {
    try {
        colWidths = JSON.parse(localStorage.getItem(WIDTH_KEY) ?? "{}");
    }
    catch {
        colWidths = {};
    }
}
function persistColWidths() {
    localStorage.setItem(WIDTH_KEY, JSON.stringify(colWidths));
}
function applyColgroup() {
    const group = document.getElementById("historyColgroup");
    if (!group)
        return;
    group.innerHTML = "";
    COLUMNS.forEach((c, i) => {
        const col = document.createElement("col");
        col.style.width = (colWidths[i] ?? c.width) + "px";
        group.appendChild(col);
    });
}
function wireResizer(handle, index) {
    handle.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startW = colWidths[index] ?? COLUMNS[index].width;
        const onMove = (ev) => {
            const w = Math.max(90, startW + ev.clientX - startX);
            colWidths[index] = w;
            const col = document.getElementById("historyColgroup")
                ?.children[index];
            if (col) {
                col.style.width = w + "px";
            }
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            persistColWidths();
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
}
// ---------------- body ----------------
function renderBody() {
    const body = document.getElementById("historyTableBody");
    if (!body)
        return;
    body.innerHTML = "";
    rows.forEach(r => {
        const when = new Date(r.created_at);
        const main = document.createElement("tr");
        main.className = "history-row" + (expandedId === r.id ? " expanded" : "");
        main.dataset.id = r.id;
        main.innerHTML = `
            <td>
                <div>${DOW[when.getDay()]}, ${when.toLocaleDateString("de-DE")}</div>
                <div class="plan-entry-meta">${when.toLocaleTimeString("de-DE")}</div>
            </td>
            <td>${escapeHtml(r.memberships?.full_name ?? "\u2014")}</td>
            <td><span class="action-badge ${actionClass(r.action)}">${escapeHtml(ACTION_LABELS[r.action] ?? r.action)}</span></td>
            <td>${escapeHtml(r.summary)}</td>
        `;
        main.addEventListener("click", () => {
            expandedId = expandedId === r.id ? null : r.id;
            renderBody(); // re-render pushes the detail row in/out
        });
        body.appendChild(main);
        if (expandedId === r.id) {
            body.appendChild(buildDetailRow(r));
        }
    });
    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="${COLUMNS.length}" style="padding:16px;color:#888;">No activity found.</td></tr>`;
    }
}
function buildDetailRow(r) {
    const tr = document.createElement("tr");
    tr.className = "detail-row";
    const entries = Object.entries(r.details ?? {});
    tr.innerHTML = `
        <td colspan="${COLUMNS.length}">
            <div class="detail-grid-hist">
                <div>
                    <span class="plan-entry-meta">Full timestamp</span>
                    <strong>${new Date(r.created_at).toLocaleString("de-DE")}</strong>
                </div>
                <div>
                    <span class="plan-entry-meta">Member</span>
                    <strong>${escapeHtml(r.memberships?.full_name ?? "\u2014")}</strong>
                </div>
                <div>
                    <span class="plan-entry-meta">Actor role</span>
                    <strong>${escapeHtml(String(r.details?.actor_role ?? "\u2014"))}</strong>
                </div>
                <div>
                    <span class="plan-entry-meta">Entity type</span>
                    <strong>${escapeHtml(r.entity_type ?? "\u2014")}</strong>
                </div>
                ${entries.map(([k, v]) => `
                    <div>
                        <span class="plan-entry-meta">${escapeHtml(k)}</span>
                        <strong>${escapeHtml(typeof v === "object" && v !== null
        ? JSON.stringify(v)
        : String(v))}</strong>
                    </div>
                `).join("")}
            </div>
            ${isAdmin() ? `
                <div class="plan-entry-actions" style="margin-top:10px;">
                    <button class="btn-reject" onclick="historyPage.deleteEntry('${r.id}')">
                        Delete Entry
                    </button>
                </div>
            ` : ""}
        </td>
    `;
    return tr;
}
// ---------------- toolbar actions ----------------
function onSearch(value) {
    activeSearch = value;
    currentPage = 1;
    expandedId = null;
    void refresh();
}
function clearSearch() {
    activeSearch = "";
    const input = document.getElementById("searchInput");
    if (input)
        input.value = "";
    currentPage = 1;
    void refresh();
}
function changeAction(value) {
    filterAction = value;
    currentPage = 1;
    expandedId = null;
    void refresh();
}
async function deleteEntry(id) {
    if (!confirm("Delete this history entry permanently?"))
        return;
    const { error } = await supabaseClient
        .from("activity_log")
        .delete()
        .eq("id", id);
    if (error) {
        alert(error.message);
        return;
    }
    expandedId = null;
    await refresh();
}
// ---------------- CSV export ----------------
async function exportCsv() {
    // fetch EVERYTHING matching current filter+sort, batched 1000/request
    const def = COLUMNS.find(c => c.key === activeSortColumn);
    const all = [];
    let from = 0;
    const step = 1000;
    for (;;) {
        let q = baseQuery(false);
        if (def.dbKey) {
            q = q.order(def.dbKey, { ascending: sortDir[activeSortColumn] === "asc" });
        }
        const { data, error } = await q.range(from, from + step - 1);
        if (error) {
            alert(error.message);
            return;
        }
        all.push(...(data ?? []));
        if (!data || data.length < step)
            break;
        from += step;
    }
    const head = ["When", "Member", "Role", "Action", "Summary"];
    const lines = [head.join(",")];
    all.forEach(r => {
        lines.push([
            `"${new Date(r.created_at).toLocaleString("de-DE")}"`,
            `"${(r.memberships?.full_name ?? "").replace(/"/g, '""')}"`,
            `"${String(r.details?.actor_role ?? "").replace(/"/g, '""')}"`,
            `"${(ACTION_LABELS[r.action] ?? r.action).replace(/"/g, '""')}"`,
            `"${String(r.summary).replace(/"/g, '""')}"`
        ].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dienstplan-history-${formatDateISO(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logActivity("export.performed", `Exported ${all.length} history entries (CSV)`, { rows: all.length, filter: filterAction, search: activeSearch });
}
// ---------------- pagination ----------------
function getTotalPages() {
    return Math.max(1, Math.ceil(totalCount / rowsPerPage));
}
function clampCurrentPage() {
    const tp = getTotalPages();
    if (currentPage > tp)
        currentPage = tp;
    if (currentPage < 1)
        currentPage = 1;
}
function calculateRowsPerPage() {
    const sc = document.querySelector(".table-scroll");
    if (!sc)
        return rowsPerPage;
    const sample = document.querySelector("#historyTableBody tr:not(.detail-row)");
    const rowH = sample ? sample.getBoundingClientRect().height : 48;
    const available = sc.clientHeight - 45;
    return Math.max(5, Math.floor(available / rowH));
}
function renderPaginationBar() {
    const info = document.getElementById("paginationInfo");
    const nav = document.getElementById("paginationNav");
    if (!info || !nav)
        return;
    const tp = getTotalPages();
    info.innerHTML = totalCount > 0
        ? `${totalCount} entries \u00b7 Page ${currentPage}/${tp}`
        : "No entries";
    nav.innerHTML = "";
    if (tp <= 1)
        return;
    const prev = document.createElement("button");
    prev.innerText = "\u2039 Prev";
    prev.disabled = currentPage <= 1;
    prev.onclick = async () => { currentPage--; await refresh(); };
    nav.appendChild(prev);
    const next = document.createElement("button");
    next.innerText = "Next \u203a";
    next.disabled = currentPage >= tp;
    next.onclick = async () => { currentPage++; await refresh(); };
    nav.appendChild(next);
}
function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s ?? "";
    return div.innerHTML;
}
function formatDateISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// expose inline handlers
window.historyPage = {
    changeAction,
    changeUser,
    onSearch,
    clearSearch,
    deleteEntry,
    exportCsv
};
//# sourceMappingURL=history.js.map