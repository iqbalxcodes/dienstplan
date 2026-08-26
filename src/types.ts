// ======================================================
// types.ts
// Shared types for Dienstplan. Mirrors the shape of the
// Supabase tables in sql/schema.sql 1:1 so the rest of the
// app can stay strongly typed.
// ======================================================

export type MembershipRole = "employee" | "manager" | "admin";

export interface Organization {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    settings: OrganizationSettings;
    created_at: string;
}

export interface OrganizationSettings {
    night_shift_enabled?: boolean;
    half_day_mode?: boolean;
    default_break_minutes?: number;

    // location & attendance
    workplace_lat?: number;
    workplace_lng?: number;
    checkin_radius_m?: number;
    checkin_strict?: "off" | "warn" | "enforce";

    // staff role labels shown in dashboard dropdown
    role_labels?: string[];

    // scheduling rules
    leave_cutoff_days?: number;
    shift_min_hours?: number;
    shift_max_hours?: number;
}

export interface Membership {
    id: string;
    organization_id: string;
    user_id: string;
    role: MembershipRole;
    full_name: string;
    employee_code: string | null;
    hourly_wage: number | null;
    weekly_target_hours: number;
    active: boolean;
    created_at: string;
}

export type ShiftStatus = "draft" | "published";

export interface Shift {
    id: string;
    organization_id: string;
    membership_id: string;
    shift_date: string;      // YYYY-MM-DD
    start_time: string;      // HH:MM:SS
    end_time: string;        // HH:MM:SS
    is_night_shift: boolean;
    break_minutes: number;
    role_label: string | null;
    notes: string | null;
    status: ShiftStatus;
    created_by: string | null;
    updated_by: string | null;
    created_at: string;
    updated_at: string;
}

export type TimeEntrySource = "employee" | "manager" | "system";
export type TimeEntryStatus = "pending" | "approved" | "rejected";

export interface TimeEntry {
    id: string;
    organization_id: string;
    membership_id: string;
    shift_id: string | null;
    clock_in: string | null;   // ISO timestamptz
    clock_out: string | null;  // ISO timestamptz
    original_clock_in: string | null;
    original_clock_out: string | null;
    source: TimeEntrySource;
    status: TimeEntryStatus;
    employee_note: string | null;
    manager_note: string | null;
    approved_by: string | null;
    approved_at: string | null;
    created_at: string;
    updated_at: string;
    role_label: string | null;
}

export type ComplaintStatus = "open" | "resolved" | "rejected";

export interface Complaint {
    id: string;
    organization_id: string;
    time_entry_id: string;
    membership_id: string;
    message: string;
    status: ComplaintStatus;
    resolution_note: string | null;
    resolved_by: string | null;
    resolved_at: string | null;
    created_at: string;
}

export interface ComplaintEvidence {
    id: string;
    complaint_id: string;
    file_path: string;
    file_name: string;
    uploaded_at: string;
}

export type ShiftChangeStatus = "pending" | "approved" | "rejected";

export interface ShiftChangeRequest {
    id: string;
    organization_id: string;
    shift_id: string;
    requested_by_membership_id: string;
    proposed_shift_date: string;
    proposed_start_time: string;
    proposed_end_time: string;
    reason: string | null;
    status: ShiftChangeStatus;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
}

export type LeaveType = "freiwunsch" | "urlaub" | "sick";
export type LeaveStatus = "pending" | "approved" | "rejected";

export interface LeaveRequest {
    id: string;
    organization_id: string;
    membership_id: string;
    type: LeaveType;
    date_start: string;
    date_end: string;
    reason: string | null;
    status: LeaveStatus;
    reviewed_by: string | null;
    reviewed_at: string | null;
    created_at: string;
}

// ======================================================
// UI-only helper types (not tables)
// ======================================================

export interface HalfDayRange {
    // half-day index counting from an arbitrary epoch, same
    // trick as RoomAvailability's getOccupiedRange — but here
    // only used when settings.half_day_mode is on.
    start: number;
    end: number;
}

export interface HoursSummary {
    membershipId: string;
    periodLabel: string;      // e.g. "KW 34" or "Aug 2026"
    sollHours: number;        // target hours for the period
    istHours: number;         // actual approved hours worked
    ueberstunden: number;     // istHours - sollHours (can be negative = Minusstunden)
}
