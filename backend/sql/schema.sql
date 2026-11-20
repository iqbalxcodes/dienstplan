-- ======================================================
-- Dienstplan — table structure of the LIVE Supabase project
-- (introspected). Reference only: RLS policies, triggers, helper
-- functions (is_org_member, is_org_manager, my_membership_id,
-- log_recovery_sent), the "complaint-evidence" Storage bucket and the
-- send-shift-reminders Edge Function live in Supabase and are NOT
-- versioned here. Export them with `supabase db dump` / `supabase functions download`
-- and commit them under backend/ if you want them in git.
--
-- No seed data on purpose: organizations and users are created in Supabase
-- (Authentication -> Add user, or the in-app "Register your business" flow).
-- ======================================================

create table public.organizations (
  id uuid not null default gen_random_uuid() primary key,
  name text not null,
  slug text not null unique,
  timezone text not null default 'Europe/Berlin',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id),
  user_id uuid references auth.users(id),            -- null = member without login yet
  role text not null check (role in ('employee', 'manager', 'admin')),
  full_name text not null,
  employee_code text,
  hourly_wage numeric,
  weekly_target_hours numeric not null default 40,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  email text
);

create table public.shifts (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id),
  membership_id uuid not null references public.memberships(id),
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  is_night_shift boolean not null default false,
  break_minutes integer not null default 0,
  role_label text,
  notes text,
  status text not null default 'published' check (status in ('draft', 'published')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reminder_sent_start boolean not null default false,
  reminder_sent_end boolean not null default false
);

create table public.shift_change_requests (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id),
  shift_id uuid not null references public.shifts(id),
  requested_by_membership_id uuid not null references public.memberships(id),
  proposed_shift_date date not null,
  proposed_start_time time not null,
  proposed_end_time time not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.time_entries (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id),
  membership_id uuid not null references public.memberships(id),
  shift_id uuid references public.shifts(id),
  clock_in timestamptz,
  clock_out timestamptz,
  original_clock_in timestamptz,
  original_clock_out timestamptz,
  source text not null default 'employee' check (source in ('employee', 'manager', 'system')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  employee_note text,
  manager_note text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  role_label text
);

create table public.complaints (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id),
  time_entry_id uuid not null references public.time_entries(id),
  membership_id uuid not null references public.memberships(id),
  message text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  resolution_note text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.complaint_evidence (
  id uuid not null default gen_random_uuid() primary key,
  complaint_id uuid not null references public.complaints(id),
  file_path text not null,
  file_name text not null,
  uploaded_at timestamptz not null default now()
);

create table public.leave_requests (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id),
  membership_id uuid not null references public.memberships(id),
  type text not null check (type in ('freiwunsch', 'urlaub', 'sick')),
  date_start date not null,
  date_end date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.activity_log (
  id uuid not null default gen_random_uuid() primary key,
  organization_id uuid not null references public.organizations(id),
  actor_membership_id uuid references public.memberships(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  summary text not null default '',
  details jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table public.push_subscriptions (
  id uuid not null default gen_random_uuid() primary key,
  membership_id uuid not null references public.memberships(id),
  organization_id uuid not null references public.organizations(id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
