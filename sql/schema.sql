-- ======================================================
-- Dienstplan — Supabase schema (hardened)
--
-- Hardening changes (security audit 2026-08):
--   * my_membership_id() now ignores inactive memberships
--   * all employee INSERT policies require active membership
--   * memberships: managers may only manage 'employee' rows;
--     only owners manage manager/owner rows
--   * trg_last_owner: an org must always keep >= 1 active owner
--   * trg_protect_time_entry: employees cannot rewrite
--     clock_in / original_clock_in / source on pending entries
--   * trg_validate_complaint: complaints may only target the
--     filer's OWN time entries
--   * moddatetime triggers keep updated_at accurate
--   * storage policies for the complaint-evidence bucket
--   * extra indexes + CHECK constraint on leave dates
--
-- This is a SEPARATE Supabase project from the Hotel PMS one.
-- Multi-tenant: everything hangs off "organizations".
-- NOTE: this script is for FRESH installs only — do not run
-- against a database that already has these objects.
-- ======================================================

create extension if not exists "pgcrypto";
create extension if not exists "moddatetime";

-- ======================================================
-- ORGANIZATIONS (tenants)
-- ======================================================

create table organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    timezone text not null default 'Europe/Berlin',
    settings jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- ======================================================
-- MEMBERSHIPS
-- ======================================================

create table memberships (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,

    role text not null check (role in ('owner', 'manager', 'employee')),

    full_name text not null,
    employee_code text,
    hourly_wage numeric(10,2),
    weekly_target_hours numeric(5,2) not null default 40,

    active boolean not null default true,
    created_at timestamptz not null default now(),

    unique (organization_id, user_id)
);

create index idx_memberships_org on memberships(organization_id);
create index idx_memberships_user on memberships(user_id);

-- ======================================================
-- SHIFTS
-- ======================================================

create table shifts (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    membership_id uuid not null references memberships(id) on delete cascade,

    shift_date date not null,
    start_time time not null,
    end_time time not null,
    is_night_shift boolean not null default false,
    break_minutes integer not null default 0,

    role_label text,
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
-- SHIFT CHANGE REQUESTS
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
-- TIME ENTRIES
-- ======================================================

create table time_entries (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    membership_id uuid not null references memberships(id) on delete cascade,
    shift_id uuid references shifts(id) on delete set null,

    clock_in timestamptz,
    clock_out timestamptz,

    original_clock_in timestamptz,
    original_clock_out timestamptz,

    source text not null default 'employee'
        check (source in ('employee', 'manager', 'system')),

    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected')),

    employee_note text,
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
-- COMPLAINTS
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
    file_path text not null,
    file_name text not null,
    uploaded_at timestamptz not null default now()
);

-- FK columns are not auto-indexed in Postgres
create index idx_complaint_evidence_complaint on complaint_evidence(complaint_id);

-- ======================================================
-- LEAVE REQUESTS
-- ======================================================

create table leave_requests (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    membership_id uuid not null references memberships(id) on delete cascade,

    type text not null check (type in ('freiwunsch', 'urlaub', 'sick')),

    date_start date not null,
    date_end date not null,

    -- enforce sane ranges at the DB level, not just in the UI
    constraint leave_dates_sane check (date_end >= date_start),

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
-- HELPER FUNCTIONS (SECURITY DEFINER — bypass RLS so the
-- policies below don't recurse)
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

-- Inactive memberships no longer resolve -> deactivated staff
-- lose all self-scoped access immediately.
create or replace function my_membership_id(check_org_id uuid)
returns uuid
language sql
security definer
stable
as $$
    select id from memberships
    where organization_id = check_org_id
      and user_id = auth.uid()
      and active = true
    limit 1;
$$;

-- ======================================================
-- INTEGRITY TRIGGERS
-- ======================================================

-- Employees may close out their own pending entry (check-out),
-- but must never rewrite when they clocked IN, the original
-- snapshot, or the source flag. Managers bypass this.
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

-- Every org must always keep at least one active owner.
create or replace function prevent_last_owner_removal()
returns trigger language plpgsql as $$
declare
    owner_count int;
begin
    if old.role = 'owner'
       and (tg_op = 'DELETE' or new.role <> 'owner' or new.active = false) then
        select count(*) into owner_count
        from memberships
        where organization_id = old.organization_id
          and role = 'owner'
          and active;
        if owner_count <= 1 then
            raise exception 'Organization must keep at least one active owner';
        end if;
    end if;
    return coalesce(new, old);
end $$;

create trigger trg_last_owner
    before delete or update on memberships
    for each row execute function prevent_last_owner_removal();

-- A complaint may only target the filer's OWN time entry.
create or replace function validate_complaint_target()
returns trigger language plpgsql
security definer
as $$
begin
    if not exists (
        select 1 from time_entries te
        where te.id = new.time_entry_id
          and te.membership_id = new.membership_id
    ) then
        raise exception 'You can only complain about your own time entries';
    end if;
    return new;
end $$;

create trigger trg_validate_complaint
    before insert on complaints
    for each row execute function validate_complaint_target();

-- updated_at maintenance (app code sometimes forgets)
create trigger trg_time_entries_updated_at
    before update on time_entries
    for each row execute procedure moddatetime(updated_at);

create trigger trg_shifts_updated_at
    before update on shifts
    for each row execute procedure moddatetime(updated_at);

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

-- organizations
create policy "org members can read their org"
    on organizations for select
    using (is_org_member(id));

-- memberships
create policy "org members can read memberships"
    on memberships for select
    using (is_org_member(organization_id));

-- Managers restricted to plain employees; owners handle
-- manager/owner rows (no more privilege escalation).
create policy "managers can manage employees"
    on memberships for all
    using (is_org_manager(organization_id) and role = 'employee')
    with check (is_org_manager(organization_id) and role = 'employee');

create policy "owners manage all memberships"
    on memberships for all
    using (
        exists (
            select 1 from memberships m
            where m.organization_id = memberships.organization_id
              and m.user_id = auth.uid()
              and m.role = 'owner'
              and m.active
        )
    )
    with check (
        exists (
            select 1 from memberships m
            where m.organization_id = memberships.organization_id
              and m.user_id = auth.uid()
              and m.role = 'owner'
              and m.active
        )
    );

-- shifts
create policy "org members can read shifts"
    on shifts for select
    using (is_org_member(organization_id));

create policy "managers can manage shifts"
    on shifts for all
    using (is_org_manager(organization_id))
    with check (is_org_manager(organization_id));

-- time_entries
create policy "employees can read own time entries"
    on time_entries for select
    using (
        membership_id = my_membership_id(organization_id)
        or is_org_manager(organization_id)
    );

-- Requires ACTIVE membership (is_org_member).
create policy "employees can insert own pending time entries"
    on time_entries for insert
    with check (
        membership_id = my_membership_id(organization_id)
        and is_org_member(organization_id)
        and source = 'employee'
        and status = 'pending'
    );

create policy "employees can update own pending time entries"
    on time_entries for update
    using (membership_id = my_membership_id(organization_id) and status = 'pending')
    with check (membership_id = my_membership_id(organization_id) and status = 'pending');
-- NOTE: the policy above is intentionally column-permissive, but
-- trg_protect_time_entry locks clock_in/original_clock_in/source.

create policy "managers can write any time entry"
    on time_entries for update
    using (is_org_manager(organization_id))
    with check (is_org_manager(organization_id));

create policy "managers can delete time entries"
    on time_entries for delete
    using (is_org_manager(organization_id));

-- complaints
create policy "read own or managed complaints"
    on complaints for select
    using (
        membership_id = my_membership_id(organization_id)
        or is_org_manager(organization_id)
    );

-- Requires ACTIVE membership.
create policy "employees can file complaints on own entries"
    on complaints for insert
    with check (
        membership_id = my_membership_id(organization_id)
        and is_org_member(organization_id)
        and status = 'open'
    );
-- NOTE: trg_validate_complaint enforces the target entry is the
-- filer's own — RLS alone cannot express that.

create policy "managers can resolve complaints"
    on complaints for update
    using (is_org_manager(organization_id))
    with check (is_org_manager(organization_id));

-- complaint_evidence
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

create policy "employees can attach evidence to own complaints"
    on complaint_evidence for insert
    with check (
        exists (
            select 1 from complaints c
            where c.id = complaint_id
            and c.membership_id = my_membership_id(c.organization_id)
        )
    );

-- leave_requests
create policy "read own or managed leave requests"
    on leave_requests for select
    using (
        membership_id = my_membership_id(organization_id)
        or is_org_manager(organization_id)
    );

-- Requires ACTIVE membership.
create policy "employees can request own leave"
    on leave_requests for insert
    with check (
        membership_id = my_membership_id(organization_id)
        and is_org_member(organization_id)
        and status = 'pending'
    );

create policy "managers can review leave requests"
    on leave_requests for update
    using (is_org_manager(organization_id))
    with check (is_org_manager(organization_id));

-- shift_change_requests
create policy "read own or managed shift change requests"
    on shift_change_requests for select
    using (
        requested_by_membership_id = my_membership_id(organization_id)
        or is_org_manager(organization_id)
    );

-- Requires ACTIVE membership.
create policy "employees can propose shift changes"
    on shift_change_requests for insert
    with check (
        requested_by_membership_id = my_membership_id(organization_id)
        and is_org_member(organization_id)
        and status = 'pending'
    );

create policy "managers can review shift change requests"
    on shift_change_requests for update
    using (is_org_manager(organization_id))
    with check (is_org_manager(organization_id));

-- ======================================================
-- STORAGE — complaint evidence (private bucket)
-- ======================================================

insert into storage.buckets (id, name, public)
values ('complaint-evidence', 'complaint-evidence', false)
on conflict (id) do nothing;

create policy "evidence upload by complaint owner"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'complaint-evidence'
        and exists (
            select 1 from complaints c
            where c.id::text = (storage.foldername(name))[1]
              and c.membership_id = my_membership_id(c.organization_id)
              and c.status = 'open'
        )
    );

create policy "evidence read by owner or manager"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'complaint-evidence'
        and exists (
            select 1 from complaints c
            where c.id::text = (storage.foldername(name))[1]
              and (c.membership_id = my_membership_id(c.organization_id)
                   or is_org_manager(c.organization_id))
        )
    );