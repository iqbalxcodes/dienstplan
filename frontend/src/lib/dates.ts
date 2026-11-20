export const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
export const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

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

export const fmt = (isoStr: string | null) => (isoStr ? new Date(isoStr).toLocaleString("de-DE") : "\u2014");
