// Mirrors the Supabase tables (backend/sql/schema.sql).
export type MembershipRole = "employee" | "manager" | "admin";

export interface OrganizationSettings {
    workplace_lat?: number | null;
    workplace_lng?: number | null;
    checkin_radius_m?: number;
    checkin_strict?: "off" | "warn" | "enforce";
    role_labels?: string[] | null;
    leave_cutoff_days?: number | null;
    shift_min_hours?: number | null;
    shift_max_hours?: number | null;
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
    notes: string | null;
    status: "draft" | "published";
}

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
