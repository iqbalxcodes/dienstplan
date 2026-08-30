// ======================================================
// settingsPage.ts
// Wires up the Settings page. Currently just the language
// dropdown — extend this as more settings get built.
// ======================================================

import { loadSettings, saveSettings, applyLanguage } from "./settings.js";

document.addEventListener("DOMContentLoaded", () => {

    const langSel = document.getElementById("setLanguage") as HTMLSelectElement | null;
    if(!langSel) return;

    langSel.value = loadSettings().language;

    langSel.addEventListener("change", () => {
        const value = langSel.value as "de" | "en" | "id";
        saveSettings({ language: value });
        applyLanguage(value);
        location.reload(); // re-render nav labels cleanly
    });

}); 