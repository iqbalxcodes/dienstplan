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
import { currentOrg, currentMembership, isManager, isLoggedIn, bootstrapAuth, applyAuthVisibility, renderUserArea } from "./auth.js";
import {getShiftRange, rangeToShiftFields, findShiftConflicts, type MinuteRange} from "./shiftAvailability.js";
import { computeHoursSummary, formatHours } from "./hoursCalculator.js";
import { renderNavigation } from "./nav.js";
import { renderApprovalsPanel, renderComplaintsPanel, renderLeavePanel, renderCrewList, renderMyEntries } from "./panels.js";
import { submitLeaveRequest, fetchLeaveRequests, reviewLeaveRequest, LEAVE_TYPE_LABELS } from "./leaveRequests.js";
import { fileComplaint } from "./complaints.js";
import type { Membership, Shift, TimeEntry, LeaveRequest, LeaveType, ShiftChangeRequest } from "./types.js";
import { initPageHeader } from "./pageHeader.js";

const PLAN_VIEW_MODE_KEY = "dienstplan_view_mode_v1";
const DOW_LABELS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTH_LABELS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// planViewMode: "auto" (responsive: 3 days on phone, 7 on
// tablet, up to a month on wide screens) or a forced "3" / "7" / "30"
let planViewMode = loadPlanViewMode();

let planStartDate = startOfToday();
let planSelectedDate = startOfToday();
let planDayCount = getPlanDayCount();

// Data caches for the current window, refreshed by refreshPlan()
let planMembers: Membership[] = [];
let planShifts: Shift[] = [];
let planTimeEntries: TimeEntry[] = [];
let planLeaveRequests: LeaveRequest[] = [];

const MONTH_DOW_LABELS = ["MON","TUE","WED","THU","FRI","SAT","SUN"];

let planMonthDate = startOfMonth(startOfToday());
let planMonthChangeRequests: ShiftChangeRequest[] = [];

interface MonthDragState {
    type: "shift" | "ghost";
    id: string;
    membershipId: string;
    origDate: string;
    cardEl: HTMLElement;
    startX: number;
    startY: number;
    moved: boolean;
    ghostEl: HTMLElement | null;
}

let monthDragState: MonthDragState | null = null;
// Active drag state (null when not dragging), same shape idea
// as roomRack.js's rackDragState
interface PlanDragState {
    type: "move" | "resize-left" | "resize-right";
    shiftId: string;
    membershipId: string;
    ownerId: string;         // membership id that owns the shift (for permission check)
    range: MinuteRange;
    anchorDate: string;
    startX: number;
    barEl: HTMLElement;
    originLeft: number;
    originWidth: number;
    dayWidth: number;
    moved: boolean;
    ghostEl: HTMLElement | null;
}

let planDragState: PlanDragState | null = null;


// ======================================================
// Date helpers (local-midnight based, same as roomRack.js)
// ======================================================

function startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function addDays(date: Date, n: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

function diffDays(a: Date, b: Date): number {
    return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function formatDateISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function mondayIndex(date: Date): number {
    return (date.getDay() + 6) % 7; // 0 = Monday ... 6 = Sunday
}

function buildMonthWeeks(monthDate: Date): Date[][] {

    const firstOfMonth = startOfMonth(monthDate);
    const daysInThisMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();

    const leadingOffset = mondayIndex(firstOfMonth);
    const gridStart = addDays(firstOfMonth, -leadingOffset);

    const totalCells = leadingOffset + daysInThisMonth;
    const totalWeeks = Math.ceil(totalCells / 7);

    const weeks: Date[][] = [];
    let cursor = gridStart;

    for(let w = 0; w < totalWeeks; w++){
        const week: Date[] = [];
        for(let d = 0; d < 7; d++){
            week.push(cursor);
            cursor = addDays(cursor, 1);
        }
        weeks.push(week);
    }

    return weeks;

}

function roleLabels(): string[] {
    return currentOrg?.settings?.role_labels ?? ["Service crew", "Kitchen", "Bar", "Cashier", "Runner"];
}


// ======================================================
// Responsive day count — phone defaults to 3 days
// (yesterday / today / tomorrow) with ◀ ▶ to page one day
// at a time; tablet width fits ~7; wide desktop can show a
// full month. Forced modes ("3"/"7"/"30") override this.
// ======================================================

function getPlanDayCount(): number {

    if(planViewMode !== "auto"){
        return Number(planViewMode);
    }

    const width = window.innerWidth;

    if(width <= 700) return 3;
    if(width <= 1100) return 7;
    if(width <= 1700) return 14;

    return 30;

}

function getPlanColWidth(dayCount: number): number {

    const width = window.innerWidth;

    if(width <= 700) return Math.floor((width - 128) / Math.max(1, dayCount));
    if(width <= 1100) return 96;
    if(width <= 1700) return 76;

    return 60;

}

function loadPlanViewMode(): string {
    return localStorage.getItem(PLAN_VIEW_MODE_KEY) || "auto";
}

export function planSetViewMode(mode: string): void {

    if(mode === "month" && planViewMode !== "month"){
        planMonthDate = startOfMonth(planSelectedDate);
    }

    planViewMode = mode;
    localStorage.setItem(PLAN_VIEW_MODE_KEY, mode);

    updatePlanViewModeButtons();
    setScheduleViewContainer(mode);
    refreshPlan();

}

function updatePlanViewModeButtons(): void {

    document.querySelectorAll<HTMLElement>(".rack-view-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.mode === planViewMode);
    });

    const mobileSel = document.getElementById("rackViewSelectMobile") as HTMLSelectElement | null;
    if(mobileSel) mobileSel.value = planViewMode;

}


// ======================================================
// Data fetching
// ======================================================

async function fetchPlanMembers(): Promise<Membership[]> {

    if(!currentOrg) return [];

    const { data, error } = await supabaseClient
        .from("memberships")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .eq("active", true)
        .order("full_name", { ascending: true });

    if(error){
        console.error(error);
        showMessage("Failed to load staff", "error");
        return [];
    }

    return data as Membership[];

}

async function fetchPlanShifts(rangeStart: Date, rangeEnd: Date): Promise<Shift[]> {

    if(!currentOrg) return [];

    const { data, error } = await supabaseClient
        .from("shifts")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .gte("shift_date", formatDateISO(rangeStart))
        .lte("shift_date", formatDateISO(rangeEnd));

    if(error){
        console.error(error);
        showMessage("Failed to load shifts", "error");
        return [];
    }

    return data as Shift[];

}

async function fetchPlanTimeEntries(rangeStart: Date, rangeEnd: Date): Promise<TimeEntry[]> {

    if(!currentOrg) return [];

    const { data, error } = await supabaseClient
        .from("time_entries")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .gte("clock_in", rangeStart.toISOString())
        .lte("clock_in", addDays(rangeEnd, 1).toISOString());

    if(error){
        console.error(error);
        return [];
    }

    return data as TimeEntry[];

}

function shiftsForMember(membershipId: string): Shift[] {
    return planShifts.filter(s => s.membership_id === membershipId);
}

function pendingEntriesForMember(membershipId: string): TimeEntry[] {
    return planTimeEntries.filter(e => e.membership_id === membershipId && e.status === "pending");
}


// ======================================================
// Rendering — header
// ======================================================

function renderPlanHeader(days: Date[], dayWidth: number): void {

    const today = startOfToday();
    const row = document.getElementById("rackHeaderRow");
    if(!row) return;

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

function buildShiftBarsHTML(
    member: Membership,
    days: Date[],
    dayWidth: number,
    dayCount: number
): string {

    const rangeStart = getShiftRange(formatDateISO(days[0]), "00:00", "00:00").start;
    const rangeEndExclusive = getShiftRange(formatDateISO(days[dayCount - 1]), "00:00", "00:00").start + 1440;

    let html = "";

    shiftsForMember(member.id).forEach(shift => {

        const range = getShiftRange(shift.shift_date, shift.start_time, shift.end_time);

        const clampStart = Math.max(range.start, rangeStart);
        const clampEnd = Math.min(range.end, rangeEndExclusive);

        if(clampEnd <= clampStart) return;

        const pxPerMinute = dayWidth / 1440;
        const left = (clampStart - rangeStart) * pxPerMinute + 3;
        const width = (clampEnd - clampStart) * pxPerMinute - 6;

        const cutLeft = range.start < rangeStart;
        const cutRight = range.end > rangeEndExclusive;

        const meta = [
            shift.role_label,
            `${shift.start_time.slice(0,5)}\u2013${shift.end_time.slice(0,5)}`,
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

function buildLeaveBarsHTML(member: Membership, days: Date[], dayWidth: number): string {

    let html = "";

    const relevant = planLeaveRequests.filter(l => l.membership_id === member.id);

    relevant.forEach(leave => {

        const start = parseDateOnly(leave.date_start);
        const end = parseDateOnly(leave.date_end);

        days.forEach((d, i) => {

            if(d >= start && d <= end){

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

function parseDateOnly(str: string): Date {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
}

function escapeAttr(str: string | null | undefined): string {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}


// ======================================================
// Rendering — body (one row per staff member)
// ======================================================

function renderPlanBody(days: Date[], dayWidth: number, dayCount: number): void {

    const body = document.getElementById("rackBody");
    if(!body) return;

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

function buildTimelineCellsHTML(days: Date[], dayWidth: number): string {

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

export async function checkIn(note = ""): Promise<void> {

    if(!currentOrg || !currentMembership){
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

    if(error){
        console.error(error);
        showMessage("Check-in failed", "error");
        return;
    }

    showMessage("Check-in submitted — waiting for manager approval", "success");
    await refreshPlan();

}

export async function checkOut(note = ""): Promise<void> {

    if(!currentOrg || !currentMembership){
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

    if(openEntry){

        const { error } = await supabaseClient
            .from("time_entries")
            .update({
                clock_out: new Date().toISOString(),
                original_clock_out: new Date().toISOString(),
                employee_note: note ? `${openEntry.employee_note ?? ""} ${note}`.trim() : openEntry.employee_note,
                status: "pending",   // re-flag as pending since it changed
                updated_at: new Date().toISOString()
            })
            .eq("id", openEntry.id);

        if(error){
            console.error(error);
            showMessage("Check-out failed", "error");
            return;
        }

    } else {

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

        if(error){
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

export async function approveTimeEntry(entryId: string, managerNote = ""): Promise<void> {

    if(!isManager()) return;

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

    if(error){
        console.error(error);
        showMessage("Failed to approve", "error");
        return;
    }

    showMessage("Time entry approved", "success");
    await refreshPlan();

}

export async function managerSetTimeEntry(
    entryId: string,
    clockIn: string,
    clockOut: string,
    managerNote: string
): Promise<void> {

    if(!isManager()) return;

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

    if(error){
        console.error(error);
        showMessage("Failed to update time entry", "error");
        return;
    }

    showMessage("Time entry updated by manager", "success");
    await refreshPlan();

}

export async function rejectTimeEntry(entryId: string, managerNote = ""): Promise<void> {

    if(!isManager()) return;

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

    if(error){
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

export async function submitComplaint(entryId: string, message: string, files: File[]): Promise<void> {

    const error = await fileComplaint(entryId, message, files);

    if(error){
        showMessage(error, "error");
        return;
    }

    showMessage("Complaint filed — a manager will review it", "success");

}


// ======================================================
// Freiwunsch / Urlaub
// ======================================================

export async function requestLeave(type: LeaveType, dateStart: string, dateEnd: string, reason: string): Promise<void> {

    const error = await submitLeaveRequest(type, dateStart, dateEnd, reason);

    if(error){
        showMessage(error, "error");
        return;
    }

    showMessage(`${LEAVE_TYPE_LABELS[type]} request submitted`, "success");
    await refreshPlan();

}

export async function reviewLeave(requestId: string, approve: boolean): Promise<void> {

    const error = await reviewLeaveRequest(requestId, approve);

    if(error){
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

export function setupPlanDragAndDrop(): void {

    const body = document.getElementById("rackBody");
    if(!body) return;

    body.addEventListener("mousedown", handlePlanMouseDown);

}

function handlePlanMouseDown(e: MouseEvent): void {

    const target = e.target as HTMLElement;
    const bar = target.closest(".plan-shift-bar") as HTMLElement | null;

    if(!bar || !isLoggedIn()) return;

    e.preventDefault();

    const handle = target.closest(".bar-resize-handle") as HTMLElement | null;

    const type: PlanDragState["type"] = handle
        ? (handle.classList.contains("left") ? "resize-left" : "resize-right")
        : "move";

    const dayWidth = getPlanColWidth(planDayCount);

    const shiftDate = bar.dataset.shiftDate!;
    const startTime = bar.dataset.startTime!;
    const endTime = bar.dataset.endTime!;
    const range = getShiftRange(shiftDate, startTime, endTime);

    planDragState = {
        type,
        shiftId: bar.dataset.shiftId!,
        membershipId: bar.dataset.membershipId!,
        ownerId: bar.dataset.membershipId!,
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

    if(type === "move"){

        const rect = bar.getBoundingClientRect();
        const ghost = bar.cloneNode(true) as HTMLElement;

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

function positionPlanGhost(e: MouseEvent): void {

    if(!planDragState?.ghostEl) return;

    planDragState.ghostEl.style.transform =
        `translate(${e.clientX - planDragState.originWidth / 2}px, ${e.clientY - 16}px)`;

}

function handlePlanMouseMove(e: MouseEvent): void {

    if(!planDragState) return;

    const dx = e.clientX - planDragState.startX;

    if(Math.abs(dx) > 4){
        planDragState.moved = true;
    }

    if(planDragState.type === "move"){

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

    if(planDragState.type === "resize-left"){

        const newLeft = planDragState.originLeft + deltaSteps * snapPx;
        const newWidth = planDragState.originWidth - deltaSteps * snapPx;

        if(newWidth < snapPx * 2) return;

        bar.style.left = newLeft + "px";
        bar.style.width = newWidth + "px";

    } else {

        const newWidth = planDragState.originWidth + deltaSteps * snapPx;

        if(newWidth < snapPx * 2) return;

        bar.style.width = newWidth + "px";

    }

}

async function handlePlanMouseUp(e: MouseEvent): Promise<void> {

    document.removeEventListener("mousemove", handlePlanMouseMove);
    document.removeEventListener("mouseup", handlePlanMouseUp);

    if(!planDragState) return;

    const state = planDragState;
    planDragState = null;

    document.querySelectorAll(".plan-row.drag-target-row")
        .forEach(el => el.classList.remove("drag-target-row"));

    state.ghostEl?.remove();

    if(!state.moved){
        // treat as a click -> could open a shift detail modal here
        return;
    }

    const dx = e.clientX - state.startX;
    const minutesPerPixel = 1440 / state.dayWidth;
    const deltaMinutes = Math.round((dx * minutesPerPixel) / 15) * 15;

    let newRange: MinuteRange = { ...state.range };

    if(state.type === "resize-left"){
        newRange.start += deltaMinutes;
    } else if(state.type === "resize-right"){
        newRange.end += deltaMinutes;
    } else {
        newRange.start += deltaMinutes;
        newRange.end += deltaMinutes;
    }

    if(newRange.end - newRange.start < 15){
        showMessage("Shift must be at least 15 minutes", "error");
        await refreshPlan();
        return;
    }

    const fields = rangeToShiftFields(newRange, state.anchorDate);

    if(isManager()){
        await applyManagerShiftEdit(state.shiftId, state.membershipId, fields);
    } else {
        await proposeEmployeeShiftEdit(state.shiftId, fields);
    }

}

async function applyManagerShiftEdit(
    shiftId: string,
    membershipId: string,
    fields: { shift_date: string; start_time: string; end_time: string; role_label?: string }
): Promise<void> {

    const { conflicts, error: conflictError } = await findShiftConflicts(
        currentOrg!.id, membershipId, fields.shift_date, fields.start_time, fields.end_time, shiftId
    );

    if(conflictError){
        showMessage("Failed to check for conflicts", "error");
        await refreshPlan();
        return;
    }

    if(conflicts.length > 0){
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
            ...(fields.role_label ? { role_label: fields.role_label } : {}),
            updated_by: user?.id ?? null,
            updated_at: new Date().toISOString()
        })
        .eq("id", shiftId);

    if(error){
        console.error(error);
        showMessage("Failed to update shift", "error");
        await refreshPlan();
        return;
    }

    showMessage("Shift updated", "success");
    await refreshPlan();

}

async function proposeEmployeeShiftEdit(
    shiftId: string,
    fields: { shift_date: string; start_time: string; end_time: string; role_label?: string }
): Promise<void> {

    if(!currentOrg || !currentMembership) return;

    const { error } = await supabaseClient
        .from("shift_change_requests")
        .insert({
            organization_id: currentOrg.id,
            shift_id: shiftId,
            requested_by_membership_id: currentMembership.id,
            proposed_shift_date: fields.shift_date,
            proposed_start_time: fields.start_time,
            proposed_end_time: fields.end_time,
            ...(fields.role_label ? { proposed_role_label: fields.role_label } : {})
        });

    if(error){
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

export function changeDate(stepDays: number): void {

    planStartDate = addDays(planStartDate, stepDays);
    planSelectedDate = planStartDate;

    updatePlanDateInput();
    refreshPlan();

}

function centerPlanOnDate(date: Date): void {

    planSelectedDate = date;

    const dayCount = getPlanDayCount();
    const before = Math.floor((dayCount - 1) / 2);

    planStartDate = addDays(date, -before);

    updatePlanDateInput();

}

export function changeSelectedDate(value: string): void {

    const [y, m, d] = value.split("-").map(Number);

    // Partial/intermediate state while typing (e.g. year "2"):
    // ignore silently — do NOT rewrite the input, or the
    // user's in-progress keystrokes get wiped.
    if(!y || !m || !d || y < 1900 || y > 2200){
        return;
    }

    centerPlanOnDate(new Date(y, m - 1, d));
    refreshPlan();

}

function updatePlanDateInput(): void {

    const input = document.getElementById("planDateInput") as HTMLInputElement | null;

    if(input && document.activeElement !== input){
        input.value = formatDateISO(planSelectedDate);
    }

}


// ======================================================
// Hours summary panel (Soll / Ist / \u00dcberstunden)
// ======================================================

export async function renderHoursSummary(): Promise<void> {

    const panel = document.getElementById("hoursSummaryPanel");
    if(!panel || !currentOrg) return;

    const membersToShow = isManager() ? planMembers : (currentMembership ? [currentMembership] : []);

    const today = startOfToday();
    const dow = today.getDay(); // 0 = Sunday
    const daysSinceMonday = dow === 0 ? 6 : dow - 1;
    const weekStart = addDays(today, -daysSinceMonday);
    const weekEnd = addDays(weekStart, 6);

    const rows = await Promise.all(membersToShow.map(async member => {

        const summary = await computeHoursSummary(currentOrg!.id, member, weekStart, weekEnd, "This week");

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
// MONTH VIEW
// ======================================================

function populateMonthPickerOnce(): void {

    const monthSel = document.getElementById("monthPickerMonth") as HTMLSelectElement | null;
    const yearSel  = document.getElementById("monthPickerYear") as HTMLSelectElement | null;

    if(!monthSel || !yearSel) return;

    if(monthSel.dataset.populated !== "1"){
        monthSel.innerHTML = MONTH_LABELS.map((m, i) => `<option value="${i}">${m}</option>`).join("");
        monthSel.dataset.populated = "1";
    }

    if(yearSel.dataset.populated !== "1"){
        const thisYear = new Date().getFullYear();
        const years: number[] = [];
        for(let y = thisYear - 5; y <= thisYear + 5; y++) years.push(y);
        yearSel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
        yearSel.dataset.populated = "1";
    }

}

function syncMonthPicker(): void {

    populateMonthPickerOnce();

    const monthSel = document.getElementById("monthPickerMonth") as HTMLSelectElement | null;
    const yearSel  = document.getElementById("monthPickerYear") as HTMLSelectElement | null;

    if(monthSel) monthSel.value = String(planMonthDate.getMonth());
    if(yearSel)  yearSel.value  = String(planMonthDate.getFullYear());

}

export function onMonthPickerChange(): void {

    const monthSel = document.getElementById("monthPickerMonth") as HTMLSelectElement;
    const yearSel  = document.getElementById("monthPickerYear") as HTMLSelectElement;

    planMonthDate = new Date(Number(yearSel.value), Number(monthSel.value), 1);
    refreshMonthView();

}
function renderMonthHeader(): void {
    const row = document.getElementById("monthHeaderRow");
    if(!row) return;
    row.innerHTML = MONTH_DOW_LABELS.map(d => `<div class="month-header-cell">${d}</div>`).join("");
}

async function fetchMonthChangeRequests(rangeStart: Date, rangeEnd: Date): Promise<ShiftChangeRequest[]> {

    if(!currentOrg) return [];

    const { data, error } = await supabaseClient
        .from("shift_change_requests")
        .select("*")
        .eq("organization_id", currentOrg.id)
        .eq("status", "pending")
        .gte("proposed_shift_date", formatDateISO(rangeStart))
        .lte("proposed_shift_date", formatDateISO(rangeEnd));

    if(error){
        console.error(error);
        return [];
    }

    return data as ShiftChangeRequest[];

}

function buildMonthCellHTML(date: Date, monthDate: Date, today: Date): string {

    const iso = formatDateISO(date);
    const inMonth = date.getMonth() === monthDate.getMonth() && date.getFullYear() === monthDate.getFullYear();
    const isToday = isSameDay(date, today);

    const dayShifts = planShifts.filter(s => s.shift_date === iso);
    const dayGhosts = planMonthChangeRequests.filter(r => r.proposed_shift_date === iso);

    let cardsHtml = "";

    dayShifts.forEach(shift => {

        const member = planMembers.find(m => m.id === shift.membership_id);
        if(!member) return;

        cardsHtml += `
            <div class="month-shift-card"
                 data-shift-id="${shift.id}"
                 data-membership-id="${member.id}"
                 data-shift-date="${shift.shift_date}"
                 data-start-time="${shift.start_time}"
                 data-end-time="${shift.end_time}">
                <span class="month-card-name">${escapeAttr(member.full_name)}</span>
                <span class="month-card-meta">${escapeAttr(shift.role_label ?? "")} \u00b7 ${shift.start_time.slice(0,5)}\u2013${shift.end_time.slice(0,5)}</span>
            </div>
        `;

    });

    dayGhosts.forEach(req => {

        const member = planMembers.find(m => m.id === req.requested_by_membership_id);
        if(!member) return;

        cardsHtml += `
            <div class="month-shift-card pending-ghost"
                 data-request-id="${req.id}"
                 data-membership-id="${member.id}">
                <span class="month-card-name">${escapeAttr(member.full_name)}</span>
                <span class="month-card-meta">${req.proposed_start_time.slice(0,5)}\u2013${req.proposed_end_time.slice(0,5)} \u00b7 pending</span>
            </div>
        `;

    });

    return `
        <div class="month-day-cell ${inMonth ? "" : "other-month"}" data-date="${iso}">
            <div class="month-day-num ${isToday ? "is-today" : ""}">${date.getDate()}</div>
            <div class="month-cards">${cardsHtml}</div>
        </div>
    `;

}

function renderMonthGrid(): void {

    const grid = document.getElementById("monthGrid");
    if(!grid) return;

    const weeks = buildMonthWeeks(planMonthDate);
    const today = startOfToday();

    grid.innerHTML = weeks.flat().map(d => buildMonthCellHTML(d, planMonthDate, today)).join("");
    grid.style.gridTemplateRows = `repeat(${weeks.length}, 1fr)`;

}

async function refreshMonthView(): Promise<void> {

    if(!currentOrg) return;

    const weeks = buildMonthWeeks(planMonthDate);
    const rangeStart = weeks[0][0];
    const rangeEnd = weeks[weeks.length - 1][6];

    syncMonthPicker();
    renderMonthHeader();

    const [members, shifts, changeRequests] = await Promise.all([
        fetchPlanMembers(),
        fetchPlanShifts(rangeStart, rangeEnd),
        fetchMonthChangeRequests(rangeStart, rangeEnd)
    ]);

    planMembers = members;
    planShifts = shifts;
    planMonthChangeRequests = changeRequests;

    renderMonthGrid();
    applyAuthVisibility();

}

export function changeMonth(step: number): void {
    planMonthDate = new Date(planMonthDate.getFullYear(), planMonthDate.getMonth() + step, 1);
    refreshMonthView();
}

function setScheduleViewContainer(mode: string): void {

    const rackScroll = document.getElementById("rackScroll");
    const monthView = document.getElementById("monthView");
    const dateInput = document.getElementById("planDateInput") as HTMLInputElement | null;
    const monthNavBar = document.getElementById("monthNavBar");

    const isMonth = mode === "month";

    if(rackScroll) rackScroll.style.display = isMonth ? "none" : "";
    if(monthView) monthView.style.display = isMonth ? "flex" : "none";
    if(dateInput) dateInput.style.display = isMonth ? "none" : "";
    if(monthNavBar) monthNavBar.style.display = isMonth ? "flex" : "none";

}


// ======================================================
// MONTH VIEW — drag & drop + click-to-edit (pointer events,
// unified for mouse & touch)
// ======================================================

function setupMonthDragAndDrop(): void {

    const grid = document.getElementById("monthGrid");
    if(!grid) return;

    grid.addEventListener("pointerdown", handleMonthPointerDown);

    grid.addEventListener("click", (e: MouseEvent) => {

        const target = e.target as HTMLElement;
        if(target.closest(".month-shift-card")) return;

        const cell = target.closest(".month-day-cell") as HTMLElement | null;
        if(!cell || !isManager()) return;

        const date = cell.dataset.date;
        if(date) openShiftPopup(null, null, date);

    });

}

function handleMonthPointerDown(e: PointerEvent): void {

    const target = e.target as HTMLElement;
    const card = target.closest(".month-shift-card") as HTMLElement | null;
    if(!card || !isLoggedIn()) return;

    const isGhost = card.classList.contains("pending-ghost");
    const membershipId = card.dataset.membershipId!;
    const canEdit = !isGhost && (isManager() || membershipId === currentMembership?.id);

    // shift orang lain yang bukan milik kita & bukan manager -> tidak interaktif
    if(!canEdit && !isGhost) return;

    const rect = card.getBoundingClientRect();

    monthDragState = {
        type: isGhost ? "ghost" : "shift",
        id: (isGhost ? card.dataset.requestId : card.dataset.shiftId)!,
        membershipId,
        origDate: card.dataset.shiftDate ?? "",
        cardEl: card,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        ghostEl: null
    };

    if(canEdit){

        const ghost = card.cloneNode(true) as HTMLElement;
        ghost.classList.add("rack-drag-ghost");
        ghost.style.position = "fixed";
        ghost.style.width = rect.width + "px";
        ghost.style.pointerEvents = "none";
        document.body.appendChild(ghost);
        monthDragState.ghostEl = ghost;
        positionMonthGhost(e);

    }

    document.addEventListener("pointermove", handleMonthPointerMove);
    document.addEventListener("pointerup", handleMonthPointerUp);

}

function positionMonthGhost(e: PointerEvent): void {
    if(!monthDragState?.ghostEl) return;
    monthDragState.ghostEl.style.left = (e.clientX - monthDragState.ghostEl.offsetWidth / 2) + "px";
    monthDragState.ghostEl.style.top = (e.clientY - 16) + "px";
}

function handleMonthPointerMove(e: PointerEvent): void {

    if(!monthDragState) return;

    const dx = e.clientX - monthDragState.startX;
    const dy = e.clientY - monthDragState.startY;

    if(Math.hypot(dx, dy) > 6) monthDragState.moved = true;

    if(monthDragState.ghostEl){

        positionMonthGhost(e);

        document.querySelectorAll(".month-day-cell.drag-target")
            .forEach(el => el.classList.remove("drag-target"));

        const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest(".month-day-cell");
        cell?.classList.add("drag-target");

    }

}

async function handleMonthPointerUp(e: PointerEvent): Promise<void> {

    document.removeEventListener("pointermove", handleMonthPointerMove);
    document.removeEventListener("pointerup", handleMonthPointerUp);

    if(!monthDragState) return;

    const state = monthDragState;
    monthDragState = null;

    document.querySelectorAll(".month-day-cell.drag-target")
        .forEach(el => el.classList.remove("drag-target"));

    state.ghostEl?.remove();

    if(!state.moved){
        if(state.type === "ghost"){
            openShiftPopup(null, state.id);
        } else {
            openShiftPopup(state.id, null);
        }
        return;
    }

    if(state.type !== "shift") return; // ghost cards tidak bisa di-drag pindah tanggal

    const targetCell = document.elementFromPoint(e.clientX, e.clientY)?.closest(".month-day-cell") as HTMLElement | null;
    const targetDate = targetCell?.dataset.date;

    if(!targetDate || targetDate === state.origDate) return;

    const shift = planShifts.find(s => s.id === state.id);
    if(!shift) return;

    const fields = {
        shift_date: targetDate,
        start_time: shift.start_time,
        end_time: shift.end_time
    };

    if(isManager()){
        await applyManagerShiftEdit(state.id, state.membershipId, fields);
    } else {
        await proposeEmployeeShiftEdit(state.id, fields);
    }

}


// ======================================================
// MONTH VIEW — swipe vertikal buat ganti bulan di mobile
// ======================================================

function setupMonthSwipe(): void {

    const view = document.getElementById("monthView");
    if(!view) return;

    let touchStartY = 0;
    let touchStartX = 0;

    view.addEventListener("touchstart", (e: TouchEvent) => {
        if(monthDragState) return;
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
    }, { passive: true });

    view.addEventListener("touchend", (e: TouchEvent) => {
        if(monthDragState) return;
        const dy = e.changedTouches[0].clientY - touchStartY;
        const dx = e.changedTouches[0].clientX - touchStartX;

        if(Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)){
            changeMonth(dy < 0 ? 1 : -1); // swipe ke atas -> bulan depan
        }
    }, { passive: true });

}


// ======================================================
// MONTH VIEW — popup edit shift
// ======================================================

export function openShiftPopup(shiftId: string | null, requestId: string | null, newDate: string | null = null): void {

    const modal = document.getElementById("shiftPopupModal");
    if(!modal) return;

    const titleEl  = document.getElementById("shiftPopupTitle")!;
    const nameEl   = document.getElementById("shiftPopupStaffName")!;
    const empLabel = document.getElementById("shiftPopupEmployeeLabel")!;
    const empSel   = document.getElementById("shiftPopupEmployee") as HTMLSelectElement;
    const roleSel  = document.getElementById("shiftPopupRole") as HTMLSelectElement;
    const startEl  = document.getElementById("shiftPopupStart") as HTMLInputElement;
    const endEl    = document.getElementById("shiftPopupEnd") as HTMLInputElement;
    const noteEl   = document.getElementById("shiftPopupPendingNote")!;
    const saveBtn  = document.getElementById("shiftPopupSaveBtn") as HTMLButtonElement;

    roleSel.innerHTML = roleLabels().map(r => `<option value="${escapeAttr(r)}">${escapeAttr(r)}</option>`).join("");

    modal.dataset.editingShiftId = "";
    modal.dataset.newDate = "";

    if(requestId){

        const req = planMonthChangeRequests.find(r => r.id === requestId);
        const member = planMembers.find(m => m.id === req?.requested_by_membership_id);

        titleEl.textContent = "Pending Change";
        nameEl.textContent = member?.full_name ?? "";
        empLabel.style.display = "none";
        empSel.style.display = "none";
        roleSel.disabled = true;
        startEl.value = req?.proposed_start_time.slice(0,5) ?? "";
        endEl.value = req?.proposed_end_time.slice(0,5) ?? "";
        startEl.disabled = true;
        endEl.disabled = true;
        noteEl.style.display = "";
        noteEl.textContent = "Waiting for manager approval.";
        saveBtn.style.display = "none";

    } else if(shiftId){

        const shift = planShifts.find(s => s.id === shiftId);
        const member = planMembers.find(m => m.id === shift?.membership_id);

        titleEl.textContent = "Edit Shift";
        nameEl.textContent = member?.full_name ?? "";
        empLabel.style.display = "none";
        empSel.style.display = "none";
        roleSel.disabled = false;
        roleSel.value = shift?.role_label ?? roleLabels()[0];
        startEl.value = shift?.start_time.slice(0,5) ?? "";
        endEl.value = shift?.end_time.slice(0,5) ?? "";
        startEl.disabled = false;
        endEl.disabled = false;
        saveBtn.style.display = "";

        noteEl.style.display = isManager() ? "none" : "";
        if(!isManager()) noteEl.textContent = "Your change will be sent for manager approval.";

        modal.dataset.editingShiftId = shiftId;

    } else if(newDate){

        titleEl.textContent = "Add Shift";
        nameEl.textContent = "";
        empLabel.style.display = "";
        empSel.style.display = "";
        empSel.innerHTML = planMembers.map(m => `<option value="${m.id}">${escapeAttr(m.full_name)}</option>`).join("");
        roleSel.disabled = false;
        roleSel.value = roleLabels()[0];
        startEl.value = "09:00";
        endEl.value = "17:00";
        startEl.disabled = false;
        endEl.disabled = false;
        noteEl.style.display = "none";
        saveBtn.style.display = "";

        modal.dataset.newDate = newDate;

    } else {

        return;

    }

    modal.style.display = "flex";

}

export function closeShiftPopup(): void {
    const modal = document.getElementById("shiftPopupModal");
    if(modal) modal.style.display = "none";
}

export async function submitShiftPopup(): Promise<void> {

    const modal = document.getElementById("shiftPopupModal");
    if(!modal) return;

    const roleSel = document.getElementById("shiftPopupRole") as HTMLSelectElement;
    const startEl = document.getElementById("shiftPopupStart") as HTMLInputElement;
    const endEl   = document.getElementById("shiftPopupEnd") as HTMLInputElement;

    if(!startEl.value || !endEl.value){
        showMessage("Please set both start and end time", "error");
        return;
    }

    const newDate = modal.dataset.newDate;

    if(newDate){

        const empSel = document.getElementById("shiftPopupEmployee") as HTMLSelectElement;
        const membershipId = empSel.value;

        if(!membershipId){
            showMessage("Please choose an employee", "error");
            return;
        }

        closeShiftPopup();
        await createNewShift(membershipId, newDate, startEl.value + ":00", endEl.value + ":00", roleSel.value);
        return;

    }

    const shiftId = modal.dataset.editingShiftId;
    if(!shiftId){ closeShiftPopup(); return; }

    const shift = planShifts.find(s => s.id === shiftId);
    if(!shift){ closeShiftPopup(); return; }

    closeShiftPopup();

    const fields = {
        shift_date: shift.shift_date,
        start_time: startEl.value + ":00",
        end_time: endEl.value + ":00",
        role_label: roleSel.value
    };

    if(isManager()){
        await applyManagerShiftEdit(shiftId, shift.membership_id, fields);
    } else {
        await proposeEmployeeShiftEdit(shiftId, fields);
    }

}

async function createNewShift(
    membershipId: string,
    shiftDate: string,
    startTime: string,
    endTime: string,
    roleLabel: string
): Promise<void> {

    if(!currentOrg || !isManager()) return;

    const { conflicts, error: conflictError } = await findShiftConflicts(
        currentOrg.id, membershipId, shiftDate, startTime, endTime
    );

    if(conflictError){
        showMessage("Failed to check for conflicts", "error");
        return;
    }

    if(conflicts.length > 0){
        showMessage("This staff member already has an overlapping shift", "error");
        return;
    }

    const { data: { user } } = await supabaseClient.auth.getUser();

    const { error } = await supabaseClient
        .from("shifts")
        .insert({
            organization_id: currentOrg.id,
            membership_id: membershipId,
            shift_date: shiftDate,
            start_time: startTime,
            end_time: endTime,
            role_label: roleLabel,
            updated_by: user?.id ?? null
        });

    if(error){
        console.error(error);
        showMessage("Failed to create shift", "error");
        return;
    }

    showMessage("Shift added", "success");
    await refreshPlan();

}

// ======================================================
// Status bar helpers (same pattern as roomRack.js)
// ======================================================

function escapeHtml(str: string | null | undefined): string {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

function showGreeting(): void {
    const el = document.getElementById("orgNameLabel");
    if(!el || !currentMembership) return;

    const hour = new Date().getHours();
    let greeting: string;
    if(hour < 12)      greeting = "Good Morning";
    else if(hour < 18) greeting = "Good Afternoon";
    else                greeting = "Good Evening";

    const firstName = currentMembership.full_name.split(" ")[0];

    let titleText = el.querySelector(".title-text") as HTMLElement;
    if(!titleText){
        titleText = document.createElement("span");
        titleText.className = "title-text";
        el.insertBefore(titleText, el.firstChild);
    }

    titleText.textContent = `${greeting}, ${firstName}!`;

    setTimeout(() => {
        titleText.textContent = currentOrg?.name ?? "Dienstplan";
    }, 3000);
}

function showMessage(text: string, type: "info" | "success" | "error" = "info"): void {

    const contextArea = document.getElementById("contextArea");
    if(!contextArea) return;

    contextArea.innerHTML = `<span class="status-msg-${type}">${escapeHtml(text)}</span>`;

    window.clearTimeout((showMessage as any)._timer);
    (showMessage as any)._timer = window.setTimeout(() => {
        contextArea.innerHTML = "";
    }, 4000);

}


// ======================================================
// Refresh / Init
// ======================================================

export async function refreshPlan(): Promise<void> {

    if(!currentOrg) return;

    if(planViewMode === "month"){
        await refreshMonthView();
        return;
    }

    planDayCount = getPlanDayCount();
    const dayWidth = getPlanColWidth(planDayCount);

    document.documentElement.style.setProperty("--rack-col-width", `${dayWidth}px`);

    const days: Date[] = [];
    for(let i = 0; i < planDayCount; i++){
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

function startClock(): void {

    function updateClock(){
        const now = new Date();
        const dateStr = now.toLocaleDateString("de-DE", {day:"2-digit", month:"2-digit", year:"numeric"});
        const timeStr = now.toLocaleTimeString("de-DE", {hour:"2-digit", minute:"2-digit", second:"2-digit"});

        const dateEl = document.getElementById("clockDate");
        const timeEl = document.getElementById("clockTime");

        if(dateEl) dateEl.textContent = dateStr;
        if(timeEl) timeEl.textContent = timeStr;
    }

    updateClock();
    setInterval(updateClock, 1000);

}

function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {

    let timer: number;

    return ((...args: any[]) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => fn(...args), delay);
    }) as T;

}
document.addEventListener("DOMContentLoaded", async () => {

    updatePlanViewModeButtons();
    setupPlanDragAndDrop();
    setupMonthDragAndDrop();
    setupMonthSwipe();

    const loggedIn = await bootstrapAuth().catch(err => {
        console.error("bootstrapAuth failed:", err);
        return false;
    });

    initPageHeader();
    renderUserArea();
    renderNavigation(currentMembership?.role ?? null);

    setScheduleViewContainer(planViewMode);
    centerPlanOnDate(startOfToday());

    if(!loggedIn){
        applyAuthVisibility();
        return;
    }

    try {
        await refreshPlan();
    } catch(err){
        console.error("Dashboard init failed:", err);
    }

    window.addEventListener("resize", debounce(() => {
        const newDayCount = getPlanDayCount();
        if(newDayCount !== planDayCount){
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

(window as any).dienstplan = {
    changeDate,
    changeSelectedDate,
    planSetViewMode,
    changeMonth,
    onMonthPickerChange,
    closeShiftPopup,
    submitShiftPopup,
    checkIn,
    checkOut,
    approveTimeEntry,
    managerSetTimeEntry,
    rejectTimeEntry,
    submitComplaint,
    requestLeave,
    reviewLeave
};