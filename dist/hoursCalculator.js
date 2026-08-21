// ======================================================
// hoursCalculator.ts
// Soll (target), Ist (actual worked), Überstunden (overtime,
// can go negative = Minusstunden) — computed from APPROVED
// time_entries only. Pending/rejected entries never count,
// so the numbers always reflect what's actually been signed
// off by a manager.
// ======================================================
import { supabaseClient } from "./supabaseClient.js";
/**
 * Worked hours for a single approved time entry, minus its
 * associated shift's break (if linked) — falls back to 0 break
 * when there's no linked shift (e.g. a purely ad-hoc entry).
 */
function entryHours(entry, breakMinutes = 0) {
    if (!entry.clock_in || !entry.clock_out)
        return 0;
    const inTime = new Date(entry.clock_in).getTime();
    const outTime = new Date(entry.clock_out).getTime();
    const rawMinutes = Math.max(0, (outTime - inTime) / 60000);
    const netMinutes = Math.max(0, rawMinutes - breakMinutes);
    return netMinutes / 60;
}
/**
 * Sollstunden for a date range, prorated from the membership's
 * weekly_target_hours. Simple linear proration — good enough for
 * a restaurant roster; swap in a public-holiday-aware calendar
 * later if needed.
 */
export function sollHoursForRange(membership, dateStart, dateEnd) {
    const days = Math.max(1, Math.round((dateEnd.getTime() - dateStart.getTime()) / 86400000) + 1);
    return (membership.weekly_target_hours / 7) * days;
}
export async function computeHoursSummary(organizationId, membership, dateStart, dateEnd, periodLabel) {
    const { data: entries, error } = await supabaseClient
        .from("time_entries")
        .select("*, shifts:shift_id(break_minutes)")
        .eq("organization_id", organizationId)
        .eq("membership_id", membership.id)
        .eq("status", "approved")
        .gte("clock_in", dateStart.toISOString())
        .lte("clock_in", dateEnd.toISOString());
    if (error || !entries) {
        console.error(error);
        return {
            membershipId: membership.id,
            periodLabel,
            sollHours: sollHoursForRange(membership, dateStart, dateEnd),
            istHours: 0,
            ueberstunden: 0 - sollHoursForRange(membership, dateStart, dateEnd)
        };
    }
    const istHours = entries.reduce((sum, entry) => {
        const breakMinutes = entry.shifts?.break_minutes ?? 0;
        return sum + entryHours(entry, breakMinutes);
    }, 0);
    const sollHours = sollHoursForRange(membership, dateStart, dateEnd);
    return {
        membershipId: membership.id,
        periodLabel,
        sollHours: round2(sollHours),
        istHours: round2(istHours),
        ueberstunden: round2(istHours - sollHours)
    };
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
export function formatHours(hours) {
    const sign = hours < 0 ? "-" : "";
    const abs = Math.abs(hours);
    const h = Math.floor(abs);
    const m = Math.round((abs - h) * 60);
    return `${sign}${h}h ${String(m).padStart(2, "0")}m`;
}
//# sourceMappingURL=hoursCalculator.js.map