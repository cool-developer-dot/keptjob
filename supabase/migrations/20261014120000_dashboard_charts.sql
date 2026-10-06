-- Dashboard charts: daily activity, weekly new-vs-won flow, team summary.
-- All security invoker (RLS applies: reps only ever count their own rows) and
-- bucketed by org-timezone calendar days ending org_today().

-- ---------------------------------------------------------------------------
-- Human sales activity per org day (SPEC §7 types that move last_activity_at),
-- zero-filled, oldest first. Owner = the prospect's current owner.
-- ---------------------------------------------------------------------------
create function public.dashboard_daily_activity(p_days integer default 14, p_owner_id uuid default null)
returns table (day date, activity_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      public.org_today() as today,
      greatest(least(coalesce(p_days, 14), 90), 1) as n,
      coalesce((select s.timezone from public.org_settings s where s.id), 'America/New_York') as tz
  ),
  days as (
    select (b.today - g)::date as day
    from bounds b, generate_series(0, b.n - 1) as g
  ),
  acts as (
    select (a.occurred_at at time zone b.tz)::date as day
    from public.activities a
    join public.prospects p on p.id = a.prospect_id
    cross join bounds b
    where a.type in ('call', 'conversation', 'note', 'demo', 'follow_up', 'stage_change')
      and a.occurred_at >= ((b.today - (b.n - 1))::timestamp at time zone b.tz)
      and a.occurred_at < ((b.today + 1)::timestamp at time zone b.tz)
      and (p_owner_id is null or p.owner_id = p_owner_id)
  )
  select d.day, count(a.day)::integer as activity_count
  from days d
  left join acts a on a.day = d.day
  group by d.day
  order by d.day;
$$;

comment on function public.dashboard_daily_activity(integer, uuid) is
  'Human activities (call, conversation, note, demo, follow_up, stage_change) per org day for the last p_days days ending org_today(), zero-filled. RLS applies.';

revoke execute on function public.dashboard_daily_activity(integer, uuid) from public, anon;
grant execute on function public.dashboard_daily_activity(integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Rolling 7-day windows ending org_today(): prospects created vs deals won
-- (currently closed_won, closed_at in the window). Oldest window first.
-- ---------------------------------------------------------------------------
create function public.dashboard_weekly_flow(p_weeks integer default 8, p_owner_id uuid default null)
returns table (week_start date, week_end date, created_count integer, won_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      public.org_today() as today,
      greatest(least(coalesce(p_weeks, 8), 26), 1) as n,
      coalesce((select s.timezone from public.org_settings s where s.id), 'America/New_York') as tz
  ),
  weeks as (
    select (b.today - 7 * g - 6)::date as week_start, (b.today - 7 * g)::date as week_end
    from bounds b, generate_series(0, b.n - 1) as g
  ),
  scoped as (
    select p.created_at, p.closed_at, p.stage
    from public.prospects p
    where p_owner_id is null or p.owner_id = p_owner_id
  )
  select
    w.week_start,
    w.week_end,
    (select count(*) from scoped s, bounds b
      where (s.created_at at time zone b.tz)::date between w.week_start and w.week_end)::integer as created_count,
    (select count(*) from scoped s, bounds b
      where s.stage = 'closed_won'
        and (s.closed_at at time zone b.tz)::date between w.week_start and w.week_end)::integer as won_count
  from weeks w
  order by w.week_start;
$$;

comment on function public.dashboard_weekly_flow(integer, uuid) is
  'Rolling 7-day windows ending org_today(): prospects created and deals won per window, oldest first. RLS applies.';

revoke execute on function public.dashboard_weekly_flow(integer, uuid) from public, anon;
grant execute on function public.dashboard_weekly_flow(integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- One row per sales rep: open deals, stale deals, overdue follow-ups and
-- won / lost in the last 90 org days. RLS applies (a rep sees only their own
-- numbers; the other reps' rows come back as zeros).
-- ---------------------------------------------------------------------------
create function public.dashboard_team_summary()
returns table (
  user_id uuid,
  open_count integer,
  stale_count integer,
  overdue_count integer,
  won_count integer,
  lost_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    u.id as user_id,
    (select count(*) from public.prospects_with_flags p
      where p.owner_id = u.id and p.stage not in ('closed_won', 'closed_lost'))::integer as open_count,
    (select count(*) from public.prospects_with_flags p
      where p.owner_id = u.id and p.is_stale)::integer as stale_count,
    (select count(*) from public.follow_ups f
      where f.owner_id = u.id and f.status = 'pending' and f.due_date < public.org_today())::integer as overdue_count,
    o.won as won_count,
    o.lost as lost_count
  from public.users u
  cross join lateral public.closed_outcome_counts(public.org_today() - 89, public.org_today(), u.id) o
  where u.role = 'sales_rep'
  order by u.full_name, u.id;
$$;

comment on function public.dashboard_team_summary() is
  'Per sales rep: open, stale, overdue follow-ups, won/lost in the last 90 org days. RLS applies.';

revoke execute on function public.dashboard_team_summary() from public, anon;
grant execute on function public.dashboard_team_summary() to authenticated;
