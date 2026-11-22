export const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
export function isoWeek(d: Date): number {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((+t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}

const pad = (n: number) => String(n).padStart(2, "0");

export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function addDays(d: Date, n: number): Date {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
}

export function parseDate(s: string): Date {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
}

export function startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

export const isSameDay = (a: Date, b: Date) => iso(a) === iso(b);

/** Value for <input type="datetime-local"> */
export function toLocalInput(isoStr: string): string {
    const d = new Date(isoStr);
    return `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fmt = (isoStr: string | null) => (isoStr ? new Date(isoStr).toLocaleString("de-DE") : "-");

/** 21.11.2026 - 09:11:00 */
export const fmtDT = (s: string | null) =>
    s ? `${new Date(s).toLocaleDateString("de-DE")} - ${new Date(s).toLocaleTimeString("de-DE")}` : "-";

/** "06:30:00" -> "6:30" */
export const hm = (t: string) => `${+t.slice(0, 2)}:${t.slice(3, 5)}`;

export function duration(a: string, b: string): string {
    const m = Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
    return `${Math.floor(m / 60)} Hours ${m % 60} Minutes`;
}
