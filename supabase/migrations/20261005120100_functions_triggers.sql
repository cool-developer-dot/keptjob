-- AI Sales CRM V1: helper functions, triggers, flags view and stage-change RPC.
-- Conventions: every function sets search_path = '' and schema-qualifies all
-- objects. Trigger functions that write to other tables are SECURITY DEFINER
-- so they keep working once RLS (Prompt 2) blocks direct writes.
-- auth.uid() is null for seed/system/service-role writes; that is handled
-- explicitly below.

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- True when the current user is a manager (false when auth.uid() is null).
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'manager'
  );
$$;

-- "Today" in the org timezone (SPEC §6).
create or replace function public.org_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone s.timezone)::date
  from public.org_settings s
  where s.id;
$$;

-- ---------------------------------------------------------------------------
-- org_settings
-- ---------------------------------------------------------------------------
create or replace function public.org_settings_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

create trigger org_settings_set_updated_at
  before update on public.org_settings
  for each row execute function public.set_updated_at();

create trigger org_settings_before_update
  before update on public.org_settings
  for each row execute function public.org_settings_before_update();

-- ---------------------------------------------------------------------------
-- users: creation from auth.users, role/email sync, last-manager guard
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    -- The role is only ever read from raw_app_meta_data (not user-editable).
    case
      when new.raw_app_meta_data ->> 'role' in ('manager', 'sales_rep')
        then (new.raw_app_meta_data ->> 'role')::public.user_role
      else 'sales_rep'::public.user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keeps public.users in sync when auth email or app_metadata.role changes
-- (e.g. invite → auth.admin.updateUserById({ app_metadata: { role } })).
create or replace function public.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null then
    update public.users u
       set email = new.email
     where u.id = new.id
       and u.email is distinct from new.email;
  end if;

  if new.raw_app_meta_data ->> 'role' in ('manager', 'sales_rep') then
    update public.users u
       set role = (new.raw_app_meta_data ->> 'role')::public.user_role
     where u.id = new.id
       and u.role is distinct from (new.raw_app_meta_data ->> 'role')::public.user_role;
  end if;

  return null;
end;
$$;

create trigger on_auth_user_updated
  after update of email, raw_app_meta_data on auth.users
  for each row execute function public.handle_auth_user_updated();

-- Mirrors public.users.role into auth.users.raw_app_meta_data.role.
create or replace function public.sync_user_role_to_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users a
     set raw_app_meta_data = coalesce(a.raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('role', new.role::text)
   where a.id = new.id
     and (a.raw_app_meta_data ->> 'role') is distinct from new.role::text;
  return null;
end;
$$;

create trigger users_sync_role_to_auth
  after update of role on public.users
  for each row
  when (old.role is distinct from new.role)
  execute function public.sync_user_role_to_auth();

-- At least one manager must always exist (SPEC §4).
create or replace function public.protect_last_manager()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'manager'
     and (tg_op = 'DELETE' or new.role is distinct from 'manager'::public.user_role) then
    -- Serialise concurrent demotions/deletions of managers.
    perform pg_advisory_xact_lock(hashtext('public.users.last_manager'));
    if not exists (
      select 1 from public.users u
      where u.role = 'manager' and u.id <> old.id
    ) then
      raise exception 'At least one manager must remain'
        using errcode = 'P0001',
              hint = 'Promote another user to manager first.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger users_protect_last_manager_update
  before update of role on public.users
  for each row execute function public.protect_last_manager();

create trigger users_protect_last_manager_delete
  before delete on public.users
  for each row execute function public.protect_last_manager();

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- prospects
-- ---------------------------------------------------------------------------
create or replace function public.prospects_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency is null then
    select s.default_currency into new.currency
    from public.org_settings s
    where s.id;
  end if;

  new.owner_id := coalesce(new.owner_id, auth.uid());
  new.created_by := coalesce(auth.uid(), new.created_by);

  -- follow_up_date is derived from follow_ups; a new prospect has none.
  if pg_trigger_depth() = 1 then
    new.follow_up_date := null;
  end if;

  if new.stage in ('closed_won', 'closed_lost') then
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  return new;
end;
$$;

create or replace function public.prospects_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Reassignment: managers only (auth.uid() is null for system/service writes).
  if new.owner_id is distinct from old.owner_id
     and auth.uid() is not null
     and not public.is_manager() then
    raise exception 'Only managers can reassign prospects'
      using errcode = '42501';
  end if;

  -- created_at is immutable. (created_by is not forced: the FK's
  -- "on delete set null" must still be able to clear it.)
  new.created_at := old.created_at;

  -- follow_up_date is only written by the follow_ups trigger (depth > 1).
  if pg_trigger_depth() = 1 then
    new.follow_up_date := old.follow_up_date;
  end if;

  if new.stage is distinct from old.stage then
    if new.stage in ('closed_won', 'closed_lost') then
      new.closed_at := now();
    elsif old.stage in ('closed_won', 'closed_lost') then
      -- Reopen: clear the outcome before the CHECK constraints run.
      -- stage_history keeps the old close_reason.
      new.close_reason := null;
      new.close_notes := null;
      new.closed_at := null;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prospects_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stage_history (prospect_id, from_stage, to_stage, changed_by, close_reason)
  values (new.id, null, new.stage, coalesce(auth.uid(), new.created_by), new.close_reason);
  return null;
end;
$$;

create or replace function public.prospects_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(current_setting('app.stage_change_note', true)), '');
begin
  if new.stage is distinct from old.stage then
    insert into public.stage_history (prospect_id, from_stage, to_stage, changed_by, close_reason, note)
    values (new.id, old.stage, new.stage, auth.uid(), new.close_reason, v_note);

    insert into public.activities (prospect_id, user_id, type, content, metadata)
    values (
      new.id,
      auth.uid(),
      'stage_change',
      v_note,
      jsonb_build_object('from', old.stage, 'to', new.stage, 'close_reason', new.close_reason)
    );
  end if;

  if new.owner_id is distinct from old.owner_id then
    insert into public.activities (prospect_id, user_id, type, metadata)
    values (
      new.id,
      auth.uid(),
      'owner_change',
      jsonb_build_object('from_owner', old.owner_id, 'to_owner', new.owner_id)
    );

    update public.follow_ups f
       set owner_id = new.owner_id
     where f.prospect_id = new.id
       and f.status = 'pending'
       and f.owner_id is distinct from new.owner_id;
  end if;

  return null;
end;
$$;

create trigger prospects_before_insert
  before insert on public.prospects
  for each row execute function public.prospects_before_insert();

create trigger prospects_before_update
  before update on public.prospects
  for each row execute function public.prospects_before_update();

create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();

create trigger prospects_after_insert
  after insert on public.prospects
  for each row execute function public.prospects_after_insert();

create trigger prospects_after_update
  after update on public.prospects
  for each row
  when (old.stage is distinct from new.stage or old.owner_id is distinct from new.owner_id)
  execute function public.prospects_after_update();

-- ---------------------------------------------------------------------------
-- activities → prospects.last_activity_at (human sales activity only, SPEC §7)
-- ---------------------------------------------------------------------------
create or replace function public.activities_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := least(new.occurred_at, now());
begin
  if new.type in ('call', 'conversation', 'note', 'demo', 'follow_up', 'stage_change') then
    update public.prospects p
       set last_activity_at = v_at
     where p.id = new.prospect_id
       and p.last_activity_at < v_at;
  end if;
  return null;
end;
$$;

create trigger activities_after_insert
  after insert on public.activities
  for each row execute function public.activities_after_insert();

-- ---------------------------------------------------------------------------
-- follow_ups → prospects.follow_up_date (earliest pending due date, SPEC §3)
-- ---------------------------------------------------------------------------
create or replace function public.refresh_prospect_follow_up_date(p_prospect_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.prospects p
     set follow_up_date = s.next_due
    from (
      select min(f.due_date) as next_due
      from public.follow_ups f
      where f.prospect_id = p_prospect_id
        and f.status = 'pending'
    ) s
   where p.id = p_prospect_id
     and p.follow_up_date is distinct from s.next_due;
$$;

revoke execute on function public.refresh_prospect_follow_up_date(uuid) from public, anon, authenticated;

create or replace function public.follow_ups_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is null then
    select p.owner_id into new.owner_id
    from public.prospects p
    where p.id = new.prospect_id;
  end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end;
$$;

create or replace function public.follow_ups_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.prospect_id = old.prospect_id
     and new.status = old.status
     and new.due_date = old.due_date then
    return null; -- nothing that affects follow_up_date changed
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    perform public.refresh_prospect_follow_up_date(new.prospect_id);
  end if;

  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.prospect_id <> old.prospect_id) then
    perform public.refresh_prospect_follow_up_date(old.prospect_id);
  end if;

  return null;
end;
$$;

create trigger follow_ups_before_insert
  before insert on public.follow_ups
  for each row execute function public.follow_ups_before_insert();

create trigger follow_ups_set_updated_at
  before update on public.follow_ups
  for each row execute function public.set_updated_at();

create trigger follow_ups_after_change
  after insert or update or delete on public.follow_ups
  for each row execute function public.follow_ups_after_change();

-- ---------------------------------------------------------------------------
-- Stage change RPC (used by the moveProspectStage server action).
-- SECURITY INVOKER: RLS applies. Passes the optional note to the AFTER UPDATE
-- trigger via the transaction-local setting app.stage_change_note.
-- ---------------------------------------------------------------------------
create or replace function public.move_prospect_stage(
  p_prospect_id uuid,
  p_to_stage public.pipeline_stage,
  p_close_reason text default null,
  p_close_notes text default null,
  p_note text default null
)
returns public.prospects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.prospects;
  v_closed boolean := p_to_stage in ('closed_won', 'closed_lost');
begin
  select * into v_row
  from public.prospects p
  where p.id = p_prospect_id
  for update;

  if not found then
    raise exception 'Prospect not found' using errcode = 'P0002';
  end if;

  if v_row.stage = p_to_stage then
    return v_row; -- same stage: no-op, no history
  end if;

  perform set_config('app.stage_change_note', coalesce(btrim(p_note), ''), true);

  update public.prospects p
     set stage = p_to_stage,
         close_reason = case when v_closed then nullif(btrim(p_close_reason), '') end,
         close_notes = case when v_closed then nullif(btrim(p_close_notes), '') end
   where p.id = p_prospect_id
  returning * into v_row;

  perform set_config('app.stage_change_note', '', true);

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Flags view (SECURITY INVOKER so RLS on prospects applies)
-- ---------------------------------------------------------------------------
create view public.prospects_with_flags
with (security_invoker = true)
as
select
  p.*,
  coalesce(
    p.stage not in ('closed_won', 'closed_lost')
      and p.last_activity_at < now() - make_interval(days => s.stale_days),
    false
  ) as is_stale,
  coalesce(p.follow_up_date < public.org_today(), false) as has_overdue_follow_up
from public.prospects p
left join public.org_settings s on s.id;

comment on view public.prospects_with_flags is
  'prospects + is_stale (open, no human activity for org stale_days) + has_overdue_follow_up (earliest pending follow-up before org_today()).';
