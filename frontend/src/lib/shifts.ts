// Shift time math + double-booking check.
// Ranges are in minutes since epoch, anchored at UTC midnight so every
// day is exactly 1440 min (DST-proof). Night shifts (end <= start) roll
// onto the next day.
import { supabase } from "./supabase";
import type { Shift } from "./types";

export interface MinuteRange { start: number; end: number; }

const DAY = 1440;

function dateToMinutes(dateStr: string): number {
    const [y, m, d] = dateStr.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 60000;
}

const minutesOfDay = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
};

export function getShiftRange(shiftDate: string, startTime: string, endTime: string): MinuteRange {
    const day = dateToMinutes(shiftDate);
    const start = day + minutesOfDay(startTime);
    let end = day + minutesOfDay(endTime);
    if (end <= start) end += DAY;
    return { start, end };
}

const overlap = (a: MinuteRange, b: MinuteRange) => a.start < b.end && b.start < a.end;

const dateFromMinutes = (min: number) => new Date(min * 60000).toISOString().slice(0, 10);

const toTime = (total: number) =>
    `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;

/** Absolute range back to shift_date/start_time/end_time. */
export function rangeToShiftFields(range: MinuteRange) {
    const dayStart = Math.floor(range.start / DAY) * DAY;
    return {
        shift_date: dateFromMinutes(dayStart),
        start_time: toTime(range.start - dayStart),
        end_time: toTime((range.end - dayStart) % DAY)
    };
}

/** Other shifts of this member that overlap the proposed one (±1 day window catches night shifts). */
export async function findShiftConflicts(
    orgId: string, membershipId: string, date: string, start: string, end: string, excludeId?: string
): Promise<{ conflicts: Shift[]; error: unknown }> {

    const day = dateToMinutes(date);

    let q = supabase.from("shifts").select("*")
        .eq("organization_id", orgId)
        .eq("membership_id", membershipId)
        .gte("shift_date", dateFromMinutes(day - DAY))
        .lte("shift_date", dateFromMinutes(day + DAY));
    if (excludeId) q = q.neq("id", excludeId);

    const { data, error } = await q;
    if (error || !data) return { conflicts: [], error };

    const proposed = getShiftRange(date, start, end);
    const conflicts = (data as Shift[]).filter(s =>
        overlap(proposed, getShiftRange(s.shift_date, s.start_time, s.end_time)));

    return { conflicts, error: null };
}
