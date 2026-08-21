// ======================================================
// complaints.ts
// Lets an employee protest a manager-edited time entry and
// attach supporting evidence (a photo, screenshot, PDF...).
// Evidence goes to the "complaint-evidence" Storage bucket,
// scoped by complaint id so files can't be guessed/enumerated.
// ======================================================
import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, currentMembership, isManager } from "./auth.js";
const EVIDENCE_BUCKET = "complaint-evidence";
export async function fileComplaint(timeEntryId, message, evidenceFiles) {
    if (!currentOrg || !currentMembership) {
        return "Not logged in";
    }
    const { data: complaint, error } = await supabaseClient
        .from("complaints")
        .insert({
        organization_id: currentOrg.id,
        time_entry_id: timeEntryId,
        membership_id: currentMembership.id,
        message,
        status: "open"
    })
        .select()
        .single();
    if (error || !complaint) {
        return error?.message ?? "Failed to file complaint";
    }
    for (const file of evidenceFiles) {
        const path = `${complaint.id}/${Date.now()}_${file.name}`;
        const { error: uploadError } = await supabaseClient
            .storage
            .from(EVIDENCE_BUCKET)
            .upload(path, file);
        if (uploadError) {
            console.error("Evidence upload failed:", uploadError);
            continue;
        }
        await supabaseClient
            .from("complaint_evidence")
            .insert({
            complaint_id: complaint.id,
            file_path: path,
            file_name: file.name
        });
    }
    return null;
}
export async function fetchComplaints(onlyMine = false) {
    if (!currentOrg)
        return [];
    let query = supabaseClient
        .from("complaints")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .order("created_at", { ascending: false });
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
export async function fetchComplaintEvidence(complaintId) {
    const { data, error } = await supabaseClient
        .from("complaint_evidence")
        .select("*")
        .eq("complaint_id", complaintId);
    if (error || !data) {
        return [];
    }
    return Promise.all(data.map(async (item) => {
        const { data: signed } = await supabaseClient
            .storage
            .from(EVIDENCE_BUCKET)
            .createSignedUrl(item.file_path, 3600);
        return { ...item, url: signed?.signedUrl ?? "" };
    }));
}
export async function resolveComplaint(complaintId, outcome, resolutionNote) {
    if (!isManager()) {
        return "Only a manager can resolve complaints";
    }
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient
        .from("complaints")
        .update({
        status: outcome,
        resolution_note: resolutionNote,
        resolved_by: user?.id ?? null,
        resolved_at: new Date().toISOString()
    })
        .eq("id", complaintId);
    return error ? error.message : null;
}
//# sourceMappingURL=complaints.js.map