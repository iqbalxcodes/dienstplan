// ======================================================
// settingsPage.ts
// Wires up the Settings page: language dropdown + shift
// reminder notification toggle.
// ======================================================

import { loadSettings, saveSettings, applyLanguage } from "./settings.js";
import { requestNotificationPermission, startShiftReminders, stopShiftReminders, isNotificationSupported } from "./notifications.js";

function renderNotifToggle(): void {

    const row = document.getElementById("notifToggleRow");
    const note = document.getElementById("notifStatusNote");
    if(!row || !note) return;

    const enabled = loadSettings().notificationsEnabled;

    row.querySelectorAll<HTMLButtonElement>("[data-value]").forEach(btn => {
        btn.classList.toggle("active", (btn.dataset.value === "on") === enabled);
    });

    if(!isNotificationSupported()){
        note.textContent = "Notifications are not supported in this browser.";
    } else if(enabled && Notification.permission === "denied"){
        note.textContent = "Notifications are blocked in your browser settings — enable them for this site to receive reminders.";
    } else {
        note.textContent = "Get a browser notification 15 minutes before your shift starts or ends. Only works while a Dienstplan tab is open in your browser.";
    }

}

document.addEventListener("DOMContentLoaded", () => {

    const langSel = document.getElementById("setLanguage") as HTMLSelectElement | null;
    if(langSel){

        langSel.value = loadSettings().language;

        langSel.addEventListener("change", () => {
            const value = langSel.value as "de" | "en" | "id";
            saveSettings({ language: value });
            applyLanguage(value);
            location.reload();
        });

    }

    renderNotifToggle();

    document.getElementById("notifToggleRow")?.addEventListener("click", async (e) => {

        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-value]");
        if(!btn) return;

        const wantsOn = btn.dataset.value === "on";

        if(!wantsOn){
            saveSettings({ notificationsEnabled: false });
            stopShiftReminders();
            renderNotifToggle();
            return;
        }

        if(!isNotificationSupported()){
            renderNotifToggle();
            return;
        }

        const permission = await requestNotificationPermission();

        if(permission !== "granted"){
            saveSettings({ notificationsEnabled: false });
            renderNotifToggle();
            return;
        }

        saveSettings({ notificationsEnabled: true });
        startShiftReminders();
        renderNotifToggle();

    });

});