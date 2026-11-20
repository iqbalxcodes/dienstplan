// Shared shift write paths for rack + month view.
// Manager: writes `shifts` directly (after conflict check).
// Employee: inserts a `shift_change_requests` row; the shift only changes once a manager approves.
import { useAuth } from "./auth";
import { useStatus } from "./status";
import { supabase } from "./supabase";
import { findShiftConflicts } from "./shifts";

export interface ShiftFields { shift_date: string; start_time: string; end_time: string; role_label?: string; }

export function useShiftEdit(reload: () => void | Promise<void>) {

    const { org, me, isManager } = useAuth();
    const { say } = useStatus();

    async function apply(shiftId: string, membershipId: string, f: ShiftFields) {

        const { conflicts, error: cErr } = await findShiftConflicts(
            org!.id, membershipId, f.shift_date, f.start_time, f.end_time, shiftId);

        if (cErr) { say("Failed to check for conflicts", "error"); return reload(); }
        if (conflicts.length) { say("This staff member already has an overlapping shift", "error"); return reload(); }

        const { data: { user } } = await supabase.auth.getUser();

        const { error } = await supabase.from("shifts").update({
            shift_date: f.shift_date, start_time: f.start_time, end_time: f.end_time,
            ...(f.role_label ? { role_label: f.role_label } : {}),
            updated_by: user?.id ?? null
        }).eq("id", shiftId);

        if (error) { console.error(error); say("Failed to update shift", "error"); }
        else say("Shift updated", "success");
        await reload();
    }

    async function propose(shiftId: string, f: ShiftFields) {

        // shift_change_requests has no role column: role edits are manager-only
        const { error } = await supabase.from("shift_change_requests").insert({
            organization_id: org!.id,
            shift_id: shiftId,
            requested_by_membership_id: me!.id,
            proposed_shift_date: f.shift_date,
            proposed_start_time: f.start_time,
            proposed_end_time: f.end_time
        });

        if (error) { console.error(error); say("Failed to submit change request", "error"); }
        else say("Change requested — waiting for manager approval", "success");
        await reload();
    }

    const save = (shiftId: string, ownerId: string, f: ShiftFields) =>
        isManager ? apply(shiftId, ownerId, f) : propose(shiftId, f);

    async function create(membershipId: string, date: string, start: string, end: string, role: string) {

        if (!isManager) return;

        const { conflicts, error: cErr } = await findShiftConflicts(org!.id, membershipId, date, start, end);
        if (cErr) { say("Failed to check for conflicts", "error"); return; }
        if (conflicts.length) { say("This staff member already has an overlapping shift", "error"); return; }

        const { data: { user } } = await supabase.auth.getUser();

        const { error } = await supabase.from("shifts").insert({
            organization_id: org!.id, membership_id: membershipId, shift_date: date,
            start_time: start, end_time: end, role_label: role, updated_by: user?.id ?? null
        });

        if (error) { console.error(error); say("Failed to create shift", "error"); return; }
        say("Shift added", "success");
        await reload();
    }

    return { save, create };
}
