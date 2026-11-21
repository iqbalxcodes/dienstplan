// German public holidays: national + Bayern extras. Edit the list below for another state.
import { addDays, iso } from "./dates";

// Meeus/Jones/Butcher algorithm
function easter(y: number): Date {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
}

const cache = new Map<number, Set<string>>();

export function holidaysOf(y: number): Set<string> {
    let s = cache.get(y);
    if (!s) {
        const e = easter(y), rel = (n: number) => iso(addDays(e, n));
        s = new Set([
            `${y}-01-01`, `${y}-01-06`,                      // Neujahr, Heilige Drei Könige (BY)
            rel(-2), rel(1),                                 // Karfreitag, Ostermontag
            `${y}-05-01`, rel(39), rel(50), rel(60),         // 1. Mai, Himmelfahrt, Pfingstmontag, Fronleichnam (BY)
            `${y}-10-03`, `${y}-11-01`,                      // Tag der Einheit, Allerheiligen (BY)
            `${y}-12-25`, `${y}-12-26`
        ]);
        cache.set(y, s);
    }
    return s;
}

export const isHoliday = (d: Date) => holidaysOf(d.getFullYear()).has(iso(d));