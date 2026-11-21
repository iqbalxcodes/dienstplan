// Roster helpers: shift presets, month grid, and DB writes that survive a missing migration 001.
import { supabase } from "./supabase";
import { addDays, startOfMonth } from "./dates";
import type { Membership, OrganizationSettings, Shift, ShiftDraft, ShiftType } from "./types";

export const DEFAULT_SHIFT_TYPES: ShiftType[] = [
    { code: "FS", name: "Frühschicht", color: "#17a53a", kind: "work", start: "06:30", end: "15:00" },
    { code: "M", name: "Büro", color: "#b8c400", kind: "work", start: "09:00", end: "17:30" },
    { code: "F", name: "Frei", color: "#9ca3af", kind: "off" },
    { code: "U", name: "Urlaub", color: "#a855f7", kind: "off" },
    { code: "Schule", name: "Schule", color: "#3b82f6", kind: "off" }
];

export const NO_CODE_COLOR = "#5b6b86";
// "off" shifts (U, Sch) occupy the whole day; shifts.start/end_time are NOT NULL
export const OFF_START = "00:00:00";
export const OFF_END = "23:59:00";

export const shiftTypesOf = (s?: OrganizationSettings) => (s?.shift_types?.length ? s.shift_types : DEFAULT_SHIFT_TYPES);
export const isOff = (t?: ShiftType) => t?.kind === "off";
export const lastName = (m?: Membership | null) => m?.full_name.trim().split(/\s+/).pop() ?? "?";

/** Manager view of a shift: pending (unpublished) changes applied on top. */
export const viewOf = (s: Shift): Shift => (s.draft && !s.draft._delete ? ({ ...s, ...s.draft } as Shift) : s);

/** Park a change on a published shift until Publish. Returns an error message or null. */
export async function setDraft(id: string, draft: ShiftDraft | null): Promise<string | null> {
    const { error } = await supabase.from("shifts").update({ draft }).eq("id", id);
    if (!error) return null;
    return error.code === "PGRST204" ? "Run backend/sql/003_shift_drafts.sql first (needed to edit published shifts)." : error.message;
}

export interface RosterForm {
    date: string;
    membershipId: string;
    code: string;
    area: string;
    role: string;
    start: string;   // HH:MM
    end: string;
}

/** Monday-first weeks covering the month. */
export function buildWeeks(month: Date): Date[][] {
    const first = startOfMonth(month);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const start = addDays(first, -lead);
    return Array.from({ length: Math.ceil((lead + days) / 7) }, (_, w) =>
        Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

// PGRST204 = column not in schema cache (migration 001 not applied yet) -> retry without the new columns
const strip = (o: Record<string, unknown>) => {
    const { shift_code: _c, area_label: _a, ...rest } = o;
    return rest;
};

export async function insertShifts(rows: Record<string, unknown>[]) {
    let r = await supabase.from("shifts").insert(rows).select();
    if (r.error?.code === "PGRST204") r = await supabase.from("shifts").insert(rows.map(strip)).select();
    return r;
}

export async function updateShift(id: string, patch: Record<string, unknown>) {
    let r = await supabase.from("shifts").update(patch).eq("id", id);
    if (r.error?.code === "PGRST204") r = await supabase.from("shifts").update(strip(patch)).eq("id", id);
    return r.error;
}