// ======================================================
// nav.ts
// Global Dienstplan navigation. Role-gated tabs:
//   - Manager tab : manager + admin roles
//   - Admin tab   : admin (technical) role only
// ======================================================
import { t } from "./translations.js";
import { loadSettings } from "./settings.js";
const DIENSTPLAN_NAVIGATION = [
    {
        label: "nav.dashboard",
        href: "index.html",
        page: "dashboard"
    },
    {
        label: "nav.schedule",
        href: "schedule.html",
        page: "schedule"
    },
    {
        label: "nav.hours",
        href: "hours.html",
        page: "hours"
    },
    {
        label: "nav.manager",
        href: "manager.html",
        page: "manager",
        roles: ["manager", "admin"]
    },
    {
        label: "nav.admin",
        href: "admin.html",
        page: "admin",
        roles: ["admin"]
    },
    {
        label: "nav.history",
        href: "history.html",
        page: "history",
        roles: ["manager", "admin"]
    },
    {
        label: "nav.settings",
        href: "settings.html",
        page: "settings"
    },
];
// ======================================================
// getCurrentPageFile
// Reads the active tab from window.location.pathname
// instead of a data-page attribute — so a wrong/stale
// data-page value on any HTML file can never desync the
// highlighted tab.
// ======================================================
function getCurrentPageFile() {
    const path = window.location.pathname;
    const file = path.substring(path.lastIndexOf("/") + 1);
    return file || "index.html";
}
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
    const currentFile = getCurrentPageFile();
    const currentLang = loadSettings().language;
    const tabs = [];
    DIENSTPLAN_NAVIGATION.forEach(item => {
        if (item.roles && (!role || !item.roles.includes(role))) {
            return;
        }
        const tab = document.createElement("a");
        tab.className = "rack-tab";
        if (item.href === currentFile) {
            tab.classList.add("active");
        }
        tab.textContent = t(item.label, currentLang);
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