// Soll / Ist / Überstunden from APPROVED time_entries only.
import { supabase } from "./supabase";
import type { Membership, HoursSummary } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function sollHours(m: Membership, start: Date, end: Date): number {
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    return (m.weekly_target_hours / 7) * days;
}

export async function computeHours(orgId: string, m: Membership, start: Date, end: Date): Promise<HoursSummary> {

    const soll = sollHours(m, start, end);

    const { data, error } = await supabase
        .from("time_entries")
        .select("clock_in, clock_out, shifts:shift_id(break_minutes)")
        .eq("organization_id", orgId)
        .eq("membership_id", m.id)
        .eq("status", "approved")
        .gte("clock_in", start.toISOString())
        .lt("clock_in", new Date(end.getTime() + 86400000).toISOString());

    if (error || !data) {
        console.error(error);
        return { sollHours: round2(soll), istHours: 0, ueberstunden: round2(-soll) };
    }

    const ist = (data as any[]).reduce((sum, e) => {
        if (!e.clock_in || !e.clock_out) return sum;
        const raw = (Date.parse(e.clock_out) - Date.parse(e.clock_in)) / 60000;
        return sum + Math.max(0, raw - (e.shifts?.break_minutes ?? 0)) / 60;
    }, 0);

    return { sollHours: round2(soll), istHours: round2(ist), ueberstunden: round2(ist - soll) };
}

export function formatHours(h: number): string {
    const abs = Math.abs(h);
    const hh = Math.floor(abs);
    const mm = Math.round((abs - hh) * 60);
    return `${h < 0 ? "-" : ""}${hh}h ${String(mm).padStart(2, "0")}m`;
}
