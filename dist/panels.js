// ======================================================
// panels.ts
// Glue between the plain HTML in dienstplan.html (inline
// onclick="" handlers, same style as Hotel PMS) and the
// exported functions in dienstplan.ts / complaints.ts /
// leaveRequests.ts. Also owns the manager-only side panels:
// Approvals, Complaints, Leave Requests.
// ======================================================
import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, isManager } from "./auth.js";
import { LEAVE_TYPE_LABELS } from "./leaveRequests.js";
import { fetchComplaintEvidence, resolveComplaint } from "./complaints.js";
export function showPanel(panel) {
    ["rack", "hours", "approvals", "complaints", "leave"].forEach(p => {
        const el = document.getElementById(`${p}Panel`);
        if (el)
            el.style.display = p === panel ? "" : "none";
    });
    if (panel === "approvals")
        renderApprovalsPanel();
    if (panel === "complaints")
        renderComplaintsPanel();
    if (panel === "leave")
        renderLeavePanel();
}
export function closeModal(id) {
    const el = document.getElementById(id);
    if (el)
        el.style.display = "none";
}
function openModal(id) {
    const el = document.getElementById(id);
    if (el)
        el.style.display = "flex";
}
// ======================================================
// Check In / Check Out modals
// ======================================================
export function openCheckInModal() {
    document.getElementById("checkInNote").value = "";
    openModal("checkInModal");
}
export async function submitCheckIn() {
    const note = document.getElementById("checkInNote").value;
    closeModal("checkInModal");
    await window.dienstplan.checkIn(note);
}
export function openCheckOutModal() {
    document.getElementById("checkOutNote").value = "";
    openModal("checkOutModal");
}
export async function submitCheckOut() {
    const note = document.getElementById("checkOutNote").value;
    closeModal("checkOutModal");
    await window.dienstplan.checkOut(note);
}
// ======================================================
// Freiwunsch / Urlaub modal
// ======================================================
export function openLeaveModal(type) {
    document.getElementById("leaveType").value = type;
    document.getElementById("leaveModalTitle").innerText =
        `Request ${LEAVE_TYPE_LABELS[type]}`;
    document.getElementById("leaveDateStart").value = "";
    document.getElementById("leaveDateEnd").value = "";
    document.getElementById("leaveReason").value = "";
    openModal("leaveModal");
}
export async function submitLeaveRequestForm() {
    const type = document.getElementById("leaveType").value;
    const dateStart = document.getElementById("leaveDateStart").value;
    const dateEnd = document.getElementById("leaveDateEnd").value;
    const reason = document.getElementById("leaveReason").value;
    if (!dateStart || !dateEnd)
        return;
    closeModal("leaveModal");
    await window.dienstplan.requestLeave(type, dateStart, dateEnd, reason);
}
// ======================================================
// Complaint modal (opened from an approvals-panel entry)
// ======================================================
export function openComplaintModal(entryId) {
    document.getElementById("complaintEntryId").value = entryId;
    document.getElementById("complaintMessage").value = "";
    document.getElementById("complaintEvidence").value = "";
    openModal("complaintModal");
}
export async function submitComplaintForm() {
    const entryId = document.getElementById("complaintEntryId").value;
    const message = document.getElementById("complaintMessage").value;
    const fileInput = document.getElementById("complaintEvidence");
    const files = fileInput.files ? Array.from(fileInput.files) : [];
    if (!message.trim())
        return;
    closeModal("complaintModal");
    await window.dienstplan.submitComplaint(entryId, message, files);
}
// ======================================================
// Manual time edit modal (manager only)
// ======================================================
export function openManualEditModal(entryId, clockIn, clockOut) {
    document.getElementById("manualEditEntryId").value = entryId;
    document.getElementById("manualClockIn").value = clockIn ? toLocalInputValue(clockIn) : "";
    document.getElementById("manualClockOut").value = clockOut ? toLocalInputValue(clockOut) : "";
    document.getElementById("manualEditNote").value = "";
    openModal("manualEditModal");
}
function toLocalInputValue(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export async function submitManualEdit() {
    const entryId = document.getElementById("manualEditEntryId").value;
    const clockInLocal = document.getElementById("manualClockIn").value;
    const clockOutLocal = document.getElementById("manualClockOut").value;
    const note = document.getElementById("manualEditNote").value;
    if (!clockInLocal || !clockOutLocal)
        return;
    closeModal("manualEditModal");
    await window.dienstplan.managerSetTimeEntry(entryId, new Date(clockInLocal).toISOString(), new Date(clockOutLocal).toISOString(), note);
    renderApprovalsPanel();
}
// ======================================================
// Approvals panel — pending time entries + pending shift
// change requests, in one combined queue.
// ======================================================
async function renderApprovalsPanel() {
    const list = document.getElementById("approvalsList");
    if (!list || !currentOrg || !isManager())
        return;
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
    if (!entries || entries.length === 0) {
        html += `<p style="color:#888;">Nothing pending.</p>`;
    }
    else {
        entries.forEach(entry => {
            html += renderTimeEntryCard(entry);
        });
    }
    html += "<h3>Pending Shift Change Requests</h3>";
    if (!changeRequests || changeRequests.length === 0) {
        html += `<p style="color:#888;">Nothing pending.</p>`;
    }
    else {
        changeRequests.forEach(req => {
            html += renderShiftChangeCard(req);
        });
    }
    list.innerHTML = html;
}
function renderTimeEntryCard(entry) {
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
function renderShiftChangeCard(req) {
    return `
        <div class="plan-entry-card status-pending">
            <div>
                <strong>${escapeHtml(req.memberships?.full_name ?? "Unknown")}</strong>
                <div class="plan-entry-meta">
                    Proposed: ${req.proposed_shift_date} \u00b7 ${req.proposed_start_time.slice(0, 5)}\u2013${req.proposed_end_time.slice(0, 5)}
                </div>
            </div>
            <div class="plan-entry-actions">
                <button class="btn-approve" onclick="panels.approveShiftChange('${req.id}', '${req.shift_id}')">Approve</button>
                <button class="btn-reject" onclick="panels.rejectShiftChange('${req.id}')">Reject</button>
            </div>
        </div>
    `;
}
export async function approveEntry(entryId) {
    await window.dienstplan.approveTimeEntry(entryId);
    renderApprovalsPanel();
}
export async function rejectEntry(entryId) {
    await window.dienstplan.rejectTimeEntry(entryId);
    renderApprovalsPanel();
}
export async function approveShiftChange(requestId, shiftId) {
    const { data: req } = await supabaseClient
        .from("shift_change_requests")
        .select("*")
        .eq("id", requestId)
        .single();
    if (!req)
        return;
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
export async function rejectShiftChange(requestId) {
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
async function renderComplaintsPanel() {
    const list = document.getElementById("complaintsList");
    if (!list || !currentOrg || !isManager())
        return;
    list.innerHTML = "Loading\u2026";
    const { data: complaints } = await supabaseClient
        .from("complaints")
        .select("*, memberships:membership_id(full_name), time_entries:time_entry_id(clock_in, clock_out, original_clock_in, original_clock_out)")
        .eq("organization_id", currentOrg.id)
        .order("created_at", { ascending: false });
    if (!complaints || complaints.length === 0) {
        list.innerHTML = `<p style="color:#888;">No complaints filed.</p>`;
        return;
    }
    let html = "";
    for (const c of complaints) {
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
export async function resolveComplaintPrompt(complaintId, outcome) {
    const note = window.prompt("Resolution note (visible to the employee):") ?? "";
    const error = await resolveComplaint(complaintId, outcome, note);
    if (error) {
        alert(error);
        return;
    }
    renderComplaintsPanel();
}
// ======================================================
// Leave requests panel
// ======================================================
async function renderLeavePanel() {
    const list = document.getElementById("leaveList");
    if (!list || !currentOrg || !isManager())
        return;
    list.innerHTML = "Loading\u2026";
    const { data } = await supabaseClient
        .from("leave_requests")
        .select("*, memberships:membership_id(full_name)")
        .eq("organization_id", currentOrg.id)
        .order("created_at", { ascending: false });
    if (!data || data.length === 0) {
        list.innerHTML = `<p style="color:#888;">No leave requests.</p>`;
        return;
    }
    list.innerHTML = data.map(req => `
        <div class="plan-entry-card status-${req.status}">
            <div>
                <strong>${escapeHtml(req.memberships?.full_name ?? "Unknown")}</strong> \u2014
                ${LEAVE_TYPE_LABELS[req.type]}
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
export async function reviewLeaveRequestFromPanel(requestId, approve) {
    await window.dienstplan.reviewLeave(requestId, approve);
    renderLeavePanel();
}
// ======================================================
// Small helper
// ======================================================
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}
// ======================================================
// Expose on window.panels for inline onclick="" handlers
// ======================================================
window.panels = {
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
    reviewLeaveRequest: reviewLeaveRequestFromPanel
};
window.showPanel = showPanel;
window.closeModal = closeModal;
window.openCheckInModal = openCheckInModal;
window.submitCheckIn = submitCheckIn;
window.openCheckOutModal = openCheckOutModal;
window.submitCheckOut = submitCheckOut;
window.openLeaveModal = openLeaveModal;
window.submitLeaveRequestForm = submitLeaveRequestForm;
window.submitComplaintForm = submitComplaintForm;
window.submitManualEdit = submitManualEdit;
//# sourceMappingURL=panels.js.map