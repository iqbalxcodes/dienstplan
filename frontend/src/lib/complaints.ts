// Complaint evidence lives in the private "complaint-evidence" Storage bucket,
// foldered by complaint id.
import { supabase } from "./supabase";

const BUCKET = "complaint-evidence";

export async function fileComplaint(
    orgId: string, membershipId: string, timeEntryId: string, message: string, files: File[]
): Promise<string | null> {

    const { data: complaint, error } = await supabase
        .from("complaints")
        .insert({ organization_id: orgId, time_entry_id: timeEntryId, membership_id: membershipId, message, status: "open" })
        .select()
        .single();

    if (error || !complaint) return error?.message ?? "Failed to file complaint";

    for (const file of files) {
        const safe = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
        const path = `${complaint.id}/${Date.now()}_${safe}`;

        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
        if (upErr) { console.error(upErr); continue; } // one bad file shouldn't kill the complaint

        const { error: evErr } = await supabase
            .from("complaint_evidence")
            .insert({ complaint_id: complaint.id, file_path: path, file_name: file.name });
        if (evErr) console.error(evErr);
    }

    return null;
}

export async function fetchEvidence(complaintId: string): Promise<{ id: string; file_name: string; url: string }[]> {

    const { data } = await supabase.from("complaint_evidence").select("*").eq("complaint_id", complaintId);
    if (!data) return [];

    return Promise.all(data.map(async (e: any) => {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(e.file_path, 3600);
        return { id: e.id, file_name: e.file_name, url: signed?.signedUrl ?? "" };
    }));
}
