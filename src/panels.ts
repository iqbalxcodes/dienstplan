// ======================================================
// panels.ts
// Glue between the plain HTML in dienstplan.html (inline
// onclick="" handlers, same style as Hotel PMS) and the
// exported functions in dienstplan.ts / complaints.ts /
// leaveRequests.ts. Also owns the manager-only side panels:
// Approvals, Complaints, Leave Requests.
// ======================================================

import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, currentMembership, isManager } from "./auth.js";
import type { TimeEntry, Complaint, LeaveRequest, ShiftChangeRequest } from "./types.js";
import { LEAVE_TYPE_LABELS } from "./leaveRequests.js";
import { fetchComplaintEvidence, resolveComplaint } from "./complaints.js";
import { findShiftConflicts } from "./shiftAvailability.js";

type PanelName = "rack" | "hours" | "approvals" | "complaints" | "leave";

export function showPanel(panel: PanelName): void {

    (["rack", "hours", "approvals", "complaints", "leave"] as PanelName[]).forEach(p => {
        const el = document.getElementById(`${p}Panel`);
        if(el) el.style.display = p === panel ? "" : "none";
    });

    if(panel === "approvals") renderApprovalsPanel();
    if(panel === "complaints") renderComplaintsPanel();
    if(panel === "leave") renderLeavePanel();

}

export function closeModal(id: string): void {
    const el = document.getElementById(id);
    if(el) el.style.display = "none";
}

function openModal(id: string): void {
    const el = document.getElementById(id);
    if(el) el.style.display = "flex";
}


// ======================================================
// Check In / Check Out modals
// ======================================================

export function openCheckInModal(): void {
    (document.getElementById("checkInNote") as HTMLTextAreaElement).value = "";
    openModal("checkInModal");
}

export async function submitCheckIn(): Promise<void> {
    const note = (document.getElementById("checkInNote") as HTMLTextAreaElement).value;
    closeModal("checkInModal");
    await (window as any).dienstplan.checkIn(note);
}

export function openCheckOutModal(): void {
    (document.getElementById("checkOutNote") as HTMLTextAreaElement).value = "";
    openModal("checkOutModal");
}

export async function submitCheckOut(): Promise<void> {
    const note = (document.getElementById("checkOutNote") as HTMLTextAreaElement).value;
    closeModal("checkOutModal");
    await (window as any).dienstplan.checkOut(note);
}


// ======================================================
// Freiwunsch / Urlaub modal
// ======================================================

export function openLeaveModal(type: "freiwunsch" | "urlaub"): void {

    (document.getElementById("leaveType") as HTMLInputElement).value = type;
    (document.getElementById("leaveModalTitle") as HTMLElement).innerText =
        `Request ${LEAVE_TYPE_LABELS[type]}`;
    (document.getElementById("leaveDateStart") as HTMLInputElement).value = "";
    (document.getElementById("leaveDateEnd") as HTMLInputElement).value = "";
    (document.getElementById("leaveReason") as HTMLTextAreaElement).value = "";

    openModal("leaveModal");

}

export async function submitLeaveRequestForm(): Promise<void> {

    const type = (document.getElementById("leaveType") as HTMLInputElement).value as "freiwunsch" | "urlaub";
    const dateStart = (document.getElementById("leaveDateStart") as HTMLInputElement).value;
    const dateEnd = (document.getElementById("leaveDateEnd") as HTMLInputElement).value;
    const reason = (document.getElementById("leaveReason") as HTMLTextAreaElement).value;

    if(!dateStart || !dateEnd) return;

    if(dateEnd < dateStart){
        alert("End date can't be before start date");
        return;
    }

    closeModal("leaveModal");
    await (window as any).dienstplan.requestLeave(type, dateStart, dateEnd, reason);

}


// ======================================================
// Complaint modal (opened from an approvals-panel entry)
// ======================================================

export function openComplaintModal(entryId: string): void {
    (document.getElementById("complaintEntryId") as HTMLInputElement).value = entryId;
    (document.getElementById("complaintMessage") as HTMLTextAreaElement).value = "";
    (document.getElementById("complaintEvidence") as HTMLInputElement).value = "";
    openModal("complaintModal");
}

export async function submitComplaintForm(): Promise<void> {

    const entryId = (document.getElementById("complaintEntryId") as HTMLInputElement).value;
    const message = (document.getElementById("complaintMessage") as HTMLTextAreaElement).value;
    const fileInput = document.getElementById("complaintEvidence") as HTMLInputElement;
    const files = fileInput.files ? Array.from(fileInput.files) : [];

    if(!message.trim()) return;

    closeModal("complaintModal");
    await (window as any).dienstplan.submitComplaint(entryId, message, files);

}


// ======================================================
// Manual time edit modal (manager only)
// ======================================================

export function openManualEditModal(entryId: string, clockIn: string | null, clockOut: string | null): void {

    (document.getElementById("manualEditEntryId") as HTMLInputElement).value = entryId;
    (document.getElementById("manualClockIn") as HTMLInputElement).value = clockIn ? toLocalInputValue(clockIn) : "";
    (document.getElementById("manualClockOut") as HTMLInputElement).value = clockOut ? toLocalInputValue(clockOut) : "";
    (document.getElementById("manualEditNote") as HTMLTextAreaElement).value = "";

    openModal("manualEditModal");

}

function toLocalInputValue(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function submitManualEdit(): Promise<void> {

    const entryId = (document.getElementById("manualEditEntryId") as HTMLInputElement).value;
    const clockInLocal = (document.getElementById("manualClockIn") as HTMLInputElement).value;
    const clockOutLocal = (document.getElementById("manualClockOut") as HTMLInputElement).value;
    const note = (document.getElementById("manualEditNote") as HTMLTextAreaElement).value;

    if(!clockInLocal || !clockOutLocal) return;

    closeModal("manualEditModal");

    await (window as any).dienstplan.managerSetTimeEntry(
        entryId,
        new Date(clockInLocal).toISOString(),
        new Date(clockOutLocal).toISOString(),
        note
    );

    renderApprovalsPanel();

}


// ======================================================
// Approvals panel — pending time entries + pending shift
// change requests, in one combined queue.
// ======================================================

export async function renderApprovalsPanel(): Promise<void> {

    const list = document.getElementById("approvalsList");
    if(!list || !currentOrg || !isManager()) return;

    list.innerHTML = "Loading\u2026";

    const [{ data: entries }, { data: changeRequests }] = await Promise.all([
        supabaseClient
            .from("time_entries")
            .select("*, memberships:membership_id(full_name)")
            .eq("organization_id", currentOrg.id)
            .eq("status", "pending")
            .order("created_at", { ascending: false }),
        supabaseClient
            .from("shift_change_requests")
            .select("*, memberships:requested_by_membership_id(full_name)")
            .eq("organization_id", currentOrg.id)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
    ]);

    let html = "<h3>Pending Check-in / Check-out</h3>";

    if(!entries || entries.length === 0){
        html += `<p style="color:#888;">Nothing pending.</p>`;
    } else {
        (entries as any[]).forEach(entry => {
            html += renderTimeEntryCard(entry);
        });
    }

    html += "<h3>Pending Shift Change Requests</h3>";

    if(!changeRequests || changeRequests.length === 0){
        html += `<p style="color:#888;">Nothing pending.</p>`;
    } else {
        (changeRequests as any[]).forEach(req => {
            html += renderShiftChangeCard(req);
        });
    }

    list.innerHTML = html;

}

function renderTimeEntryCard(entry: TimeEntry & { memberships: { full_name: string } }): string {

    const inLabel = entry.clock_in ? new Date(entry.clock_in).toLocaleString("de-DE") : "\u2014";
    const outLabel = entry.clock_out ? new Date(entry.clock_out).toLocaleString("de-DE") : "\u2014";

    return `
        <div class="plan-entry-card status-${entry.status}">
            <div>
                <strong>${escapeHtml(entry.memberships?.full_name ?? "Unknown")}</strong>
                <div class="plan-entry-meta">In: ${inLabel} \u00b7 Out: ${outLabel}</div>
                ${entry.employee_note ? `<div class="plan-entry-meta">Note: ${escapeHtml(entry.employee_note)}</div>` : ""}
            </div>
            <div class="plan-entry-actions">
                <button class="btn-approve" onclick="panels.approveEntry('${entry.id}')">Approve</button>
                <button onclick="panels.openManualEditModal('${entry.id}', ${entry.clock_in ? `'${entry.clock_in}'` : "null"}, ${entry.clock_out ? `'${entry.clock_out}'` : "null"})">Edit</button>
                <button class="btn-reject" onclick="panels.rejectEntry('${entry.id}')">Reject</button>
            </div>
        </div>
    `;

}

function renderShiftChangeCard(req: ShiftChangeRequest & { memberships: { full_name: string } }): string {

    return `
        <div class="plan-entry-card status-pending">
            <div>
                <strong>${escapeHtml(req.memberships?.full_name ?? "Unknown")}</strong>
                <div class="plan-entry-meta">
                    Proposed: ${req.proposed_shift_date} \u00b7 ${req.proposed_start_time.slice(0,5)}\u2013${req.proposed_end_time.slice(0,5)}
                </div>
            </div>
            <div class="plan-entry-actions">
                <button class="btn-approve" onclick="panels.approveShiftChange('${req.id}', '${req.shift_id}')">Approve</button>
                <button class="btn-reject" onclick="panels.rejectShiftChange('${req.id}')">Reject</button>
            </div>
        </div>
    `;

}

export async function approveEntry(entryId: string): Promise<void> {
    await (window as any).dienstplan.approveTimeEntry(entryId);
    renderApprovalsPanel();
}

export async function rejectEntry(entryId: string): Promise<void> {
    await (window as any).dienstplan.rejectTimeEntry(entryId);
    renderApprovalsPanel();
}

export async function approveShiftChange(requestId: string, shiftId: string): Promise<void> {

    if(!isManager()) return;

    const { data: req } = await supabaseClient
        .from("shift_change_requests")
        .select("*")
        .eq("id", requestId)
        .eq("status", "pending")
        .single();

    if(!req) return;

    // ambil membership pemilik shift untuk cek konflik
    const { data: shift } = await supabaseClient
        .from("shifts")
        .select("membership_id")
        .eq("id", shiftId)
        .single();

    if(!shift) return;

    const { conflicts, error: conflictError } = await findShiftConflicts(
        req.organization_id,
        shift.membership_id,
        req.proposed_shift_date,
        req.proposed_start_time,
        req.proposed_end_time,
        shiftId
    );

    if(conflictError){
        alert("Failed to check for conflicts");
        return;
    }

    if(conflicts.length > 0){
        alert("Cannot approve — this overlaps another shift");
        return;
    }

    await supabaseClient
        .from("shifts")
        .update({
            shift_date: req.proposed_shift_date,
            start_time: req.proposed_start_time,
            end_time: req.proposed_end_time,
            updated_at: new Date().toISOString()
        })
        .eq("id", shiftId);

    const { data: { user } } = await supabaseClient.auth.getUser();

    await supabaseClient
        .from("shift_change_requests")
        .update({ status: "approved", reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() })
        .eq("id", requestId);

    renderApprovalsPanel();
}

export async function rejectShiftChange(requestId: string): Promise<void> {

    const { data: { user } } = await supabaseClient.auth.getUser();

    await supabaseClient
        .from("shift_change_requests")
        .update({ status: "rejected", reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() })
        .eq("id", requestId);

    renderApprovalsPanel();

}


// ======================================================
// Complaints panel
// ======================================================

export async function renderComplaintsPanel(): Promise<void> {

    const list = document.getElementById("complaintsList");
    if(!list || !currentOrg || !isManager()) return;

    list.innerHTML = "Loading\u2026";

    const { data: complaints } = await supabaseClient
        .from("complaints")
        .select("*, memberships:membership_id(full_name), time_entries:time_entry_id(clock_in, clock_out, original_clock_in, original_clock_out)")
        .eq("organization_id", currentOrg.id)
        .order("created_at", { ascending: false });

    if(!complaints || complaints.length === 0){
        list.innerHTML = `<p style="color:#888;">No complaints filed.</p>`;
        return;
    }

    let html = "";

    for(const c of complaints as any[]){

        const evidence = await fetchComplaintEvidence(c.id);

        html += `
            <div class="plan-complaint-card">
                <strong>${escapeHtml(c.memberships?.full_name ?? "Unknown")}</strong>
                <span class="status-badge status-${c.status}">${c.status}</span>
                <p>${escapeHtml(c.message)}</p>
                <div class="plan-entry-meta">
                    Approved time \u2014 In: ${c.time_entries?.clock_in ? new Date(c.time_entries.clock_in).toLocaleString("de-DE") : "\u2014"},
                    Out: ${c.time_entries?.clock_out ? new Date(c.time_entries.clock_out).toLocaleString("de-DE") : "\u2014"}
                    <br>
                    Original submission \u2014 In: ${c.time_entries?.original_clock_in ? new Date(c.time_entries.original_clock_in).toLocaleString("de-DE") : "\u2014"},
                    Out: ${c.time_entries?.original_clock_out ? new Date(c.time_entries.original_clock_out).toLocaleString("de-DE") : "\u2014"}
                </div>
                <div>
                    ${evidence.map(ev => `<a href="${ev.url}" target="_blank"><img class="evidence-thumb" src="${ev.url}" alt="${escapeHtml(ev.file_name)}"></a>`).join("")}
                </div>
                ${c.status === "open" ? `
                    <div class="plan-entry-actions" style="margin-top:8px;">
                        <button class="btn-approve" onclick="panels.resolveComplaintPrompt('${c.id}', 'resolved')">Mark Resolved</button>
                        <button class="btn-reject" onclick="panels.resolveComplaintPrompt('${c.id}', 'rejected')">Reject</button>
                    </div>
                ` : (c.resolution_note ? `<div class="plan-entry-meta">Resolution: ${escapeHtml(c.resolution_note)}</div>` : "")}
            </div>
        `;

    }

    list.innerHTML = html;

}

export async function resolveComplaintPrompt(complaintId: string, outcome: "resolved" | "rejected"): Promise<void> {

    const note = window.prompt("Resolution note (visible to the employee):") ?? "";

    const error = await resolveComplaint(complaintId, outcome, note);

    if(error){
        alert(error);
        return;
    }

    renderComplaintsPanel();

}


// ======================================================
// Leave requests panel
// ======================================================

export async function renderLeavePanel(): Promise<void> {

    const list = document.getElementById("leaveList");
    if(!list || !currentOrg || !isManager()) return;

    list.innerHTML = "Loading\u2026";

    const { data } = await supabaseClient
        .from("leave_requests")
        .select("*, memberships:membership_id(full_name)")
        .eq("organization_id", currentOrg.id)
        .order("created_at", { ascending: false });

    if(!data || data.length === 0){
        list.innerHTML = `<p style="color:#888;">No leave requests.</p>`;
        return;
    }

    list.innerHTML = (data as any[]).map(req => `
        <div class="plan-entry-card status-${req.status}">
            <div>
                <strong>${escapeHtml(req.memberships?.full_name ?? "Unknown")}</strong> \u2014
                ${LEAVE_TYPE_LABELS[req.type as keyof typeof LEAVE_TYPE_LABELS]}
                <div class="plan-entry-meta">${req.date_start} \u2192 ${req.date_end}</div>
                ${req.reason ? `<div class="plan-entry-meta">${escapeHtml(req.reason)}</div>` : ""}
            </div>
            ${req.status === "pending" ? `
                <div class="plan-entry-actions">
                    <button class="btn-approve" onclick="panels.reviewLeaveRequest('${req.id}', true)">Approve</button>
                    <button class="btn-reject" onclick="panels.reviewLeaveRequest('${req.id}', false)">Reject</button>
                </div>
            ` : ""}
        </div>
    `).join("");

}

export async function reviewLeaveRequestFromPanel(requestId: string, approve: boolean): Promise<void> {
    await (window as any).dienstplan.reviewLeave(requestId, approve);
    renderLeavePanel();
}


// ======================================================
// Admin: Add Crew (membership only — the auth account itself
// is still created manually in Supabase Dashboard; pasting the
// resulting User UID here is the intended flow, see admin.html)
// ======================================================

export async function addCrewMember(): Promise<void> {

    if(!currentOrg || !isManager()) return;

    const userId = (document.getElementById("addCrewUserId") as HTMLInputElement).value.trim();
    const fullName = (document.getElementById("addCrewName") as HTMLInputElement).value.trim();
    const role = (document.getElementById("addCrewRole") as HTMLSelectElement).value;
    const weeklyHours = Number((document.getElementById("addCrewHours") as HTMLInputElement).value) || 40;

    if(!userId || !fullName) return;

    const { error } = await supabaseClient
        .from("memberships")
        .insert({
            organization_id: currentOrg.id,
            user_id: userId,
            role,
            full_name: fullName,
            weekly_target_hours: weeklyHours
        });

    if(error){
        alert(error.message);
        return;
    }

    (document.getElementById("addCrewUserId") as HTMLInputElement).value = "";
    (document.getElementById("addCrewName") as HTMLInputElement).value = "";

    renderCrewList();

}

export async function renderCrewList(): Promise<void> {

    const list = document.getElementById("crewList");
    if(!list || !currentOrg || !isManager()) return;

    const { data } = await supabaseClient
        .from("memberships")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .order("full_name");

    list.innerHTML = (data ?? []).map((m: any) => `
        <div class="plan-entry-card">
            <div><strong>${escapeHtml(m.full_name)}</strong> \u2014 ${m.role}</div>
            <div class="plan-entry-meta">${m.active ? "active" : "inactive"} \u00b7 ${m.weekly_target_hours}h/week</div>
        </div>
    `).join("");

}


// ======================================================
// Small helper
// ======================================================

function escapeHtml(str: string | null | undefined): string {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}


// ======================================================
// Expose on window.panels for inline onclick="" handlers
// ======================================================

(window as any).panels = {
    showPanel,
    closeModal,
    openCheckInModal,
    submitCheckIn,
    openCheckOutModal,
    submitCheckOut,
    openLeaveModal,
    submitLeaveRequestForm,
    openComplaintModal,
    submitComplaintForm,
    openManualEditModal,
    submitManualEdit,
    approveEntry,
    rejectEntry,
    approveShiftChange,
    rejectShiftChange,
    resolveComplaintPrompt,
    reviewLeaveRequest: reviewLeaveRequestFromPanel,
    addCrewMember,
    renderCrewList,
    renderMyEntries
};

// ======================================================
// Employee: My Entries (dashboard.html) — lists own time
// entries + lets them file a complaint on a non-pending one.
// ======================================================

export async function renderMyEntries(): Promise<void> {

    const list = document.getElementById("myEntriesList");
    if(!list || !currentOrg || !currentMembership) return;

    const { data } = await supabaseClient
        .from("time_entries")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .eq("membership_id", currentMembership.id)
        .order("created_at", { ascending: false })
        .limit(10);

    if(!data || data.length === 0){
        list.innerHTML = `<p style="color:#888;">No entries yet.</p>`;
        return;
    }

    list.innerHTML = (data as any[]).map(entry => `
        <div class="plan-entry-card status-${entry.status}">
            <div>
                <span class="status-badge status-${entry.status}">${entry.status}</span>
                <div class="plan-entry-meta">
                    In: ${entry.clock_in ? new Date(entry.clock_in).toLocaleString("de-DE") : "\u2014"} \u00b7
                    Out: ${entry.clock_out ? new Date(entry.clock_out).toLocaleString("de-DE") : "\u2014"}
                </div>
                ${entry.manager_note ? `<div class="plan-entry-meta">Manager note: ${escapeHtml(entry.manager_note)}</div>` : ""}
            </div>
            ${entry.status !== "pending" ? `
                <div class="plan-entry-actions">
                    <button onclick="panels.openComplaintModal('${entry.id}')">File Complaint</button>
                </div>
            ` : ""}
        </div>
    `).join("");

}

// Bare-name shortcuts so inline onclick="" handlers work
Object.assign(window as any, {
    closeModal,
    openCheckInModal,
    submitCheckIn,
    openCheckOutModal,
    submitCheckOut,
    openLeaveModal,
    submitLeaveRequestForm,
    openComplaintModal,
    submitComplaintForm,
    openManualEditModal,
    submitManualEdit
});