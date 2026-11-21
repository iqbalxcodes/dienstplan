// Mirrors the Supabase tables (backend/sql/schema.sql).
export type MembershipRole = "employee" | "manager" | "admin";

export interface ShiftType {
    code: string;                    // F, FX, M, U, Sch ...
    name: string;
    color: string;
    kind?: "work" | "off";           // off = U, Sch (no area/role/times)
    start?: string;                  // default "HH:MM" for work types
    end?: string;
}

export interface OrganizationSettings {
    shift_types?: ShiftType[];       // admin-defined shift codes + colors
    areas?: string[];                // admin-defined areas ("Restaurant", "Bar", ...)
    workplace_lat?: number | null;
    workplace_lng?: number | null;
    checkin_radius_m?: number;
    checkin_strict?: "off" | "warn" | "enforce";
    role_labels?: string[] | null;
    leave_cutoff_days?: number | null;
    shift_min_hours?: number | null;
    shift_max_hours?: number | null;
    vacation_days?: number;          // Jahresurlaub, default 30
}

export interface Organization {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    settings: OrganizationSettings;
    created_at: string;
}

export interface Membership {
    id: string;
    organization_id: string;
    user_id: string | null;
    role: MembershipRole;
    full_name: string;
    employee_code: string | null;
    hourly_wage: number | null;
    weekly_target_hours: number;
    active: boolean;
    created_at: string;
    email: string | null;
}

export interface Shift {
    id: string;
    organization_id: string;
    membership_id: string;
    shift_date: string;   // YYYY-MM-DD
    start_time: string;   // HH:MM:SS
    end_time: string;
    is_night_shift: boolean;
    break_minutes: number;
    role_label: string | null;
    shift_code?: string | null;      // needs migration 001
    area_label?: string | null;      // needs migration 001
    draft?: ShiftDraft | null;       // pending change of a published shift (migration 003)
    notes: string | null;
    status: "draft" | "published";
}

/** Unpublished change on a published shift: new values, or {_delete:true}. Employees keep seeing the old values until Publish. */
export type ShiftDraft = Partial<Pick<Shift, "shift_date" | "membership_id" | "start_time" | "end_time" | "shift_code" | "area_label" | "role_label">> & { _delete?: boolean };
export type EntryStatus = "pending" | "approved" | "rejected";

export interface TimeEntry {
    id: string;
    organization_id: string;
    membership_id: string;
    shift_id: string | null;
    clock_in: string | null;
    clock_out: string | null;
    original_clock_in: string | null;
    original_clock_out: string | null;
    source: "employee" | "manager" | "system";
    status: EntryStatus;
    employee_note: string | null;
    manager_note: string | null;
    role_label: string | null;
    shift_code?: string | null;      // needs migration 001
    area_label?: string | null;      // needs migration 001
    shifts?: Shift | null;           // joined via shift_id
}

export interface Complaint {
    id: string;
    time_entry_id: string;
    membership_id: string;
    message: string;
    status: "open" | "resolved" | "rejected";
    resolution_note: string | null;
}

export interface ShiftChangeRequest {
    id: string;
    organization_id: string;
    shift_id: string;
    requested_by_membership_id: string;
    proposed_shift_date: string;
    proposed_start_time: string;
    proposed_end_time: string;
    reason: string | null;
    status: EntryStatus;
}

export type LeaveType = "freiwunsch" | "urlaub" | "sick";

export interface LeaveRequest {
    id: string;
    organization_id: string;
    membership_id: string;
    type: LeaveType;
    date_start: string;
    date_end: string;
    reason: string | null;
    status: EntryStatus;
}

export const LEAVE_LABELS: Record<LeaveType, string> = {
    freiwunsch: "Freiwunsch",
    urlaub: "Urlaub",
    sick: "Krank"
};

export interface HoursSummary {
    sollHours: number;
    istHours: number;
    ueberstunden: number; // ist - soll (negative = Minusstunden)
}

export const DEFAULT_ROLES = ["Service crew", "Kitchen", "Bar", "Cashier", "Runner"];
export const DEFAULT_AREAS = ["Restaurant"];
export const DEFAULT_SHIFT_COLOR = "#17a53a";

export interface ShiftRequest {
    id: string;
    organization_id: string;
    membership_id: string;
    request_date: string;
    shift_code: string | null;
    area_label: string | null;
    role_label: string | null;
    start_time: string;
    end_time: string;
    status: EntryStatus;
}

export interface RosterNote {
    id: string;
    note_date: string | null;        // specific day -> "i" icon on that date
    weekday: number | null;          // 1=Mon..7=Sun, recurring (row under the weekday names)
    text: string;
}