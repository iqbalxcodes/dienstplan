// ======================================================
// dienstplan.ts
// Dienstplan / staff shift rack (Gantt-style timeline).
// Each day is a single column by default. If an organization
// turns on `settings.half_day_mode`, a day splits into AM/PM
// halves — same idea as Hotel PMS's room rack, but OFF by
// default here since most restaurants don't need it; a
// Nachtdienst (night shift) is instead handled by letting a
// shift's end_time roll past midnight (see shiftAvailability.ts),
// not by a half-day split.
//
// Conflict detection & date-range math is handled by
// ShiftAvailability (shiftAvailability.ts — must be imported
// BEFORE any conflict check in this file).
// ======================================================
import { supabaseClient } from "./supabaseClient.js";
import { currentOrg, currentMembership, isManager, isLoggedIn, applyAuthVisibility, renderUserArea } from "./auth.js";
import { getShiftRange, rangeToShiftFields, findShiftConflicts } from "./shiftAvailability.js";
import { computeHoursSummary, formatHours } from "./hoursCalculator.js";
import { renderNavigation } from "./nav.js";
import { renderApprovalsPanel, renderComplaintsPanel, renderLeavePanel, renderCrewList, renderMyEntries } from "./panels.js";
import { submitLeaveRequest, fetchLeaveRequests, reviewLeaveRequest, LEAVE_TYPE_LABELS } from "./leaveRequests.js";
import { fileComplaint } from "./complaints.js";
const PLAN_VIEW_MODE_KEY = "dienstplan_view_mode_v1";
const DOW_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTH_LABELS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
// planViewMode: "auto" (responsive: 3 days on phone, 7 on
// tablet, up to a month on wide screens) or a forced "3" / "7" / "30"
let planViewMode = loadPlanViewMode();
let planStartDate = startOfToday();
let planSelectedDate = startOfToday();
let planDayCount = getPlanDayCount();
// Data caches for the current window, refreshed by refreshPlan()
let planMembers = [];
let planShifts = [];
let planTimeEntries = [];
let planLeaveRequests = [];
let planDragState = null;
// ======================================================
// Date helpers (local-midnight based, same as roomRack.js)
// ======================================================
function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}
function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}
function diffDays(a, b) {
    return Math.round((a.getTime() - b.getTime()) / 86400000);
}
function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}
// ======================================================
// Responsive day count — phone defaults to 3 days
// (yesterday / today / tomorrow) with ◀ ▶ to page one day
// at a time; tablet width fits ~7; wide desktop can show a
// full month. Forced modes ("3"/"7"/"30") override this.
// ======================================================
function getPlanDayCount() {
    if (planViewMode !== "auto") {
        return Number(planViewMode);
    }
    const width = window.innerWidth;
    if (width <= 700)
        return 3;
    if (width <= 1100)
        return 7;
    if (width <= 1700)
        return 14;
    return 30;
}
function getPlanColWidth(dayCount) {
    const width = window.innerWidth;
    if (width <= 700)
        return Math.floor((width - 128) / Math.max(1, dayCount));
    if (width <= 1100)
        return 96;
    if (width <= 1700)
        return 76;
    return 60;
}
function loadPlanViewMode() {
    return localStorage.getItem(PLAN_VIEW_MODE_KEY) || "auto";
}
export function planSetViewMode(mode) {
    planViewMode = mode;
    localStorage.setItem(PLAN_VIEW_MODE_KEY, mode);
    updatePlanViewModeButtons();
    refreshPlan();
}
function updatePlanViewModeButtons() {
    document.querySelectorAll(".rack-view-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === planViewMode);
    });
}
// ======================================================
// Data fetching
// ======================================================
async function fetchPlanMembers() {
    if (!currentOrg)
        return [];
    const { data, error } = await supabaseClient
        .from("memberships")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .eq("active", true)
        .order("full_name", { ascending: true });
    if (error) {
        console.error(error);
        showMessage("Failed to load staff", "error");
        return [];
    }
    return data;
}
async function fetchPlanShifts(rangeStart, rangeEnd) {
    if (!currentOrg)
        return [];
    const { data, error } = await supabaseClient
        .from("shifts")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .gte("shift_date", formatDateISO(rangeStart))
        .lte("shift_date", formatDateISO(rangeEnd));
    if (error) {
        console.error(error);
        showMessage("Failed to load shifts", "error");
        return [];
    }
    return data;
}
async function fetchPlanTimeEntries(rangeStart, rangeEnd) {
    if (!currentOrg)
        return [];
    const { data, error } = await supabaseClient
        .from("time_entries")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .gte("clock_in", rangeStart.toISOString())
        .lte("clock_in", addDays(rangeEnd, 1).toISOString());
    if (error) {
        console.error(error);
        return [];
    }
    return data;
}
function shiftsForMember(membershipId) {
    return planShifts.filter(s => s.membership_id === membershipId);
}
function pendingEntriesForMember(membershipId) {
    return planTimeEntries.filter(e => e.membership_id === membershipId && e.status === "pending");
}
// ======================================================
// Rendering — header
// ======================================================
function renderPlanHeader(days, dayWidth) {
    const today = startOfToday();
    const row = document.getElementById("rackHeaderRow");
    if (!row)
        return;
    let html = `
        <div class="rack-header-label">
            <span>STAFF</span>
            <button class="rack-nav-btn rack-nav-prev" onclick="dienstplan.changeDate(-1)" title="Previous">\u25c0</button>
        </div>
    `;
    days.forEach(d => {
        const isToday = isSameDay(d, today);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        html += `
            <div class="rack-header-cell ${isToday ? "is-today" : ""} ${isWeekend ? "is-weekend" : ""}"
                 style="width:${dayWidth}px">
                <div class="rack-header-dow">${DOW_LABELS[d.getDay()]}</div>
                <div class="rack-header-date">${String(d.getDate()).padStart(2, "0")} ${MONTH_LABELS[d.getMonth()]}</div>
            </div>
        `;
    });
    html += `
        <div class="rack-header-end">
            <button class="rack-nav-btn" onclick="dienstplan.changeDate(1)" title="Next">\u25b6</button>
        </div>
    `;
    row.innerHTML = html;
}
// ======================================================
// Rendering — shift bars + leave bars for one member row
// ======================================================
function buildShiftBarsHTML(member, days, dayWidth, dayCount) {
    const rangeStart = getShiftRange(formatDateISO(days[0]), "00:00", "00:00").start;
    const rangeEndExclusive = getShiftRange(formatDateISO(days[dayCount - 1]), "00:00", "00:00").start + 1440;
    let html = "";
    shiftsForMember(member.id).forEach(shift => {
        const range = getShiftRange(shift.shift_date, shift.start_time, shift.end_time);
        const clampStart = Math.max(range.start, rangeStart);
        const clampEnd = Math.min(range.end, rangeEndExclusive);
        if (clampEnd <= clampStart)
            return;
        const pxPerMinute = dayWidth / 1440;
        const left = (clampStart - rangeStart) * pxPerMinute + 3;
        const width = (clampEnd - clampStart) * pxPerMinute - 6;
        const cutLeft = range.start < rangeStart;
        const cutRight = range.end > rangeEndExclusive;
        const meta = [
            shift.role_label,
            `${shift.start_time.slice(0, 5)}\u2013${shift.end_time.slice(0, 5)}`,
            shift.is_night_shift ? "Nachtdienst" : null
        ].filter(Boolean).join(" \u00b7 ");
        const canDrag = isLoggedIn() && (isManager() || member.id === currentMembership?.id);
        html += `
            <div class="reservation-bar plan-shift-bar ${cutLeft ? "cut-left" : ""} ${cutRight ? "cut-right" : ""}"
                 style="left:${left}px; width:${width}px; top:2px; height:calc(100% - 4px);"
                 title="${escapeAttr(member.full_name)} \u00b7 ${meta}"
                 data-shift-id="${shift.id}"
                 data-membership-id="${member.id}"
                 data-shift-date="${shift.shift_date}"
                 data-start-time="${shift.start_time}"
                 data-end-time="${shift.end_time}">
                ${canDrag && !cutLeft ? `<div class="bar-resize-handle left"></div>` : ""}
                <span class="bar-guest">${escapeAttr(member.full_name)}</span>
                <span class="bar-meta">${escapeAttr(meta)}</span>
                ${canDrag && !cutRight ? `<div class="bar-resize-handle right"></div>` : ""}
            </div>
        `;
    });
    return html;
}
function buildLeaveBarsHTML(member, days, dayWidth) {
    let html = "";
    const relevant = planLeaveRequests.filter(l => l.membership_id === member.id);
    relevant.forEach(leave => {
        const start = parseDateOnly(leave.date_start);
        const end = parseDateOnly(leave.date_end);
        days.forEach((d, i) => {
            if (d >= start && d <= end) {
                const statusClass = `leave-status-${leave.status}`;
                const typeClass = `leave-type-${leave.type}`;
                html += `
                    <div class="plan-leave-chip ${statusClass} ${typeClass}"
                         style="left:${i * dayWidth + 3}px; width:${dayWidth - 6}px;"
                         title="${escapeAttr(LEAVE_TYPE_LABELS[leave.type])} \u00b7 ${leave.status}">
                        ${escapeAttr(LEAVE_TYPE_LABELS[leave.type])}
                    </div>
                `;
            }
        });
    });
    return html;
}
function parseDateOnly(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
}
function escapeAttr(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}
// ======================================================
// Rendering — body (one row per staff member)
// ======================================================
function renderPlanBody(days, dayWidth, dayCount) {
    const body = document.getElementById("rackBody");
    if (!body)
        return;
    let html = "";
    planMembers.forEach(member => {
        const pending = pendingEntriesForMember(member.id);
        html += `
            <div class="rack-row plan-row" data-membership-id="${member.id}">

                <div class="rack-room-label">
                    ${pending.length > 0 ? `<span class="rack-conflict-flag" title="${pending.length} pending approval">\u26a0</span>` : ""}
                    <span class="rack-room-number">${escapeAttr(member.full_name)}</span>
                    ${member.id === currentMembership?.id ? `<span class="rack-status-dot status-clean" title="You">\u25cf</span>` : ""}
                </div>

                <div class="rack-timeline" style="width:${dayWidth * dayCount}px;">
                    ${buildTimelineCellsHTML(days, dayWidth)}
                    <div class="rack-bars-layer" style="width:${dayWidth * dayCount}px;">
                        ${buildShiftBarsHTML(member, days, dayWidth, dayCount)}
                        ${buildLeaveBarsHTML(member, days, dayWidth)}
                    </div>
                </div>

            </div>
        `;
    });
    body.innerHTML = html || `<div style="padding:16px; color:#888;">No staff found</div>`;
}
function buildTimelineCellsHTML(days, dayWidth) {
    let html = "";
    days.forEach(d => {
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        html += `
            <div class="rack-cell ${isWeekend ? "is-weekend" : ""}" style="width:${dayWidth}px"></div>
        `;
    });
    return html;
}
// ======================================================
// Check-in / Check-out
// A click always creates a PENDING time_entry — never writes
// directly to an "approved" state, even for a manager clicking
// their own check-in. Managers approve/adjust separately so
// there's always a clean audit trail.
// ======================================================
export async function checkIn(note = "") {
    if (!currentOrg || !currentMembership) {
        showMessage("Please log in first", "error");
        return;
    }
    const { error } = await supabaseClient
        .from("time_entries")
        .insert({
        organization_id: currentOrg.id,
        membership_id: currentMembership.id,
        clock_in: new Date().toISOString(),
        original_clock_in: new Date().toISOString(),
        source: "employee",
        status: "pending",
        employee_note: note || null
    });
    if (error) {
        console.error(error);
        showMessage("Check-in failed", "error");
        return;
    }
    showMessage("Check-in submitted — waiting for manager approval", "success");
    await refreshPlan();
}
export async function checkOut(note = "") {
    if (!currentOrg || !currentMembership) {
        showMessage("Please log in first", "error");
        return;
    }
    // find the most recent open (no clock_out) entry for this person
    const { data: openEntry } = await supabaseClient
        .from("time_entries")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .eq("membership_id", currentMembership.id)
        .is("clock_out", null)
        .order("clock_in", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (openEntry) {
        const { error } = await supabaseClient
            .from("time_entries")
            .update({
            clock_out: new Date().toISOString(),
            original_clock_out: new Date().toISOString(),
            employee_note: note ? `${openEntry.employee_note ?? ""} ${note}`.trim() : openEntry.employee_note,
            status: "pending", // re-flag as pending since it changed
            updated_at: new Date().toISOString()
        })
            .eq("id", openEntry.id);
        if (error) {
            console.error(error);
            showMessage("Check-out failed", "error");
            return;
        }
    }
    else {
        // no open entry found — e.g. employee forgot to check in earlier.
        // Submit a standalone check-out request with a note explaining it,
        // for the manager to reconcile manually.
        const { error } = await supabaseClient
            .from("time_entries")
            .insert({
            organization_id: currentOrg.id,
            membership_id: currentMembership.id,
            clock_out: new Date().toISOString(),
            original_clock_out: new Date().toISOString(),
            source: "employee",
            status: "pending",
            employee_note: note || "No matching check-in found — please set my start time manually"
        });
        if (error) {
            console.error(error);
            showMessage("Check-out failed", "error");
            return;
        }
    }
    showMessage("Check-out submitted — waiting for manager approval", "success");
    await refreshPlan();
}
// ======================================================
// Manager: approve / manually set a time entry
// ======================================================
export async function approveTimeEntry(entryId, managerNote = "") {
    if (!isManager())
        return;
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient
        .from("time_entries")
        .update({
        status: "approved",
        manager_note: managerNote || null,
        approved_by: user?.id ?? null,
        approved_at: new Date().toISOString()
    })
        .eq("id", entryId);
    if (error) {
        console.error(error);
        showMessage("Failed to approve", "error");
        return;
    }
    showMessage("Time entry approved", "success");
    await refreshPlan();
}
export async function managerSetTimeEntry(entryId, clockIn, clockOut, managerNote) {
    if (!isManager())
        return;
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient
        .from("time_entries")
        .update({
        clock_in: clockIn,
        clock_out: clockOut,
        source: "manager",
        status: "approved",
        manager_note: managerNote || null,
        approved_by: user?.id ?? null,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    })
        .eq("id", entryId);
    if (error) {
        console.error(error);
        showMessage("Failed to update time entry", "error");
        return;
    }
    showMessage("Time entry updated by manager", "success");
    await refreshPlan();
}
export async function rejectTimeEntry(entryId, managerNote = "") {
    if (!isManager())
        return;
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient
        .from("time_entries")
        .update({
        status: "rejected",
        manager_note: managerNote || null,
        approved_by: user?.id ?? null,
        approved_at: new Date().toISOString()
    })
        .eq("id", entryId);
    if (error) {
        console.error(error);
        showMessage("Failed to reject", "error");
        return;
    }
    showMessage("Time entry rejected", "info");
    await refreshPlan();
}
// ======================================================
// Employee complaint against a manager-edited entry
// ======================================================
export async function submitComplaint(entryId, message, files) {
    const error = await fileComplaint(entryId, message, files);
    if (error) {
        showMessage(error, "error");
        return;
    }
    showMessage("Complaint filed — a manager will review it", "success");
}
// ======================================================
// Freiwunsch / Urlaub
// ======================================================
export async function requestLeave(type, dateStart, dateEnd, reason) {
    const error = await submitLeaveRequest(type, dateStart, dateEnd, reason);
    if (error) {
        showMessage(error, "error");
        return;
    }
    showMessage(`${LEAVE_TYPE_LABELS[type]} request submitted`, "success");
    await refreshPlan();
}
export async function reviewLeave(requestId, approve) {
    const error = await reviewLeaveRequest(requestId, approve);
    if (error) {
        showMessage(error, "error");
        return;
    }
    showMessage(approve ? "Leave approved" : "Leave rejected", "success");
    await refreshPlan();
}
// ======================================================
// Drag & Drop on shift bars
// - Manager drag -> writes directly to `shifts` (after a
//   conflict check), same as roomRack.js's move/resize.
// - Employee drag -> writes a `shift_change_requests` row
//   instead, and the bar visually reverts until a manager
//   approves it.
// ======================================================
export function setupPlanDragAndDrop() {
    const body = document.getElementById("rackBody");
    if (!body)
        return;
    body.addEventListener("mousedown", handlePlanMouseDown);
}
function handlePlanMouseDown(e) {
    const target = e.target;
    const bar = target.closest(".plan-shift-bar");
    if (!bar || !isLoggedIn())
        return;
    e.preventDefault();
    const handle = target.closest(".bar-resize-handle");
    const type = handle
        ? (handle.classList.contains("left") ? "resize-left" : "resize-right")
        : "move";
    const dayWidth = getPlanColWidth(planDayCount);
    const shiftDate = bar.dataset.shiftDate;
    const startTime = bar.dataset.startTime;
    const endTime = bar.dataset.endTime;
    const range = getShiftRange(shiftDate, startTime, endTime);
    planDragState = {
        type,
        shiftId: bar.dataset.shiftId,
        membershipId: bar.dataset.membershipId,
        ownerId: bar.dataset.membershipId,
        range,
        anchorDate: shiftDate,
        startX: e.clientX,
        barEl: bar,
        originLeft: parseFloat(bar.style.left),
        originWidth: parseFloat(bar.style.width),
        dayWidth,
        moved: false,
        ghostEl: null
    };
    if (type === "move") {
        const rect = bar.getBoundingClientRect();
        const ghost = bar.cloneNode(true);
        ghost.classList.add("rack-drag-ghost");
        ghost.style.position = "fixed";
        ghost.style.left = "0px";
        ghost.style.top = "0px";
        ghost.style.width = planDragState.originWidth + "px";
        ghost.style.height = rect.height + "px";
        ghost.style.pointerEvents = "none";
        document.body.appendChild(ghost);
        planDragState.ghostEl = ghost;
        positionPlanGhost(e);
    }
    document.addEventListener("mousemove", handlePlanMouseMove);
    document.addEventListener("mouseup", handlePlanMouseUp);
}
function positionPlanGhost(e) {
    if (!planDragState?.ghostEl)
        return;
    planDragState.ghostEl.style.transform =
        `translate(${e.clientX - planDragState.originWidth / 2}px, ${e.clientY - 16}px)`;
}
function handlePlanMouseMove(e) {
    if (!planDragState)
        return;
    const dx = e.clientX - planDragState.startX;
    if (Math.abs(dx) > 4) {
        planDragState.moved = true;
    }
    if (planDragState.type === "move") {
        positionPlanGhost(e);
        document.querySelectorAll(".plan-row.drag-target-row")
            .forEach(el => el.classList.remove("drag-target-row"));
        const rowEl = document.elementFromPoint(e.clientX, e.clientY)?.closest(".plan-row");
        rowEl?.classList.add("drag-target-row");
        return;
    }
    // Resize: snap to 15-minute increments
    const snapPx = planDragState.dayWidth / 96; // 1440min/15min = 96 steps per day
    const deltaSteps = Math.round(dx / snapPx);
    const bar = planDragState.barEl;
    if (planDragState.type === "resize-left") {
        const newLeft = planDragState.originLeft + deltaSteps * snapPx;
        const newWidth = planDragState.originWidth - deltaSteps * snapPx;
        if (newWidth < snapPx * 2)
            return;
        bar.style.left = newLeft + "px";
        bar.style.width = newWidth + "px";
    }
    else {
        const newWidth = planDragState.originWidth + deltaSteps * snapPx;
        if (newWidth < snapPx * 2)
            return;
        bar.style.width = newWidth + "px";
    }
}
async function handlePlanMouseUp(e) {
    document.removeEventListener("mousemove", handlePlanMouseMove);
    document.removeEventListener("mouseup", handlePlanMouseUp);
    if (!planDragState)
        return;
    const state = planDragState;
    planDragState = null;
    document.querySelectorAll(".plan-row.drag-target-row")
        .forEach(el => el.classList.remove("drag-target-row"));
    state.ghostEl?.remove();
    if (!state.moved) {
        // treat as a click -> could open a shift detail modal here
        return;
    }
    const dx = e.clientX - state.startX;
    const minutesPerPixel = 1440 / state.dayWidth;
    const deltaMinutes = Math.round((dx * minutesPerPixel) / 15) * 15;
    let newRange = { ...state.range };
    if (state.type === "resize-left") {
        newRange.start += deltaMinutes;
    }
    else if (state.type === "resize-right") {
        newRange.end += deltaMinutes;
    }
    else {
        newRange.start += deltaMinutes;
        newRange.end += deltaMinutes;
    }
    if (newRange.end - newRange.start < 15) {
        showMessage("Shift must be at least 15 minutes", "error");
        await refreshPlan();
        return;
    }
    const fields = rangeToShiftFields(newRange, state.anchorDate);
    if (isManager()) {
        await applyManagerShiftEdit(state.shiftId, state.membershipId, fields);
    }
    else {
        await proposeEmployeeShiftEdit(state.shiftId, fields);
    }
}
async function applyManagerShiftEdit(shiftId, membershipId, fields) {
    const { conflicts, error: conflictError } = await findShiftConflicts(currentOrg.id, membershipId, fields.shift_date, fields.start_time, fields.end_time, shiftId);
    if (conflictError) {
        showMessage("Failed to check for conflicts", "error");
        await refreshPlan();
        return;
    }
    if (conflicts.length > 0) {
        showMessage("This staff member already has an overlapping shift", "error");
        await refreshPlan();
        return;
    }
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient
        .from("shifts")
        .update({
        shift_date: fields.shift_date,
        start_time: fields.start_time,
        end_time: fields.end_time,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString()
    })
        .eq("id", shiftId);
    if (error) {
        console.error(error);
        showMessage("Failed to update shift", "error");
        await refreshPlan();
        return;
    }
    showMessage("Shift updated", "success");
    await refreshPlan();
}
async function proposeEmployeeShiftEdit(shiftId, fields) {
    if (!currentOrg || !currentMembership)
        return;
    const { error } = await supabaseClient
        .from("shift_change_requests")
        .insert({
        organization_id: currentOrg.id,
        shift_id: shiftId,
        requested_by_membership_id: currentMembership.id,
        proposed_shift_date: fields.shift_date,
        proposed_start_time: fields.start_time,
        proposed_end_time: fields.end_time
    });
    if (error) {
        console.error(error);
        showMessage("Failed to submit change request", "error");
        await refreshPlan();
        return;
    }
    showMessage("Change requested — waiting for manager approval", "success");
    await refreshPlan();
}
// ======================================================
// Date navigation (same pattern as roomRack.js)
// ======================================================
export function changeDate(stepDays) {
    planStartDate = addDays(planStartDate, stepDays);
    planSelectedDate = planStartDate;
    updatePlanDateInput();
    refreshPlan();
}
function centerPlanOnDate(date) {
    planSelectedDate = date;
    const dayCount = getPlanDayCount();
    const before = Math.floor((dayCount - 1) / 2);
    planStartDate = addDays(date, -before);
    updatePlanDateInput();
}
export function changeSelectedDate(value) {
    const [y, m, d] = value.split("-").map(Number);
    // Partial/intermediate state while typing (e.g. year "2"):
    // ignore silently — do NOT rewrite the input, or the
    // user's in-progress keystrokes get wiped.
    if (!y || !m || !d || y < 1900 || y > 2200) {
        return;
    }
    centerPlanOnDate(new Date(y, m - 1, d));
    refreshPlan();
}
function updatePlanDateInput() {
    const input = document.getElementById("planDateInput");
    if (input && document.activeElement !== input) {
        input.value = formatDateISO(planSelectedDate);
    }
}
// ======================================================
// Hours summary panel (Soll / Ist / \u00dcberstunden)
// ======================================================
export async function renderHoursSummary() {
    const panel = document.getElementById("hoursSummaryPanel");
    if (!panel || !currentOrg)
        return;
    const membersToShow = isManager() ? planMembers : (currentMembership ? [currentMembership] : []);
    const today = startOfToday();
    const dow = today.getDay(); // 0 = Sunday
    const daysSinceMonday = dow === 0 ? 6 : dow - 1;
    const weekStart = addDays(today, -daysSinceMonday);
    const weekEnd = addDays(weekStart, 6);
    const rows = await Promise.all(membersToShow.map(async (member) => {
        const summary = await computeHoursSummary(currentOrg.id, member, weekStart, weekEnd, "This week");
        return `
            <tr>
                <td>${escapeAttr(member.full_name)}</td>
                <td>${formatHours(summary.sollHours)}</td>
                <td>${formatHours(summary.istHours)}</td>
                <td class="${summary.ueberstunden >= 0 ? "status-msg-success" : "status-msg-error"}">
                    ${formatHours(summary.ueberstunden)}
                </td>
            </tr>
        `;
    }));
    panel.innerHTML = `
        <table>
            <thead>
                <tr><th>Staff</th><th>Soll</th><th>Ist</th><th>\u00dcberstunden</th></tr>
            </thead>
            <tbody>${rows.join("")}</tbody>
        </table>
    `;
}
// ======================================================
// Status bar helpers (same pattern as roomRack.js)
// ======================================================
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}
function showMessage(text, type = "info") {
    const contextArea = document.getElementById("contextArea");
    if (!contextArea)
        return;
    contextArea.innerHTML = `<span class="status-msg-${type}">${escapeHtml(text)}</span>`;
    window.clearTimeout(showMessage._timer);
    showMessage._timer = window.setTimeout(() => {
        contextArea.innerHTML = "";
    }, 4000);
}
// ======================================================
// Refresh / Init
// ======================================================
export async function refreshPlan() {
    if (!currentOrg)
        return;
    planDayCount = getPlanDayCount();
    const dayWidth = getPlanColWidth(planDayCount);
    document.documentElement.style.setProperty("--rack-col-width", `${dayWidth}px`);
    const days = [];
    for (let i = 0; i < planDayCount; i++) {
        days.push(addDays(planStartDate, i));
    }
    const rangeEnd = days[days.length - 1];
    const [members, shifts, entries, leave] = await Promise.all([
        fetchPlanMembers(),
        fetchPlanShifts(planStartDate, rangeEnd),
        fetchPlanTimeEntries(planStartDate, rangeEnd),
        fetchLeaveRequests(formatDateISO(planStartDate), formatDateISO(rangeEnd))
    ]);
    planMembers = members;
    planShifts = shifts;
    planTimeEntries = entries;
    planLeaveRequests = leave;
    renderPlanHeader(days, dayWidth);
    renderPlanBody(days, dayWidth, planDayCount);
    await renderHoursSummary();
    await Promise.all([renderApprovalsPanel(), renderComplaintsPanel(), renderLeavePanel(), renderCrewList(), renderMyEntries()]);
    applyAuthVisibility();
}
function startClock() {
    const clock = document.getElementById("clock");
    if (!clock)
        return;
    function updateClock() {
        const now = new Date();
        clock.innerText = now.toLocaleString("de-DE", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit"
        });
    }
    updateClock();
    setInterval(updateClock, 1000);
}
function renderOrgLabel() {
    const label = document.getElementById("orgNameLabel");
    if (!label)
        return;
    label.innerText = currentOrg ? currentOrg.name : "Dienstplan";
}
function debounce(fn, delay) {
    let timer;
    return ((...args) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => fn(...args), delay);
    });
}
document.addEventListener("DOMContentLoaded", async () => {
    startClock();
    updatePlanViewModeButtons();
    setupPlanDragAndDrop();
    const { bootstrapAuth } = await import("./auth.js"); // atau tambah ke import atas file
    const loggedIn = await bootstrapAuth();
    renderOrgLabel();
    renderUserArea();
    renderNavigation(currentMembership?.role ?? null);
    centerPlanOnDate(startOfToday());
    if (loggedIn) {
        try {
            await refreshPlan();
        }
        catch (err) {
            console.error("refreshPlan failed:", err);
        }
    }
    window.addEventListener("resize", debounce(() => {
        const newDayCount = getPlanDayCount();
        if (newDayCount !== planDayCount) {
            centerPlanOnDate(planSelectedDate);
            refreshPlan();
        }
    }, 300));
});
// ======================================================
// Expose a small surface on `window.dienstplan` for inline
// onclick="" handlers in the HTML, same pattern Hotel PMS
// uses with plain <script> globals — keeps the HTML markup
// unchanged even though this file is an ES module.
// ======================================================
window.dienstplan = {
    changeDate,
    changeSelectedDate,
    planSetViewMode,
    checkIn,
    checkOut,
    approveTimeEntry,
    managerSetTimeEntry,
    rejectTimeEntry,
    submitComplaint,
    requestLeave,
    reviewLeave
};
//# sourceMappingURL=dienstplan.js.map