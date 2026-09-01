// ======================================================
// settingsPage.ts
// Wires up the Settings page: language dropdown + true push
// notification toggle for shift reminders.
// ======================================================
import { loadSettings, saveSettings, applyLanguage } from "./settings.js";
import { enablePushNotifications, disablePushNotifications, isPushSupported } from "./pushSubscription.js";
function renderNotifToggle() {
    const row = document.getElementById("notifToggleRow");
    const note = document.getElementById("notifStatusNote");
    if (!row || !note)
        return;
    const enabled = loadSettings().notificationsEnabled;
    row.querySelectorAll("[data-value]").forEach(btn => {
        btn.classList.toggle("active", (btn.dataset.value === "on") === enabled);
    });
    if (!isPushSupported()) {
        note.textContent = "Push notifications are not supported in this browser.";
    }
    else if (enabled && Notification.permission === "denied") {
        note.textContent = "Notifications are blocked in your browser settings — enable them for this site to receive reminders.";
    }
    else {
        note.textContent = "Get a notification 15 minutes before your shift starts or ends — even when the app is closed.";
    }
}
document.addEventListener("DOMContentLoaded", () => {
    const langSel = document.getElementById("setLanguage");
    if (langSel) {
        langSel.value = loadSettings().language;
        langSel.addEventListener("change", () => {
            const value = langSel.value;
            saveSettings({ language: value });
            applyLanguage(value);
            location.reload();
        });
    }
    renderNotifToggle();
    document.getElementById("notifToggleRow")?.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-value]");
        if (!btn)
            return;
        const wantsOn = btn.dataset.value === "on";
        const toggleRow = document.getElementById("notifToggleRow");
        toggleRow.setAttribute("aria-busy", "true");
        if (!wantsOn) {
            await disablePushNotifications();
            saveSettings({ notificationsEnabled: false });
            renderNotifToggle();
            toggleRow.removeAttribute("aria-busy");
            return;
        }
        const ok = await enablePushNotifications();
        saveSettings({ notificationsEnabled: ok });
        renderNotifToggle();
        toggleRow.removeAttribute("aria-busy");
    });
});
//# sourceMappingURL=settingsPage.js.map