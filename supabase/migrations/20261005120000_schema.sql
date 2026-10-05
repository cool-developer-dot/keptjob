-- AI Sales CRM V1: schema (enums, tables, constraints, indexes).
-- SPEC.md §2–§9 is the source of truth. Functions, triggers and the flags view
-- live in the next migration; RLS is added in Prompt 2.

-- ---------------------------------------------------------------------------
-- Enums (exact SPEC values and order; mirrored in src/lib/constants.ts)
-- ---------------------------------------------------------------------------
create type public.pipeline_stage as enum (
  'prospect',
  'contacted',
  'conversation',
  'qualified',
  'demo_booked',
  'demo_attended',
  'follow_up',
  'closed_won',
  'closed_lost'
);

create type public.decision_maker_status as enum ('yes', 'no', 'unknown');

create type public.objection_category as enum (
  'price',
  'timing',
  'competitor',
  'budget',
  'no_authority',
  'not_interested',
  'other'
);

create type public.activity_type as enum (
  'call',
  'conversation',
  'note',
  'demo',
  'follow_up',
  'stage_change',
  'owner_change',
  'ai_insight'
);

create type public.follow_up_status as enum ('pending', 'completed');

create type public.deal_health as enum ('high', 'medium', 'low');

create type public.user_role as enum ('manager', 'sales_rep');

-- ---------------------------------------------------------------------------
-- users: one row per auth user (created by the handle_new_user trigger)
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null,
  role public.user_role not null default 'sales_rep',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.users.role is
  'Mirrors auth.users.raw_app_meta_data.role. Never taken from user-editable metadata.';

-- ---------------------------------------------------------------------------
-- org_settings: exactly one row (id = true)
-- ---------------------------------------------------------------------------
create table public.org_settings (
  id boolean primary key default true,
  default_currency char(3) not null default 'USD',
  timezone text not null default 'America/New_York',
  stale_days integer not null default 14,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null,
  constraint org_settings_single_row check (id),
  constraint org_settings_currency_check check (default_currency ~ '^[A-Z]{3}$'),
  constraint org_settings_timezone_check check (
    timezone in (
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Phoenix',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu'
    )
  ),
  constraint org_settings_stale_days_check check (stale_days between 1 and 365)
);

insert into public.org_settings default values on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- prospects
-- ---------------------------------------------------------------------------
create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text,
  phone text,
  stage public.pipeline_stage not null default 'prospect',
  decision_maker_status public.decision_maker_status not null default 'unknown',
  objections public.objection_category[] not null default '{}',
  objection_notes text,
  notes text,
  -- Derived: earliest pending follow-up due date (maintained by a trigger).
  follow_up_date date,
  demo_at timestamptz,
  close_reason text,
  close_notes text,
  closed_at timestamptz,
  deal_value numeric(12, 2),
  currency char(3) not null,
  owner_id uuid not null references public.users (id) on delete restrict,
  created_by uuid default auth.uid() references public.users (id) on delete set null,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospects_name_check check (btrim(name) <> ''),
  constraint prospects_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint prospects_deal_value_check check (deal_value >= 0),
  constraint prospects_close_reason_check check (
    case stage
      when 'closed_won' then close_reason is not null
        and close_reason in ('product_fit', 'price_value', 'relationship', 'urgent_need', 'other')
      when 'closed_lost' then close_reason is not null
        and close_reason in ('price', 'timing', 'competitor', 'no_budget', 'no_response', 'not_a_fit', 'other')
      else close_reason is null
    end
  ),
  constraint prospects_closed_fields_check check (
    (stage in ('closed_won', 'closed_lost')) = (closed_at is not null)
    and (stage in ('closed_won', 'closed_lost') or close_notes is null)
  )
);

comment on column public.prospects.follow_up_date is
  'Derived: min(due_date) of pending follow_ups. Managed by trigger; never edit directly.';

-- ---------------------------------------------------------------------------
-- activities (append-only timeline)
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  user_id uuid default auth.uid() references public.users (id) on delete set null,
  type public.activity_type not null,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- follow_ups
-- ---------------------------------------------------------------------------
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  owner_id uuid not null references public.users (id) on delete restrict,
  due_date date not null,
  note text not null,
  status public.follow_up_status not null default 'pending',
  completed_at timestamptz,
  completed_by uuid references public.users (id) on delete set null,
  created_by uuid default auth.uid() references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint follow_ups_completed_check check ((status = 'completed') = (completed_at is not null))
);

-- ---------------------------------------------------------------------------
-- stage_history (append-only; written by triggers)
-- ---------------------------------------------------------------------------
create table public.stage_history (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  from_stage public.pipeline_stage,
  to_stage public.pipeline_stage not null,
  -- Null only for seed/system writes.
  changed_by uuid references public.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  close_reason text,
  note text
);

-- ---------------------------------------------------------------------------
-- ai_insights (append-only)
-- ---------------------------------------------------------------------------
create table public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  summary text not null,
  decision_maker_status public.decision_maker_status not null,
  main_objection text not null,
  recommended_next_step text not null,
  deal_health public.deal_health not null,
  model text not null,
  created_by uuid default auth.uid() references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes (every FK column is the leading column of some index)
-- ---------------------------------------------------------------------------
create index org_settings_updated_by_idx on public.org_settings (updated_by);

create index prospects_owner_id_idx on public.prospects (owner_id);
create index prospects_stage_idx on public.prospects (stage);
create index prospects_follow_up_date_idx on public.prospects (follow_up_date);
create index prospects_last_activity_at_idx on public.prospects (last_activity_at);
create index prospects_created_by_idx on public.prospects (created_by);

create index activities_prospect_id_occurred_at_idx on public.activities (prospect_id, occurred_at desc);
create index activities_user_id_idx on public.activities (user_id);

create index follow_ups_status_due_date_idx on public.follow_ups (status, due_date);
create index follow_ups_owner_id_idx on public.follow_ups (owner_id);
create index follow_ups_prospect_id_idx on public.follow_ups (prospect_id);
create index follow_ups_completed_by_idx on public.follow_ups (completed_by);
create index follow_ups_created_by_idx on public.follow_ups (created_by);

create index stage_history_prospect_id_changed_at_idx on public.stage_history (prospect_id, changed_at);
create index stage_history_changed_by_idx on public.stage_history (changed_by);

create index ai_insights_prospect_id_created_at_idx on public.ai_insights (prospect_id, created_at desc);
create index ai_insights_created_by_created_at_idx on public.ai_insights (created_by, created_at);
