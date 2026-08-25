// ======================================================
// nav.ts
// Global Dienstplan navigation (same pattern as Hotel PMS's
// navigation.js, adapted for the schedule/dashboard/hours/
// admin pages and role-gated tabs).
// ======================================================
const DIENSTPLAN_NAVIGATION = [
    {
        label: "Dashboard",
        href: "index.html",
        page: "index"
    },
    {
        label: "Schedule",
        href: "schedule.html",
        page: "schedule"
    },
    {
        label: "Hours",
        href: "hours.html",
        page: "hours"
    },
    {
        label: "Admin",
        href: "admin.html",
        page: "admin",
        roles: ["manager", "owner"]
    }
];
// ======================================================
// renderNavigation
// role = currentMembership?.role ?? null (passed in from
// dienstplan.ts after initAuthContext() resolves). Tabs with
// a `roles` allowlist are skipped entirely if role isn't in
// it — logged-out (role === null) never sees them either.
// ======================================================
export function renderNavigation(role = null) {
    const container = document.getElementById("pageNavigation");
    if (!container)
        return;
    const currentPage = container.dataset.page;
    const nav = document.createElement("div");
    nav.className = "rack-tabs";
    DIENSTPLAN_NAVIGATION.forEach(item => {
        if (item.roles && (!role || !item.roles.includes(role))) {
            return;
        }
        const tab = document.createElement("a");
        tab.className = "rack-tab";
        if (item.page === currentPage) {
            tab.classList.add("active");
        }
        tab.textContent = item.label;
        // ==================================================
        // DEVELOPMENT / NOT YET IMPLEMENTED
        // ==================================================
        if (item.development) {
            tab.href = "#";
            tab.addEventListener("click", (event) => {
                event.preventDefault();
                const win = window;
                if (typeof win.showDevMessage === "function") {
                    win.showDevMessage(item.label);
                }
                else {
                    alert(`${item.label} is currently under development.`);
                }
            });
        }
        // ==================================================
        // NORMAL PAGE
        // ==================================================
        else {
            tab.href = item.href;
        }
        nav.appendChild(tab);
    });
    container.replaceWith(nav);
}
//# sourceMappingURL=nav.js.map