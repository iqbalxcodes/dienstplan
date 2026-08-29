// ======================================================
// nav.ts
// Global Dienstplan navigation. Role-gated tabs:
//   - Manager tab : manager + admin roles
//   - Admin tab   : admin (technical) role only
// ======================================================
const DIENSTPLAN_NAVIGATION = [
    {
        label: "Dashboard",
        href: "index.html",
        page: "dashboard"
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
        label: "Manager",
        href: "manager.html",
        page: "manager",
        roles: ["manager", "admin"]
    },
    {
        label: "Admin",
        href: "admin.html",
        page: "admin",
        roles: ["admin"]
    },
    {
        label: "History",
        href: "history.html",
        page: "history",
        roles: ["manager", "admin"]
    },
];
// ======================================================
// renderNavigation
// role = currentMembership?.role ?? null (passed in from
// dienstplan.ts after bootstrapAuth() resolves). Tabs with a
// `roles` allowlist are skipped entirely if the role isn't in
// it — logged-out users never see gated tabs either.
// ======================================================
export function renderNavigation(role = null) {
    const container = document.getElementById("pageNavigation");
    if (!container)
        return;
    const currentPage = container.dataset.page;
    const tabs = [];
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
        else {
            tab.href = item.href;
        }
        tabs.push(tab);
    });
    container.className = "rack-tabs";
    container.replaceChildren(...tabs);
}
//# sourceMappingURL=nav.js.map