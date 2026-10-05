-- AI Sales CRM V1: Row Level Security (SPEC §4).
-- RLS is the security boundary for every API request. Policies only call
-- SECURITY DEFINER helpers (is_manager, can_access_prospect) so they never
-- recurse into RLS on public.users / public.prospects. Grants are tightened
-- too: anon gets nothing, authenticated gets exactly what the policies need
-- (derived/system columns are not writable).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- is_manager() already exists (Prompt 1): sql, stable, security definer,
-- search_path = '', reads public.users.role for auth.uid().

-- True when the current user owns the prospect or is a manager.
-- False for unknown ids (leaks nothing).
create or replace function public.can_access_prospect(p_prospect_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.prospects p
    where p.id = p_prospect_id
      and (p.owner_id = auth.uid() or public.is_manager())
  );
$$;

-- ---------------------------------------------------------------------------
-- users: only managers change roles; users only rename themselves.
-- auth.uid() is null for the service role, GoTrue (auth.admin.updateUserById
-- → handle_auth_user_updated sync), seed and migrations: always allowed.
-- ---------------------------------------------------------------------------
create or replace function public.users_before_update_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role and not public.is_manager() then
    raise exception 'Only managers can change roles'
      using errcode = '42501';
  end if;

  if new.full_name is distinct from old.full_name and new.id <> auth.uid() then
    raise exception 'Users can only change their own name'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger users_before_update_guard
  before update on public.users
  for each row execute function public.users_before_update_guard();

-- ---------------------------------------------------------------------------
-- Enable RLS on every public table
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.org_settings enable row level security;
alter table public.prospects enable row level security;
alter table public.activities enable row level security;
alter table public.follow_ups enable row level security;
alter table public.stage_history enable row level security;
alter table public.ai_insights enable row level security;

-- ---------------------------------------------------------------------------
-- Grants: start from nothing for the API roles, then grant what policies need
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Future objects created by postgres (migrations) never reach anon.
-- NOTE: functions still get EXECUTE via PUBLIC by default; every new function
-- must `revoke execute ... from public, anon` explicitly.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

-- Functions callable by signed-in users (policies, view, RPC).
grant execute on function public.is_manager() to authenticated;
grant execute on function public.can_access_prospect(uuid) to authenticated;
grant execute on function public.org_today() to authenticated;
grant execute on function public.move_prospect_stage(uuid, public.pipeline_stage, text, text, text) to authenticated;

-- org_settings
grant select on public.org_settings to authenticated;
grant update (default_currency, timezone, stale_days) on public.org_settings to authenticated;

-- users (no insert/delete via the API)
grant select on public.users to authenticated;
grant update (full_name, role) on public.users to authenticated;

-- prospects (derived/system columns are not writable)
grant select, delete on public.prospects to authenticated;
grant insert (
  id, name, company, email, phone, stage, decision_maker_status, objections, objection_notes,
  notes, demo_at, close_reason, close_notes, deal_value, currency, owner_id
) on public.prospects to authenticated;
grant update (
  name, company, email, phone, stage, decision_maker_status, objections, objection_notes,
  notes, demo_at, close_reason, close_notes, deal_value, currency, owner_id
) on public.prospects to authenticated;

-- activities (append-only)
grant select on public.activities to authenticated;
grant insert (id, prospect_id, user_id, type, content, metadata, occurred_at) on public.activities to authenticated;

-- follow_ups (owner only moves via reassignment; prospect_id immutable)
grant select, delete on public.follow_ups to authenticated;
grant insert (id, prospect_id, owner_id, due_date, note, status, completed_at, completed_by)
  on public.follow_ups to authenticated;
grant update (due_date, note, status, completed_at, completed_by) on public.follow_ups to authenticated;

-- stage_history (read-only; written by security definer triggers)
grant select on public.stage_history to authenticated;

-- ai_insights (append-only; created_at not writable → rate limit can't be bypassed)
grant select on public.ai_insights to authenticated;
grant insert (
  id, prospect_id, summary, decision_maker_status, main_objection, recommended_next_step,
  deal_health, model, created_by
) on public.ai_insights to authenticated;

-- flags view (security_invoker → prospects RLS applies)
grant select on public.prospects_with_flags to authenticated;

-- ---------------------------------------------------------------------------
-- Policies (authenticated only; anon has none)
-- ---------------------------------------------------------------------------

-- org_settings
create policy org_settings_select on public.org_settings
  for select to authenticated
  using (true);

create policy org_settings_update_manager on public.org_settings
  for update to authenticated
  using ((select public.is_manager()))
  with check ((select public.is_manager()));

-- users
create policy users_select on public.users
  for select to authenticated
  using (true);

-- Own row (full_name) or managers (role); users_before_update_guard enforces
-- which columns each may change.
create policy users_update on public.users
  for update to authenticated
  using (id = (select auth.uid()) or (select public.is_manager()))
  with check (id = (select auth.uid()) or (select public.is_manager()));

-- prospects
create policy prospects_select on public.prospects
  for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_manager()));

create policy prospects_insert on public.prospects
  for insert to authenticated
  with check (owner_id = (select auth.uid()) or (select public.is_manager()));

create policy prospects_update on public.prospects
  for update to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_manager()))
  with check (owner_id = (select auth.uid()) or (select public.is_manager()));

create policy prospects_delete_manager on public.prospects
  for delete to authenticated
  using ((select public.is_manager()));

-- activities (append-only; stage_change/owner_change come from triggers only)
create policy activities_select on public.activities
  for select to authenticated
  using (public.can_access_prospect(prospect_id));

create policy activities_insert on public.activities
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and type not in ('stage_change', 'owner_change')
    and public.can_access_prospect(prospect_id)
  );

-- follow_ups
create policy follow_ups_select on public.follow_ups
  for select to authenticated
  using (public.can_access_prospect(prospect_id));

create policy follow_ups_insert on public.follow_ups
  for insert to authenticated
  with check (public.can_access_prospect(prospect_id));

create policy follow_ups_update on public.follow_ups
  for update to authenticated
  using (public.can_access_prospect(prospect_id))
  with check (public.can_access_prospect(prospect_id));

create policy follow_ups_delete on public.follow_ups
  for delete to authenticated
  using (public.can_access_prospect(prospect_id));

-- stage_history (read-only)
create policy stage_history_select on public.stage_history
  for select to authenticated
  using (public.can_access_prospect(prospect_id));

-- ai_insights (append-only)
create policy ai_insights_select on public.ai_insights
  for select to authenticated
  using (public.can_access_prospect(prospect_id));

create policy ai_insights_insert on public.ai_insights
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.can_access_prospect(prospect_id)
  );

-- ---------------------------------------------------------------------------
-- Realtime (Prompt 9 Kanban): publish prospects changes; RLS applies per
-- subscriber.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'prospects'
     ) then
    alter publication supabase_realtime add table public.prospects;
  end if;
end;
$$;
