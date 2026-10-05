-- Prompt 12 (Dashboard): shared metric definitions (reused by Prompt 13
-- Reports), the latest AI next step per prospect, and the ranked
-- "deals needing attention" list. Everything is security invoker → the
-- caller's RLS applies (reps: own prospects; managers: everything).

-- ---------------------------------------------------------------------------
-- open_pipeline_value(): SPEC §12 pipeline value = sum of deal_value of open
-- (non-closed) prospects, grouped by currency (never summed across
-- currencies). Prospects without a deal value are ignored in the totals and
-- returned as ONE row with currency = null / total_value = null whose
-- prospect_count is the "N without value" count. Sum of prospect_count over
-- all rows = number of open prospects. Always "now" (no date filter).
-- Prompt 13: report_pipeline_value() wraps this function.
-- ---------------------------------------------------------------------------
create function public.open_pipeline_value(p_owner_id uuid default null)
returns table (currency text, total_value numeric, prospect_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    case when p.deal_value is null then null else p.currency::text end as currency,
    sum(p.deal_value) as total_value,
    count(*)::integer as prospect_count
  from public.prospects p
  where p.stage not in ('closed_won', 'closed_lost')
    and (p_owner_id is null or p.owner_id = p_owner_id)
  group by 1
  order by 1 nulls last;
$$;

comment on function public.open_pipeline_value(uuid) is
  'SPEC §12 pipeline value: open prospects by currency (currency null row = open prospects without a deal value; total_value null). Optional owner filter. RLS applies. Reused by report_pipeline_value().';

revoke execute on function public.open_pipeline_value(uuid) from public, anon;
grant execute on function public.open_pipeline_value(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- closed_outcome_counts(): prospects currently closed won / lost whose
-- closed_at falls on an org-tz calendar date in [p_from, p_to] (SPEC §12:
-- "win rate … for prospects closed in the selected period"). Win rate =
-- won / (won + lost), shown as "—" when both are 0. Dashboard: the 90 org days
-- ending today (p_from = today - 89). Prompt 13: report_outcomes() reuses it.
-- ---------------------------------------------------------------------------
create function public.closed_outcome_counts(p_from date, p_to date, p_owner_id uuid default null)
returns table (won integer, lost integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (count(*) filter (where p.stage = 'closed_won'))::integer as won,
    (count(*) filter (where p.stage = 'closed_lost'))::integer as lost
  from public.prospects p
  cross join (select s.timezone from public.org_settings s where s.id) tz
  where p.stage in ('closed_won', 'closed_lost')
    and p.closed_at is not null
    and (p.closed_at at time zone tz.timezone)::date between p_from and p_to
    and (p_owner_id is null or p.owner_id = p_owner_id);
$$;

comment on function public.closed_outcome_counts(date, date, uuid) is
  'Won / lost counts of prospects closed (org-tz date of closed_at) between p_from and p_to inclusive; optional owner filter. RLS applies. Win rate = won / (won + lost).';

revoke execute on function public.closed_outcome_counts(date, date, uuid) from public, anon;
grant execute on function public.closed_outcome_counts(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- latest_ai_insights: + recommended_next_step / main_objection (appended
-- columns; the Kanban embed of deal_health is unchanged).
-- ---------------------------------------------------------------------------
create or replace view public.latest_ai_insights
with (security_invoker = true)
as
select distinct on (i.prospect_id)
  i.prospect_id,
  i.id,
  i.deal_health,
  i.created_at,
  i.recommended_next_step,
  i.main_objection
from public.ai_insights i
order by i.prospect_id, i.created_at desc, i.id desc;

comment on view public.latest_ai_insights is
  'Newest AI insight per prospect (deal_health for Kanban cards; next step / main objection for the dashboard). security_invoker: RLS of ai_insights applies.';

-- ---------------------------------------------------------------------------
-- deals_needing_attention: open prospects with at least one reason, ranked
-- (SPEC §1.6). attention_rank = the highest-priority reason:
--   1 overdue follow-up > 2 stale (no human activity for stale_days)
--   > 3 latest AI deal health low > 4 no pending follow-up.
-- Order: attention_rank, follow_up_date asc nulls last (most overdue first),
-- last_activity_at asc, id. TS mirror: rankDealsNeedingAttention() in
-- src/lib/dashboard.ts (parity-checked by the integration test).
-- id = prospects.id, so latest_conversation_activities / latest_ai_insights embed.
-- ---------------------------------------------------------------------------
create view public.deals_needing_attention
with (security_invoker = true)
as
select
  f.id,
  f.name,
  f.company,
  f.stage,
  f.owner_id,
  f.follow_up_date,
  f.last_activity_at,
  f.deal_value,
  f.currency,
  f.has_overdue_follow_up,
  f.is_stale,
  coalesce(li.deal_health = 'low', false) as low_health,
  f.follow_up_date is null as no_follow_up,
  case
    when f.has_overdue_follow_up then 1
    when f.is_stale then 2
    when li.deal_health = 'low' then 3
    when f.follow_up_date is null then 4
  end as attention_rank
from public.prospects_with_flags f
left join public.latest_ai_insights li on li.prospect_id = f.id
where f.stage not in ('closed_won', 'closed_lost')
  and (
    f.has_overdue_follow_up
    or f.is_stale
    or li.deal_health = 'low'
    or f.follow_up_date is null
  );

comment on view public.deals_needing_attention is
  'Open prospects needing attention with flags + attention_rank (1 overdue follow-up, 2 stale, 3 AI health low, 4 no pending follow-up). Order by attention_rank, follow_up_date nulls last, last_activity_at, id. security_invoker.';

revoke all on public.deals_needing_attention from public, anon, authenticated;
grant select on public.deals_needing_attention to authenticated;
