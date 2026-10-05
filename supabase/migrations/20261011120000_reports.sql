-- Prompt 13 (Reports): SPEC §12 report metrics. Everything is security
-- invoker → the caller's RLS applies (reps: own prospects; managers:
-- everything). A rep passing another owner's id simply gets zeros / no rows.
--
-- Period convention: p_from … p_to are org calendar dates (inclusive) =
-- instants [p_from 00:00 org tz, (p_to + 1) 00:00 org tz). p_from > p_to →
-- error 22023. "Now" metrics (stage counts, pipeline value, overdue / due
-- today) take no dates.
--
-- Reused definitions (never re-implemented here):
--   open_pipeline_value()      (Prompt 12) → report_pipeline_value()
--   closed_outcome_counts()    (Prompt 12) → report_outcomes() won / lost
--   follow_up_bucket_counts()  (Prompt 10) → report_follow_ups() overdue / today

-- ---------------------------------------------------------------------------
-- Indexes for the period filters.
-- ---------------------------------------------------------------------------
create index prospects_created_at_idx on public.prospects (created_at);
create index prospects_closed_at_idx on public.prospects (closed_at) where closed_at is not null;
create index follow_ups_completed_at_idx on public.follow_ups (completed_at) where status = 'completed';

-- ---------------------------------------------------------------------------
-- org_period_bounds(): org calendar days [p_from, p_to] → half-open instants.
-- DST-correct (local midnight of each date in the org timezone).
-- ---------------------------------------------------------------------------
create function public.org_period_bounds(p_from date, p_to date)
returns table (start_at timestamptz, end_at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text;
begin
  if p_from is null or p_to is null then
    raise exception 'The period needs a start and an end date' using errcode = '22023';
  end if;
  if p_from > p_to then
    raise exception 'The start date must be on or before the end date' using errcode = '22023';
  end if;

  select s.timezone into v_tz from public.org_settings s where s.id;
  v_tz := coalesce(v_tz, 'America/New_York');

  start_at := p_from::timestamp at time zone v_tz;
  end_at := (p_to + 1)::timestamp at time zone v_tz;
  return next;
end;
$$;

comment on function public.org_period_bounds(date, date) is
  'Org calendar days p_from..p_to (inclusive) as half-open instants [start_at, end_at) in the org timezone. Raises 22023 when p_from > p_to.';

revoke execute on function public.org_period_bounds(date, date) from public, anon;
grant execute on function public.org_period_bounds(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Period cohorts (RLS applies). Owner = the prospect's current owner.
-- ---------------------------------------------------------------------------
create function public.prospects_created_in_period(p_from date, p_to date, p_owner_id uuid default null)
returns setof public.prospects
language sql
stable
security invoker
set search_path = ''
as $$
  select p.*
  from public.prospects p
  cross join public.org_period_bounds(p_from, p_to) b
  where p.created_at >= b.start_at
    and p.created_at < b.end_at
    and (p_owner_id is null or p.owner_id = p_owner_id);
$$;

comment on function public.prospects_created_in_period(date, date, uuid) is
  'Prospects created in the org-tz period (funnel cohort, SPEC §12); optional current owner. RLS applies.';

revoke execute on function public.prospects_created_in_period(date, date, uuid) from public, anon;
grant execute on function public.prospects_created_in_period(date, date, uuid) to authenticated;

create function public.prospects_closed_in_period(p_from date, p_to date, p_owner_id uuid default null)
returns setof public.prospects
language sql
stable
security invoker
set search_path = ''
as $$
  select p.*
  from public.prospects p
  cross join public.org_period_bounds(p_from, p_to) b
  where p.stage in ('closed_won', 'closed_lost')
    and p.closed_at >= b.start_at
    and p.closed_at < b.end_at
    and (p_owner_id is null or p.owner_id = p_owner_id);
$$;

comment on function public.prospects_closed_in_period(date, date, uuid) is
  'Prospects currently closed won/lost whose closed_at falls in the org-tz period (win rate / won value basis, SPEC §12); optional owner. RLS applies.';

revoke execute on function public.prospects_closed_in_period(date, date, uuid) from public, anon;
grant execute on function public.prospects_closed_in_period(date, date, uuid) to authenticated;

-- Prompt 12's closed_outcome_counts(), now on top of the shared period helper
-- (same signature and results: org-tz date of closed_at in [p_from, p_to]).
create or replace function public.closed_outcome_counts(p_from date, p_to date, p_owner_id uuid default null)
returns table (won integer, lost integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (count(*) filter (where c.stage = 'closed_won'))::integer as won,
    (count(*) filter (where c.stage = 'closed_lost'))::integer as lost
  from public.prospects_closed_in_period(p_from, p_to, p_owner_id) c;
$$;

-- ---------------------------------------------------------------------------
-- stage_funnel_rank(): SPEC §2 order for the funnel; closed_lost unranked.
-- prospect 1 · contacted 2 · conversation 3 · qualified 4 · demo_booked 5 ·
-- demo_attended 6 · follow_up 7 · closed_won 8 · closed_lost null
-- ---------------------------------------------------------------------------
create function public.stage_funnel_rank(p_stage public.pipeline_stage)
returns integer
language sql
immutable
set search_path = ''
as $$
  select array_position(
    array['prospect', 'contacted', 'conversation', 'qualified', 'demo_booked',
          'demo_attended', 'follow_up', 'closed_won']::public.pipeline_stage[],
    p_stage
  );
$$;

comment on function public.stage_funnel_rank(public.pipeline_stage) is
  'Funnel rank of a stage (SPEC §2 order, 1..8); closed_lost is unranked (null).';

revoke execute on function public.stage_funnel_rank(public.pipeline_stage) from public, anon;
grant execute on function public.stage_funnel_rank(public.pipeline_stage) to authenticated;

-- ---------------------------------------------------------------------------
-- report_stage_counts(): prospects by CURRENT stage ("now", not period
-- filtered), all 9 stages in SPEC order, zero-filled. Total = sum.
-- ---------------------------------------------------------------------------
create function public.report_stage_counts(p_owner_id uuid default null)
returns table (stage public.pipeline_stage, prospect_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.stage, count(p.id)::integer as prospect_count
  from unnest(enum_range(null::public.pipeline_stage)) with ordinality as s(stage, ord)
  left join public.prospects p
    on p.stage = s.stage
   and (p_owner_id is null or p.owner_id = p_owner_id)
  group by s.stage, s.ord
  order by s.ord;
$$;

comment on function public.report_stage_counts(uuid) is
  'Prospects by current stage (now), 9 rows in SPEC order, zero-filled; optional owner. RLS applies.';

revoke execute on function public.report_stage_counts(uuid) from public, anon;
grant execute on function public.report_stage_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- report_stage_reached(): for prospects CREATED in the period, how many
-- reached at least each ranked stage. Highest stage ever reached = max
-- stage_funnel_rank over every stage_history row (from + to) and the current
-- stage; a prospect with no ranked stage at all (e.g. created as closed_lost)
-- counts as "prospect". Skips count the skipped stages, backward moves never
-- lower the reach, a reopened deal that ends won reaches closed_won.
-- One definition for the funnel AND the SPEC §12 stage counts.
-- ---------------------------------------------------------------------------
create function public.report_stage_reached(p_from date, p_to date, p_owner_id uuid default null)
returns table (stage public.pipeline_stage, stage_rank integer, prospect_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with reached as (
    select coalesce(
      greatest(
        public.stage_funnel_rank(c.stage),
        (
          select max(greatest(public.stage_funnel_rank(h.from_stage), public.stage_funnel_rank(h.to_stage)))
          from public.stage_history h
          where h.prospect_id = c.id
        )
      ),
      1
    ) as max_rank
    from public.prospects_created_in_period(p_from, p_to, p_owner_id) c
  ),
  ranked as (
    select s.stage, public.stage_funnel_rank(s.stage) as stage_rank
    from unnest(enum_range(null::public.pipeline_stage)) as s(stage)
    where public.stage_funnel_rank(s.stage) is not null
  )
  select
    r.stage,
    r.stage_rank,
    (select count(*) from reached x where x.max_rank >= r.stage_rank)::integer as prospect_count
  from ranked r
  order by r.stage_rank;
$$;

comment on function public.report_stage_reached(date, date, uuid) is
  'Prospects created in the period whose highest stage ever reached (stage_history + current, SPEC §2 order, closed_lost unranked) is >= each ranked stage. 8 rows. RLS applies.';

revoke execute on function public.report_stage_reached(date, date, uuid) from public, anon;
grant execute on function public.report_stage_reached(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- report_funnel(): SPEC §12 funnel Prospects → Contacted → Conversation →
-- Qualified → Demo Booked → Demo Attended → Closed Won (follow_up is not a
-- step, but reaching it implies ≥ Demo Attended). Percentages rounded to 1
-- decimal: step = 100 × count ÷ previous step (null for step 1 / previous 0),
-- overall = 100 × count ÷ Prospects (null when 0; Closed Won row = SPEC
-- "overall conversion").
-- ---------------------------------------------------------------------------
create function public.report_funnel(p_from date, p_to date, p_owner_id uuid default null)
returns table (
  step integer,
  stage public.pipeline_stage,
  prospect_count integer,
  step_conversion_pct numeric,
  overall_conversion_pct numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    f.step,
    f.stage,
    f.prospect_count,
    case when f.previous_count is null or f.previous_count = 0 then null
         else round(100.0 * f.prospect_count / f.previous_count, 1) end,
    case when f.first_count = 0 then null
         else round(100.0 * f.prospect_count / f.first_count, 1) end
  from (
    select
      (row_number() over w)::integer as step,
      r.stage,
      r.prospect_count,
      lag(r.prospect_count) over w as previous_count,
      first_value(r.prospect_count) over w as first_count
    from public.report_stage_reached(p_from, p_to, p_owner_id) r
    where r.stage <> 'follow_up'
    window w as (order by r.stage_rank)
  ) f
  order by f.step;
$$;

comment on function public.report_funnel(date, date, uuid) is
  'SPEC §12 funnel for prospects created in the period: 7 steps with counts, step conversion % (vs previous step) and overall % (vs Prospects). RLS applies.';

revoke execute on function public.report_funnel(date, date, uuid) from public, anon;
grant execute on function public.report_funnel(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- report_outcomes(): prospects closed in the period (current state). won /
-- lost via closed_outcome_counts(); win rate % (1 decimal, null when none
-- closed); won value per currency (nulls ignored, never summed across
-- currencies) + won deals without a value; lost-reason breakdown.
-- ---------------------------------------------------------------------------
create function public.report_outcomes(p_from date, p_to date, p_owner_id uuid default null)
returns table (
  won integer,
  lost integer,
  win_rate_pct numeric,
  won_value jsonb,
  won_without_value integer,
  lost_reasons jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with closed as (
    select c.stage, c.deal_value, c.currency, c.close_reason
    from public.prospects_closed_in_period(p_from, p_to, p_owner_id) c
  )
  select
    o.won,
    o.lost,
    case when o.won + o.lost = 0 then null
         else round(100.0 * o.won / (o.won + o.lost), 1) end as win_rate_pct,
    coalesce((
      select jsonb_agg(jsonb_build_object('currency', v.currency, 'total', v.total, 'count', v.n) order by v.currency)
      from (
        select x.currency::text as currency, sum(x.deal_value) as total, count(*)::integer as n
        from closed x
        where x.stage = 'closed_won' and x.deal_value is not null
        group by 1
      ) v
    ), '[]'::jsonb) as won_value,
    (select count(*) from closed x where x.stage = 'closed_won' and x.deal_value is null)::integer as won_without_value,
    coalesce((
      select jsonb_agg(jsonb_build_object('reason', l.reason, 'count', l.n) order by l.n desc, l.reason)
      from (
        select x.close_reason as reason, count(*)::integer as n
        from closed x
        where x.stage = 'closed_lost'
        group by 1
      ) l
    ), '[]'::jsonb) as lost_reasons
  from public.closed_outcome_counts(p_from, p_to, p_owner_id) o;
$$;

comment on function public.report_outcomes(date, date, uuid) is
  'Prospects closed in the period: won, lost, win rate % (null when none), won value per currency [{currency,total,count}], won deals without value, lost reasons [{reason,count}]. RLS applies.';

revoke execute on function public.report_outcomes(date, date, uuid) from public, anon;
grant execute on function public.report_outcomes(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- report_pipeline_value(): always "now" — exactly open_pipeline_value().
-- ---------------------------------------------------------------------------
create function public.report_pipeline_value(p_owner_id uuid default null)
returns table (currency text, total_value numeric, prospect_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select v.currency, v.total_value, v.prospect_count
  from public.open_pipeline_value(p_owner_id) v;
$$;

comment on function public.report_pipeline_value(uuid) is
  'SPEC §12 pipeline value (now) = open_pipeline_value(): per currency + a currency-null row counting open prospects without a value. RLS applies.';

revoke execute on function public.report_pipeline_value(uuid) from public, anon;
grant execute on function public.report_pipeline_value(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- report_follow_ups(): overdue + due today NOW (follow_up_bucket_counts, the
-- Follow-ups page definition) and follow-ups completed in the period.
-- Owner = follow_ups.owner_id (as on the Follow-ups page).
-- ---------------------------------------------------------------------------
create function public.report_follow_ups(p_from date, p_to date, p_owner_id uuid default null)
returns table (overdue integer, due_today integer, completed integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.overdue,
    c.today as due_today,
    (
      select count(*)
      from public.follow_ups f
      cross join public.org_period_bounds(p_from, p_to) b
      where f.status = 'completed'
        and f.completed_at >= b.start_at
        and f.completed_at < b.end_at
        and (p_owner_id is null or f.owner_id = p_owner_id)
    )::integer as completed
  from public.follow_up_bucket_counts(p_owner_id) c;
$$;

comment on function public.report_follow_ups(date, date, uuid) is
  'Follow-up counts: overdue and due today now (follow_up_bucket_counts) + completed in the org-tz period; optional owner. RLS applies.';

revoke execute on function public.report_follow_ups(date, date, uuid) from public, anon;
grant execute on function public.report_follow_ups(date, date, uuid) to authenticated;
