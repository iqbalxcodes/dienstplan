// ======================================================
// shiftAvailability.ts
// Plays the same role RoomAvailability (js/roomAvailability.js)
// plays for roomRack.js: turns a shift's date + start/end time
// into a comparable numeric range, detects overlaps, and checks
// for double-booking (one employee, two overlapping shifts).
//
// Unlike rooms (which snap to AM/PM halves), shifts have real
// clock times, so ranges here are in MINUTES SINCE EPOCH rather
// than half-day indices. Night shifts (end_time < start_time)
// are handled by rolling the end time onto the next day.
// ======================================================
import { supabaseClient } from "./supabaseClient.js";
const MINUTES_PER_DAY = 24 * 60;
function dateToMinutes(dateStr) {
    // dateStr: YYYY-MM-DD, local midnight, in minutes since epoch
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return Math.round(dt.getTime() / 60000);
}
function timeToMinutesOfDay(timeStr) {
    // timeStr: HH:MM or HH:MM:SS
    const [h, m] = timeStr.split(":").map(Number);
    return h * 60 + m;
}
/**
 * Convert a shift's date/start/end into an absolute minute range.
 * If end <= start, the shift is treated as crossing midnight
 * (Nachtdienst), regardless of the is_night_shift flag — the flag
 * is just a display hint, this is the actual math.
 */
export function getShiftRange(shiftDate, startTime, endTime) {
    const dayStart = dateToMinutes(shiftDate);
    const startMin = dayStart + timeToMinutesOfDay(startTime);
    let endMin = dayStart + timeToMinutesOfDay(endTime);
    const crossesMidnight = endMin <= startMin;
    if (crossesMidnight) {
        endMin += MINUTES_PER_DAY;
    }
    return { start: startMin, end: endMin, crossesMidnight };
}
export function rangesOverlap(a, b) {
    return a.start < b.end && b.start < a.end;
}
/**
 * Convert an absolute minute range back into shift_date/start_time/
 * end_time, anchored to the given original date (used after a drag
 * move/resize on the rack).
 */
export function rangeToShiftFields(range, anchorDate) {
    const anchorMinutes = dateToMinutes(anchorDate);
    const startOffsetFromAnchorDay = range.start - anchorMinutes;
    // shift_date is whatever calendar day range.start actually falls on
    const shiftDayOffset = Math.floor(startOffsetFromAnchorDay / MINUTES_PER_DAY);
    const shiftDayMinutes = anchorMinutes + shiftDayOffset * MINUTES_PER_DAY;
    const startOfDay = new Date(shiftDayMinutes * 60000);
    const shiftDateStr = formatDateISO(startOfDay);
    const startMinuteOfDay = range.start - shiftDayMinutes;
    const endMinuteOfDay = range.end - shiftDayMinutes;
    return {
        shift_date: shiftDateStr,
        start_time: minutesToTimeStr(startMinuteOfDay % MINUTES_PER_DAY),
        end_time: minutesToTimeStr(endMinuteOfDay % MINUTES_PER_DAY === 0 && endMinuteOfDay >= MINUTES_PER_DAY
            ? 0
            : endMinuteOfDay % MINUTES_PER_DAY)
    };
}
function minutesToTimeStr(totalMinutes) {
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}
function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
/**
 * Check whether a proposed shift for a membership overlaps any of
 * their OTHER shifts. Queries a 2-day window around shift_date
 * (day before/after) so night shifts that spill across midnight
 * are still caught, then does the precise overlap check client-side.
 */
export async function findShiftConflicts(organizationId, membershipId, shiftDate, startTime, endTime, excludeShiftId) {
    const dayStart = dateToMinutes(shiftDate);
    const windowStart = formatDateISO(new Date((dayStart - MINUTES_PER_DAY) * 60000));
    const windowEnd = formatDateISO(new Date((dayStart + MINUTES_PER_DAY) * 60000));
    let query = supabaseClient
        .from("shifts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("membership_id", membershipId)
        .gte("shift_date", windowStart)
        .lte("shift_date", windowEnd);
    if (excludeShiftId) {
        query = query.neq("id", excludeShiftId);
    }
    const { data, error } = await query;
    if (error || !data) {
        return { conflicts: [], error };
    }
    const proposedRange = getShiftRange(shiftDate, startTime, endTime);
    const conflicts = data.filter(existing => {
        const existingRange = getShiftRange(existing.shift_date, existing.start_time, existing.end_time);
        return rangesOverlap(proposedRange, existingRange);
    });
    return { conflicts, error: null };
}
//# sourceMappingURL=shiftAvailability.js.map