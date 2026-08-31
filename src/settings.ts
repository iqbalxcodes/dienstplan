// ======================================================
// settings.ts
// User-level app settings, persisted in localStorage.
// language + notificationsEnabled implemented. Add more
// fields here later when those features are built.
// ======================================================

import { TRANSLATIONS, type Language } from "./translations.js";

export interface UserSettings {
    language: Language;
    notificationsEnabled: boolean;
}

const STORAGE_KEY = "dienstplan_settings_v1";

const DEFAULT_SETTINGS: UserSettings = {
    language: "de",
    notificationsEnabled: false
};

export function loadSettings(): UserSettings {

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if(!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }

}

export function saveSettings(patch: Partial<UserSettings>): UserSettings {

    const merged = { ...loadSettings(), ...patch };

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch(err){
        console.error("Failed to save settings:", err);
    }

    applyLanguage(merged.language);

    return merged;

}

export function applyLanguage(lang: Language): void {

    document.documentElement.setAttribute("lang", lang);

    document.querySelectorAll<HTMLElement>("[data-i18n]").forEach(el => {
        const key = el.dataset.i18n!;
        const dict = TRANSLATIONS[lang] ?? TRANSLATIONS.en;
        const value = dict[key] ?? TRANSLATIONS.en[key];
        if(value !== undefined) el.textContent = value;
    });

    document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach(el => {
        const key = el.dataset.i18nPlaceholder!;
        const dict = TRANSLATIONS[lang] ?? TRANSLATIONS.en;
        const value = dict[key] ?? TRANSLATIONS.en[key];
        if(value !== undefined) el.setAttribute("placeholder", value);
    });

}

applyLanguage(loadSettings().language);