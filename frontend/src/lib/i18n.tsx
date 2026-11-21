// User-level settings (localStorage) + translations.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Language = "de" | "en" | "id";

const TRANSLATIONS: Record<Language, Record<string, string>> = {
    de: {
        "hours.freiwunsch": "Freiwunsch", "hours.urlaub": "Urlaub",
        "nav.dashboard": "Übersicht", "nav.schedule": "Dienstpläne", "nav.hours": "Zeiten", "nav.manager": "Manager",
        "nav.timesheet": "Zeiterfassung", "nav.leave": "Freiwünsche & Urlaub",
        "nav.admin": "Admin", "nav.history": "Aktivität", "nav.settings": "Einstellungen",
        "login.title": "Dienstplan Login", "login.email": "E-Mail", "login.password": "Passwort",
        "login.remember": "Auf diesem Gerät merken", "login.submit": "Anmelden",
        "login.noAccount": "Noch kein Konto? Bitte deinen Admin/Chef fragen, oder",
        "login.forgot": "Passwort vergessen?", "login.forgotEmailLabel": "E-Mail für den Wiederherstellungslink",
        "login.reset": "Zurücksetzen", "login.registerBusiness": "dein Unternehmen registrieren",
        "settings.title": "Einstellungen", "settings.language": "Sprache",
        "settings.saveNote": "Deine Auswahl wird automatisch gespeichert."
    },
    en: {
        "hours.freiwunsch": "Time Off Request", "hours.urlaub": "Vacation",
        "nav.dashboard": "Overview", "nav.schedule": "Schedule", "nav.hours": "Times", "nav.manager": "Manager",
        "nav.timesheet": "Time Tracking", "nav.leave": "Time Off & Vacation",
        "nav.admin": "Admin", "nav.history": "Activity", "nav.settings": "Settings",
        "login.title": "Dienstplan Login", "login.email": "Email", "login.password": "Password",
        "login.remember": "Remember me on this device", "login.submit": "Log in",
        "login.noAccount": "No account yet? Please ask your admin / boss, or",
        "login.forgot": "Forgot password?", "login.forgotEmailLabel": "Email for the recovery link",
        "login.reset": "Reset", "login.registerBusiness": "register your business",
        "settings.title": "Settings", "settings.language": "Language",
        "settings.saveNote": "Your choice is saved automatically."
    },
    id: {
        "hours.freiwunsch": "Permintaan Libur", "hours.urlaub": "Cuti",
        "nav.dashboard": "Dasbor", "nav.schedule": "Jadwal", "nav.hours": "Waktu", "nav.manager": "Manajer",
        "nav.timesheet": "Catatan Waktu", "nav.leave": "Libur & Cuti",
        "nav.admin": "Admin", "nav.history": "Aktivitas", "nav.settings": "Pengaturan",
        "login.title": "Login Dienstplan", "login.email": "Email", "login.password": "Kata sandi",
        "login.remember": "Ingat saya di perangkat ini", "login.submit": "Masuk",
        "login.noAccount": "Belum punya akun? Silakan hubungi admin/bos kamu, atau",
        "login.forgot": "Lupa kata sandi?", "login.forgotEmailLabel": "Email untuk tautan pemulihan",
        "login.reset": "Kirim ulang", "login.registerBusiness": "daftarkan bisnis",
        "settings.title": "Pengaturan", "settings.language": "Bahasa",
        "settings.saveNote": "Pilihanmu tersimpan otomatis."
    }
};

interface UserSettings { language: Language; notificationsEnabled: boolean; }

const KEY = "dienstplan_settings_v1";
const DEFAULTS: UserSettings = { language: "de", notificationsEnabled: false };

function load(): UserSettings {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; }
    catch { return { ...DEFAULTS }; }
}

interface Ctx {
    settings: UserSettings;
    update: (patch: Partial<UserSettings>) => void;
    t: (key: string) => string;
}

const SettingsCtx = createContext<Ctx>(null!);
export const useSettings = () => useContext(SettingsCtx);

export function SettingsProvider({ children }: { children: ReactNode }) {

    const [settings, setSettings] = useState(load);

    useEffect(() => {
        document.documentElement.lang = settings.language;
        try { localStorage.setItem(KEY, JSON.stringify(settings)); }
        catch (err) { console.error("Failed to save settings:", err); }
    }, [settings]);

    const update = useCallback((patch: Partial<UserSettings>) => setSettings(s => ({ ...s, ...patch })), []);

    const t = useCallback(
        (key: string) => TRANSLATIONS[settings.language][key] ?? TRANSLATIONS.en[key] ?? key,
        [settings.language]
    );

    const value = useMemo(() => ({ settings, update, t }), [settings, update, t]);

    return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}