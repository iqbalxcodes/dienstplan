// Zeiterfassung: one member, one month. Rows + stats. All durations are SECONDS.
// Only APPROVED entries count towards totals/stats; other statuses are shown but greyed out.
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
    if (!s) return "\u2014";
    const d = new Date(s);
    return `${d.getHours()}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
};
export const dmy = (s: string) => {
    const d = new Date(s);
    return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
};

// ---- calculations ----
type Worked = { clock_in: string | null; clock_out: string | null; shifts?: { break_minutes: number } | null };

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

export interface Row { e: TimeEntry; counted: boolean; pause: number; elapsed: number; soll: number; balance: number; }
export interface Stat { label: string; value: number; kind?: AdjKind; note?: string | null; }
export interface Sheet { rows: Row[]; stats: Stat[]; totals: { elapsed: number; soll: number; balance: number }; }

export async function loadSheet(orgId: string, m: Membership, month: Date, settings: OrganizationSettings): Promise<Sheet> {

    const from = startOfMonth(month);
    const next = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    const last = addDays(next, -1);
    const org = (t: string, cols: string) => supabase.from(t).select(cols).eq("organization_id", orgId).eq("membership_id", m.id);

    const [cur, prior, adjQ, planQ, leaveQ] = await Promise.all([
        org("time_entries", "*, shifts:shift_id(*)")
            .gte("clock_in", from.toISOString()).lt("clock_in", next.toISOString()).order("clock_in"),
        org("time_entries", "clock_in, clock_out, shifts:shift_id(break_minutes)")
            .eq("status", "approved").lt("clock_in", from.toISOString()),
        org("time_adjustments", "*"),
        org("shifts", "*").eq("status", "published").gte("shift_date", iso(from)).lte("shift_date", iso(last)),
        org("leave_requests", "type, date_start, date_end").eq("status", "approved")
            .in("type", ["urlaub", "sick"]).lte("date_start", iso(last)).gte("date_end", iso(from))
    ]);

    if (cur.error) throw cur.error;
    if (adjQ.error) console.error("time_adjustments (run backend/sql/004_timesheet.sql):", adjQ.error);

    // ---- table rows ----
    const rows: Row[] = ((cur.data ?? []) as unknown as TimeEntry[]).map(e => {
        const counted = e.status === "approved" && !!e.clock_in && !!e.clock_out;
        const elapsed = e.clock_in && e.clock_out ? worked(e) : 0;
        const soll = planned(e.shifts);
        return { e, counted, pause: pause(e), elapsed, soll, balance: e.clock_out ? elapsed - soll : 0 };
    });
    const ok = rows.filter(r => r.counted);
    const sum = (f: (r: Row) => number) => ok.reduce((s, r) => s + f(r), 0);
    const ist = sum(r => r.elapsed);
    const totals = { elapsed: ist, soll: sum(r => r.soll), balance: ist - sum(r => r.soll) };

    // ---- Soll (contract): weekly hours / 7 per calendar day, counted from the day the member was created ----
    const weekly = Number(m.weekly_target_hours);
    const joined = startOfDay(new Date(m.created_at));
    const sollSec = joined > last ? 0 : (weekly / 7) * dayCount(joined > from ? joined : from, last) * 3600;
    const sollPrior = joined < from ? (weekly / 7) * dayCount(joined, addDays(from, -1)) * 3600 : 0;

    // ---- carry-over = everything before this month: (Ist - Soll) + adjustments ----
    const istPrior = ((prior.data ?? []) as unknown as Worked[]).reduce((s, e) => s + (e.clock_in && e.clock_out ? worked(e) : 0), 0);
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

    // ---- leave hours: Mon-Fri days of approved leave inside the month x weekly/5 ----
    const leaveHours = (type: string) => ((leaveQ.data ?? []) as unknown as { type: string; date_start: string; date_end: string }[])
        .filter(l => l.type === type)
        .reduce((s, l) => {
            const a = parseDate(l.date_start), b = parseDate(l.date_end);
            let n = 0;
            for (let d = a < from ? from : a, end = b > last ? last : b; d <= end; d = addDays(d, 1)) if (d.getDay() % 6) n++;   // 0=Sun, 6=Sat -> skipped
            return s + n * (weekly / 5) * 3600;
        }, 0);

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

    const minutes = Math.round((kind === "correction" ? hours : Math.abs(hours)) * 60);
    const mon = iso(startOfMonth(month));

    const { error } = minutes === 0
        ? await supabase.from("time_adjustments").delete().eq("membership_id", membershipId).eq("month", mon).eq("kind", kind)
        : await supabase.from("time_adjustments").upsert(
            { organization_id: orgId, membership_id: membershipId, month: mon, kind, minutes, note: note.trim() || null, created_by: userId },
            { onConflict: "membership_id,month,kind" });

    return error?.message ?? null;
}