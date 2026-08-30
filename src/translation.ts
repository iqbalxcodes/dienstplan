// ======================================================
// translations.ts
// Central dictionary. Add new keys here as more of the UI
// gets tagged with data-i18n="key" in the HTML.
// ======================================================

export type Language = "de" | "en" | "id";

type Dict = Record<string, string>;

export const TRANSLATIONS: Record<Language, Dict> = {

    de: {

        "hours.freiwunsch": "Freiwunsch",
        "hours.urlaub": "Urlaub"

        "nav.dashboard": "Dashboard",
        "nav.schedule": "Dienstplan",
        "nav.hours": "Stunden",
        "nav.manager": "Manager",
        "nav.admin": "Admin",
        "nav.history": "Verlauf",
        "nav.settings": "Einstellungen",

        "login.title": "Dienstplan Login",
        "login.email": "E-Mail",
        "login.password": "Passwort",
        "login.remember": "Auf diesem Gerät merken",
        "login.submit": "Anmelden",
        "login.noAccount": "Noch kein Konto? Bitte deinen Admin/Chef fragen, oder",
        "login.forgot": "Passwort vergessen?",
        "login.forgotEmailLabel": "E-Mail für den Wiederherstellungslink",
        "login.reset": "Zurücksetzen",
        "login.registerBusiness": "dein Unternehmen registrieren"

        "settings.title": "Einstellungen",
        "settings.language": "Sprache",
        "settings.saveNote": "Deine Auswahl wird automatisch gespeichert."
    },

    en: {

        "hours.freiwunsch": "Time Off Request",
        "hours.urlaub": "Vacation"

        "nav.dashboard": "Dashboard",
        "nav.schedule": "Schedule",
        "nav.hours": "Hours",
        "nav.manager": "Manager",
        "nav.admin": "Admin",
        "nav.history": "History",
        "nav.settings": "Settings",

        "login.title": "Dienstplan Login",
        "login.email": "Email",
        "login.password": "Password",
        "login.remember": "Remember me on this device",
        "login.submit": "Log in",
        "login.noAccount": "No account yet? Please ask your admin / boss, or",
        "login.forgot": "Forgot password?",
        "login.forgotEmailLabel": "Email for the recovery link",
        "login.reset": "Reset",
        "login.registerBusiness": "register your business"

        "settings.title": "Settings",
        "settings.language": "Language",
        "settings.saveNote": "Your choice is saved automatically."
    },

    id: {

        "hours.freiwunsch": "Permintaan Libur",
        "hours.urlaub": "Cuti"

        "nav.dashboard": "Dasbor",
        "nav.schedule": "Jadwal",
        "nav.hours": "Jam Kerja",
        "nav.manager": "Manajer",
        "nav.admin": "Admin",
        "nav.history": "Riwayat",
        "nav.settings": "Pengaturan",

        "login.title": "Login Dienstplan",
        "login.email": "Email",
        "login.password": "Kata sandi",
        "login.remember": "Ingat saya di perangkat ini",
        "login.submit": "Masuk",
        "login.noAccount": "Belum punya akun? Silakan hubungi admin/bos kamu, atau",
        "login.forgot": "Lupa kata sandi?",
        "login.forgotEmailLabel": "Email untuk tautan pemulihan",
        "login.reset": "Kirim ulang",
        "login.registerBusiness": "daftarkan bisnis"

        "settings.title": "Pengaturan",
        "settings.language": "Bahasa",
        "settings.saveNote": "Pilihanmu tersimpan otomatis."
    }

};

export function t(key: string, lang: Language): string {
    return TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key] ?? key;
}