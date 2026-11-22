// Zeiterfassung: one member, one month. Rows + stats. All durations are SECONDS.
// Only APPROVED entries count towards totals/stats; other statuses are shown but greyed out.
//
// Soll (contract) = weekly/7 per calendar day, from the day the member joined until TODAY (never the future),
// minus weekly/5 for every Mon-Fri that is a public holiday or approved leave (nothing expected that day).
import { supabase } from "./supabase";
import { addDays, iso, parseDate, startOfMonth } from "./dates";
import { isHoliday } from "./holidays";
import { isOff, shiftTypesOf } from "./roster";
import { getShiftRange } from "./shifts";
import type { Membership, OrganizationSettings, Shift, TimeEntry } from "./types";

// ---- adjustments (table time_adjustments, one row per member/month/kind) ----
export const ADJ = {
    correction: "Manuelle Korrektur",   // signed (+/-)
    payout: "Ausbezahlte Urlaub",       // subtracted from balance
    comp: "Freizeitausgleich",          // subtracted
    expired: "Verfallene Stunden"       // subtracted
} as const;
export type AdjKind = keyof typeof ADJ;

interface Adjustment { kind: AdjKind; month: string; minutes: number; note: string | null; }
const effect = (a: Adjustment) => (a.kind === "correction" ? 1 : -1) * a.minutes * 60;

// ---- formatting ----
const p2 = (n: number) => String(n).padStart(2, "0");
export const hmm = (sec: number) => {
    const a = Math.abs(Math.round(sec / 60));
    return `${sec < 0 && a ? "-" : ""}${Math.floor(a / 60)}:${p2(a % 60)}`;
};
export const hms = (sec: number) => {
    const a = Math.abs(Math.round(sec));
    return `${sec < 0 && a ? "- " : ""}${Math.floor(a / 3600)}:${p2(Math.floor(a % 3600 / 60))}:${p2(a % 60)}`;
};
export const clock = (s?: string | null) => {
    if (!s) return "-";
    const d = new Date(s);
    return `${d.getHours()}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
};
export const dmy = (s: string) => {
    const d = new Date(s);
    return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
};

// ---- calculations ----
type Worked = { clock_in: string | null; clock_out: string | null; shifts?: { break_minutes: number } | null };
type Leave = { type: string; date_start: string; date_end: string };

const pause = (e: Worked) => (e.shifts?.break_minutes ?? 0) * 60;
const worked = (e: Worked) =>
    e.clock_in && e.clock_out ? Math.max(0, Math.round((Date.parse(e.clock_out) - Date.parse(e.clock_in)) / 1000) - pause(e)) : 0;
const planned = (s?: Shift | null) => {
    if (!s) return 0;
    const r = getShiftRange(s.shift_date, s.start_time, s.end_time);
    return Math.max(0, (r.end - r.start - s.break_minutes) * 60);
};
const dayCount = (a: Date, b: Date) => Math.max(0, Math.round((+b - +a) / 86400000) + 1);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Seconds of [a,b] inside 23:00-06:00 (local time). */
function night(a: Date, b: Date): number {
    let sec = 0;
    for (let d = startOfDay(a); d <= b; d = addDays(d, 1)) {
        const at = (h: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime();
        for (const [x, y] of [[at(0), at(6)], [at(23), at(24)]])
            sec += Math.max(0, Math.min(+b, y) - Math.max(+a, x)) / 1000;
    }
    return sec;
}

/** All rows of a query, 1000 at a time (Supabase caps one response at 1000 rows). Throws on error. */
const PAGE = 1000;
async function pages<T>(build: (from: number, to: number) => PromiseLike<{ data: any; error: any }>): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; ; i += PAGE) {
        const { data, error } = await build(i, i + PAGE - 1);
        if (error) throw error;
        out.push(...((data ?? []) as T[]));
        if (!data || data.length < PAGE) return out;
    }
}

export interface Row { e: TimeEntry; counted: boolean; pause: number; elapsed: number; soll: number; balance: number; }
export interface Stat { label: string; value: number; kind?: AdjKind; note?: string | null; }
export interface Sheet { rows: Row[]; stats: Stat[]; totals: { elapsed: number; soll: number; balance: number }; }

export async function loadSheet(orgId: string, m: Membership, month: Date, settings: OrganizationSettings): Promise<Sheet> {

    const from = startOfMonth(month);
    const next = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    const last = addDays(next, -1);
    const today = startOfDay(new Date());
    const cut = last < today ? last : today;      // Soll never runs into the future
    const org = (t: string, cols: string) => supabase.from(t).select(cols).eq("organization_id", orgId).eq("membership_id", m.id);

    const [cur, prior, adjQ, planQ, leaveQ] = await Promise.all([
        org("time_entries", "*, shifts:shift_id(*)")
            .gte("clock_in", from.toISOString()).lt("clock_in", next.toISOString()).order("clock_in"),
        pages<Worked>((a, b) => org("time_entries", "clock_in, clock_out, shifts:shift_id(break_minutes)")
            .eq("status", "approved").lt("clock_in", from.toISOString()).order("clock_in").range(a, b)),
        org("time_adjustments", "*"),
        org("shifts", "*").eq("status", "published").gte("shift_date", iso(from)).lte("shift_date", iso(last)),
        org("leave_requests", "type, date_start, date_end").eq("status", "approved")
            .in("type", ["urlaub", "sick"]).lte("date_start", iso(cut))
    ]);

    if (cur.error) throw cur.error;
    if (leaveQ.error) throw leaveQ.error;           // a wrong Soll is worse than an error message
    if (adjQ.error) console.error("time_adjustments (run backend/sql/004_timesheet.sql):", adjQ.error);

    // ---- table rows ----
    const seen = new Set<string>();                  // one planned Soll per shift, even with duplicate entries
    const rows: Row[] = ((cur.data ?? []) as unknown as TimeEntry[]).map(e => {
        const counted = e.status === "approved" && !!e.clock_in && !!e.clock_out;
        const elapsed = e.clock_in && e.clock_out ? worked(e) : 0;
        const dup = counted && !!e.shift_id && seen.has(e.shift_id);
        if (counted && e.shift_id) seen.add(e.shift_id);
        const soll = dup ? 0 : planned(e.shifts);
        return { e, counted, pause: pause(e), elapsed, soll, balance: e.clock_out ? elapsed - soll : 0 };
    });
    const ok = rows.filter(r => r.counted);
    const sum = (f: (r: Row) => number) => ok.reduce((s, r) => s + f(r), 0);
    const ist = sum(r => r.elapsed);
    const totals = { elapsed: ist, soll: sum(r => r.soll), balance: ist - sum(r => r.soll) };

    // ---- Soll (contract) ----
    const weekly = Number(m.weekly_target_hours);
    const joined = startOfDay(new Date(m.created_at));
    const leaves = (leaveQ.data ?? []) as unknown as Leave[];

    /** Mon-Fri days (ISO) covered by approved leave inside [a,b], optionally only one type. */
    const leaveDays = (a: Date, b: Date, type?: string) => {
        const set = new Set<string>();
        for (const l of leaves) {
            if (type && l.type !== type) continue;
            const x = parseDate(l.date_start), y = parseDate(l.date_end);
            for (let d = x > a ? x : a, e = y < b ? y : b; d <= e; d = addDays(d, 1)) if (d.getDay() % 6) set.add(iso(d));
        }
        return set;
    };
    /** Seconds of Soll that do not apply in [a,b]: Mon-Fri public holidays + approved leave. */
    const credit = (a: Date, b: Date) => {
        const set = leaveDays(a, b);
        for (let d = a; d <= b; d = addDays(d, 1)) if (d.getDay() % 6 && isHoliday(d)) set.add(iso(d));
        return set.size * (weekly / 5) * 3600;
    };
    const soll = (a: Date, b: Date) => (b < a ? 0 : Math.max(0, dayCount(a, b) * (weekly / 7) * 3600 - credit(a, b)));

    const dayBefore = addDays(from, -1);
    const sollSec = soll(joined > from ? joined : from, cut);
    const sollPrior = soll(joined, dayBefore < today ? dayBefore : today);

    // ---- carry-over = everything before this month: (Ist - Soll) + adjustments ----
    const istPrior = prior.reduce((s, e) => s + (e.clock_in && e.clock_out ? worked(e) : 0), 0);
    const adjAll = (adjQ.data ?? []) as unknown as Adjustment[];
    const m0 = iso(from);
    const carry = istPrior - sollPrior + adjAll.filter(a => a.month < m0).reduce((s, a) => s + effect(a), 0);
    const adjNow = adjAll.filter(a => a.month === m0);
    const adjOf = (k: AdjKind) => adjNow.find(a => a.kind === k);

    const diff = ist - sollSec;
    const saldo = carry + diff + adjNow.reduce((s, a) => s + effect(a), 0);

    // ---- plan hours = published WORK shifts in the month ----
    const types = shiftTypesOf(settings);
    const plan = ((planQ.data ?? []) as unknown as Shift[])
        .filter(s => !isOff(types.find(t => t.code === s.shift_code)))
        .reduce((s, x) => s + planned(x), 0);

    // ---- leave hours shown in the stats: Mon-Fri days of approved leave inside the month x weekly/5 ----
    const leaveHours = (type: string) => leaveDays(from, last, type).size * (weekly / 5) * 3600;

    // ---- special hours (from approved entries, local time, by check-in day) ----
    const hol = ok.filter(r => isHoliday(new Date(r.e.clock_in!))).reduce((s, r) => s + r.elapsed, 0);
    const sunHol = ok.filter(r => new Date(r.e.clock_in!).getDay() === 0 || isHoliday(new Date(r.e.clock_in!))).reduce((s, r) => s + r.elapsed, 0);
    const nacht = ok.reduce((s, r) => s + night(new Date(r.e.clock_in!), new Date(r.e.clock_out!)), 0);

    const adj = (k: AdjKind): Stat => ({ label: ADJ[k], value: (adjOf(k)?.minutes ?? 0) * 60, kind: k, note: adjOf(k)?.note });

    const stats: Stat[] = [
        { label: "Soll-Stunden", value: sollSec },
        { label: "Ist-Stunden", value: ist },
        { label: "Plan Stunden", value: plan },
        { label: "Differenz", value: diff },
        { label: "Übertrag Vormonat", value: carry },
        { label: "Gesamtsaldo", value: saldo },
        { label: "Überstunden", value: Math.max(0, saldo) },
        { label: "Minusstunden", value: Math.max(0, -saldo) },
        adj("payout"), adj("comp"), adj("correction"), adj("expired"),
        { label: "Urlaubsstunden", value: leaveHours("urlaub") },
        { label: "Krankheitsstunden", value: leaveHours("sick") },
        { label: "Feiertagsstunden", value: hol },
        { label: "Nachtstunden", value: nacht },
        { label: "Sonn- & Feiertagsstunden", value: sunHol },
        { label: "Pausenzeit", value: sum(r => r.pause) }
    ];

    return { rows, stats, totals };
}

/** Set one adjustment for (member, month, kind). Zero deletes it. Returns an error message or null. */
export async function saveAdjustment(
    orgId: string, membershipId: string, month: Date, kind: AdjKind, hours: number, note: string, userId: string | null
): Promise<string | null> {

    if (!Number.isFinite(hours)) return "Invalid number";

    const minutes = Math.round((kind === "correction" ? hours : Math.abs(hours)) * 60);
    const mon = iso(startOfMonth(month));

    const { error } = minutes === 0
        ? await supabase.from("time_adjustments").delete().eq("membership_id", membershipId).eq("month", mon).eq("kind", kind)
        : await supabase.from("time_adjustments").upsert(
            { organization_id: orgId, membership_id: membershipId, month: mon, kind, minutes, note: note.trim() || null, created_by: userId },
            { onConflict: "membership_id,month,kind" });

    return error?.message ?? null;
}