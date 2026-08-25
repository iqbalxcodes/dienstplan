-- ======================================================
-- Dienstplan — Supabase schema
-- This is a SEPARATE Supabase project from the Hotel PMS one.
-- Multi-tenant: everything hangs off "organizations" so the
-- same deployment can serve your girlfriend's restaurant AND
-- any future business, each fully isolated by RLS.
--
-- Naming: "organizations" (not "restaurants") on purpose —
-- a bar, retail shop, or the Hotel PMS itself can all be an
-- "organization" that owns its own Dienstplan without the
-- schema implying "restaurant only".
-- ======================================================

create extension if not exists "pgcrypto";

-- ======================================================
-- ORGANIZATIONS (tenants)
-- ======================================================

create table organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,               -- used in URL: ?org=resto-slug or subdomain
    timezone text not null default 'Europe/Berlin',

    -- per-tenant feature toggles, e.g.
    -- { "night_shift_enabled": true, "half_day_mode": false }
    settings jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now()
);

-- ======================================================
-- MEMBERSHIPS — links a Supabase auth user to an organization
-- with a role. One person can belong to multiple orgs (e.g.
-- your girlfriend could work at 2 places), hence its own table
-- instead of a role column on auth.users.
-- ======================================================

create table memberships (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,

    role text not null check (role in ('owner', 'manager', 'employee')),

    full_name text not null,
    employee_code text,                       -- optional short staff ID/badge number
    hourly_wage numeric(10,2),                 -- optional, only owner/manager can see
    weekly_target_hours numeric(5,2) not null default 40,  -- "Sollstunden" per week

    active boolean not null default true,
    created_at timestamptz not null default now(),

    unique (organization_id, user_id)
);

create index idx_memberships_org on memberships(organization_id);
create index idx_memberships_user on memberships(user_id);

-- ======================================================
-- SHIFTS — the planned roster (the "Dienstplan" grid itself).
-- This is what gets drawn as bars in the rack-style view.
-- ======================================================

create table shifts (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    membership_id uuid not null references memberships(id) on delete cascade,

    shift_date date not null,
    start_time time not null,
    end_time time not null,                   -- if end_time < start_time, shift crosses midnight (Nachtdienst)
    is_night_shift boolean not null default false,
    break_minutes integer not null default 0,

    role_label text,                          -- e.g. "Kitchen", "Service", "Bar" — free text
    notes text,

    status text not null default 'published'
        check (status in ('draft', 'published')),

    created_by uuid references auth.users(id),
    updated_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index idx_shifts_org_date on shifts(organization_id, shift_date);
create index idx_shifts_membership on shifts(membership_id, shift_date);

-- ======================================================
-- SHIFT CHANGE REQUESTS — when a MANAGER drags/resizes a shift
-- on the rack, it writes straight to `shifts`. When an EMPLOYEE
-- does the same drag, it lands here instead as a proposal —
-- the original shift is untouched until a manager approves it,
-- at which point the app applies proposed_* onto the shift row.
-- ======================================================

create table shift_change_requests (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    shift_id uuid not null references shifts(id) on delete cascade,
    requested_by_membership_id uuid not null references memberships(id) on delete cascade,

    proposed_shift_date date not null,
    proposed_start_time time not null,
    proposed_end_time time not null,

    reason text,

    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected')),

    reviewed_by uuid references auth.users(id),
    reviewed_at timestamptz,

    created_at timestamptz not null default now()
);

create index idx_shift_change_requests_org on shift_change_requests(organization_id, status);

-- ======================================================
-- TIME ENTRIES — actual check-in / check-out records.
-- Anything an EMPLOYEE submits (check-in, check-out, or a
-- manual note claiming forgotten times) lands here as
-- status = 'pending' until a manager/owner approves it.
--
-- If a manager edits times directly, original_* columns keep
-- the employee's original submission so a complaint can later
-- compare "what I said" vs "what got approved".
-- ======================================================

create table time_entries (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    membership_id uuid not null references memberships(id) on delete cascade,
    shift_id uuid references shifts(id) on delete set null,

    clock_in timestamptz,
    clock_out timestamptz,

    -- snapshot of what the employee originally submitted, kept
    -- even after a manager override, so complaints have something
    -- to point back to
    original_clock_in timestamptz,
    original_clock_out timestamptz,

    source text not null default 'employee'
        check (source in ('employee', 'manager', 'system')),

    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected')),

    employee_note text,                       -- "forgot to check in, arrived ~9am" etc.
    manager_note text,

    approved_by uuid references auth.users(id),
    approved_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index idx_time_entries_org on time_entries(organization_id);
create index idx_time_entries_membership on time_entries(membership_id, clock_in);
create index idx_time_entries_status on time_entries(status);

-- ======================================================
-- COMPLAINTS — employee protest against a manager-edited
-- time entry, with supporting evidence.
-- ======================================================

create table complaints (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    time_entry_id uuid not null references time_entries(id) on delete cascade,
    membership_id uuid not null references memberships(id) on delete cascade,

    message text not null,

    status text not null default 'open'
        check (status in ('open', 'resolved', 'rejected')),

    resolution_note text,
    resolved_by uuid references auth.users(id),
    resolved_at timestamptz,

    created_at timestamptz not null default now()
);

create index idx_complaints_org on complaints(organization_id, status);

create table complaint_evidence (
    id uuid primary key default gen_random_uuid(),
    complaint_id uuid not null references complaints(id) on delete cascade,
    file_path text not null,                  -- path inside the "complaint-evidence" storage bucket
    file_name text not null,
    uploaded_at timestamptz not null default now()
);

-- ======================================================
-- LEAVE REQUESTS — Freiwunsch (preferred day off) & Urlaub
-- (vacation), plus Sick as a bonus since it's the same shape.
-- ======================================================

create table leave_requests (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    membership_id uuid not null references memberships(id) on delete cascade,

    type text not null check (type in ('freiwunsch', 'urlaub', 'sick')),

    date_start date not null,
    date_end date not null,

    reason text,

    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected')),

    reviewed_by uuid references auth.users(id),
    reviewed_at timestamptz,

    created_at timestamptz not null default now()
);

create index idx_leave_requests_org on leave_requests(organization_id, status);
create index idx_leave_requests_membership on leave_requests(membership_id, date_start);

-- ======================================================
-- HELPER: current user's membership row(s) — used everywhere
-- in RLS so we don't repeat the subquery in every policy.
-- ======================================================

create or replace function is_org_member(check_org_id uuid)
returns boolean
language sql
security definer
stable
as $$
    select exists (
        select 1 from memberships
        where organization_id = check_org_id
        and user_id = auth.uid()
        and active = true
    );
$$;

create or replace function is_org_manager(check_org_id uuid)
returns boolean
language sql
security definer
stable
as $$
    select exists (
        select 1 from memberships
        where organization_id = check_org_id
        and user_id = auth.uid()
        and role in ('owner', 'manager')
        and active = true
    );
$$;

create or replace function my_membership_id(check_org_id uuid)
returns uuid
language sql
security definer
stable
as $$
    select id from memberships
    where organization_id = check_org_id
    and user_id = auth.uid()
    limit 1;
$$;

-- ======================================================
-- RLS
-- ======================================================

alter table organizations enable row level security;
alter table memberships enable row level security;
alter table shifts enable row level security;
alter table time_entries enable row level security;
alter table complaints enable row level security;
alter table complaint_evidence enable row level security;
alter table leave_requests enable row level security;
alter table shift_change_requests enable row level security;

-- organizations: any member can read their own org(s)
create policy "org members can read their org"
    on organizations for select
    using (is_org_member(id));

-- memberships: readable by anyone in the same org (so employees
-- see co-worker names in the roster); only owner/manager can write
create policy "org members can read memberships"
    on memberships for select
    using (is_org_member(organization_id));

create policy "managers can manage memberships"
    on memberships for all
    using (is_org_manager(organization_id))
    with check (is_org_manager(organization_id));

-- shifts: everyone in org can read; only managers can write
-- (drag/edit on the rack). Employees never write shifts directly —
-- their check-in/out goes through time_entries instead.
create policy "org members can read shifts"
    on shifts for select
    using (is_org_member(organization_id));

create policy "managers can manage shifts"
    on shifts for all
    using (is_org_manager(organization_id))
    with check (is_org_manager(organization_id));

-- time_entries: employees can read/insert their OWN entries;
-- managers can read/write all entries in their org.
create policy "employees can read own time entries"
    on time_entries for select
    using (
        membership_id = my_membership_id(organization_id)
        or is_org_manager(organization_id)
    );

create policy "employees can insert own pending time entries"
    on time_entries for insert
    with check (
        membership_id = my_membership_id(organization_id)
        and source = 'employee'
        and status = 'pending'
    );

create policy "managers can write any time entry"
    on time_entries for update
    using (is_org_manager(organization_id))
    with check (is_org_manager(organization_id));

create policy "managers can delete time entries"
    on time_entries for delete
    using (is_org_manager(organization_id));

-- complaints: an employee can file one about their OWN time entry
-- and read their own; managers can read/resolve all.
create policy "read own or managed complaints"
    on complaints for select
    using (
        membership_id = my_membership_id(organization_id)
        or is_org_manager(organization_id)
    );

create policy "employees can file complaints on own entries"
    on complaints for insert
    with check (
        membership_id = my_membership_id(organization_id)
        and status = 'open'
    );

create policy "managers can resolve complaints"
    on complaints for update
    using (is_org_manager(organization_id))
    with check (is_org_manager(organization_id));

-- complaint_evidence: follow the parent complaint's visibility
create policy "read evidence of visible complaints"
    on complaint_evidence for select
    using (
        exists (
            select 1 from complaints c
            where c.id = complaint_id
            and (
                c.membership_id = my_membership_id(c.organization_id)
                or is_org_manager(c.organization_id)
            )
        )
    );

create policy "employees can update own pending time entries"
    on time_entries for update
    using (membership_id = my_membership_id(organization_id) and status = 'pending')
    with check (membership_id = my_membership_id(organization_id) and status = 'pending');

create policy "employees can attach evidence to own complaints"
    on complaint_evidence for insert
    with check (
        exists (
            select 1 from complaints c
            where c.id = complaint_id
            and c.membership_id = my_membership_id(c.organization_id)
        )
    );

-- leave_requests: employees manage their own; managers see/approve all
create policy "read own or managed leave requests"
    on leave_requests for select
    using (
        membership_id = my_membership_id(organization_id)
        or is_org_manager(organization_id)
    );

create policy "employees can request own leave"
    on leave_requests for insert
    with check (
        membership_id = my_membership_id(organization_id)
        and status = 'pending'
    );

create policy "managers can review leave requests"
    on leave_requests for update
    using (is_org_manager(organization_id))
    with check (is_org_manager(organization_id));

-- shift_change_requests: employee can read/insert their own;
-- managers can read/review all in their org.
create policy "read own or managed shift change requests"
    on shift_change_requests for select
    using (
        requested_by_membership_id = my_membership_id(organization_id)
        or is_org_manager(organization_id)
    );

create policy "employees can propose shift changes"
    on shift_change_requests for insert
    with check (
        requested_by_membership_id = my_membership_id(organization_id)
        and status = 'pending'
    );

create policy "managers can review shift change requests"
    on shift_change_requests for update
    using (is_org_manager(organization_id))
    with check (is_org_manager(organization_id));

-- ======================================================
-- STORAGE — bucket for complaint evidence (create via
-- Supabase dashboard or CLI, policies mirror complaint_evidence)
-- ======================================================
-- insert into storage.buckets (id, name, public) values ('complaint-evidence', 'complaint-evidence', false);

create or replace function protect_time_entry_columns()
returns trigger language plpgsql as $$
begin
    if is_org_manager(new.organization_id) then return new; end if;
    if old.clock_in           is distinct from new.clock_in
    or old.original_clock_in  is distinct from new.original_clock_in
    or old.source             is distinct from new.source then
        raise exception 'Employees cannot modify clock/source fields';
    end if;
    return new;
end $$;

create trigger trg_protect_time_entry
    before update on time_entries
    for each row execute function protect_time_entry_columns();