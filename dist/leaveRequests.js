// ======================================================
// leaveRequests.ts
// Freiwunsch (preferred day off) and Urlaub (vacation), plus
// Sick as a bonus. All three share the same request/approve
// shape as time entries: employee submits -> pending ->
// manager approves/rejects.
// ======================================================
import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, currentMembership, isManager } from "./auth.js";
export async function submitLeaveRequest(type, dateStart, dateEnd, reason) {
    if (!currentOrg || !currentMembership) {
        return "Not logged in";
    }
    const { error } = await supabaseClient
        .from("leave_requests")
        .insert({
        organization_id: currentOrg.id,
        membership_id: currentMembership.id,
        type,
        date_start: dateStart,
        date_end: dateEnd,
        reason,
        status: "pending"
    });
    return error ? error.message : null;
}
export async function fetchLeaveRequests(dateStart, dateEnd, onlyMine = false) {
    if (!currentOrg)
        return [];
    let query = supabaseClient
        .from("leave_requests")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .lte("date_start", dateEnd)
        .gte("date_end", dateStart)
        .order("date_start", { ascending: true });
    if (onlyMine && currentMembership) {
        query = query.eq("membership_id", currentMembership.id);
    }
    const { data, error } = await query;
    if (error) {
        console.error(error);
        return [];
    }
    return data;
}
export async function reviewLeaveRequest(requestId, approve) {
    if (!isManager()) {
        return "Only a manager can review leave requests";
    }
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient
        .from("leave_requests")
        .update({
        status: approve ? "approved" : "rejected",
        reviewed_by: user?.id ?? null,
        reviewed_at: new Date().toISOString()
    })
        .eq("id", requestId);
    return error ? error.message : null;
}
export const LEAVE_TYPE_LABELS = {
    freiwunsch: "Freiwunsch",
    urlaub: "Urlaub",
    sick: "Krank"
};
//# sourceMappingURL=leaveRequests.js.map