-- pgTAP tests for Prompt 13 (Reports): report_stage_counts, report_stage_reached,
-- report_funnel, report_outcomes, report_pipeline_value, report_follow_ups on a
-- deterministic fixture, with owner filtering and RLS (reps A / B, manager M).
-- Stage history is produced by REAL stage moves (move_prospect_stage →
-- triggers); only created_at / closed_at / completed_at are pinned afterwards.
-- Period: 2025-09-01 … 2025-09-30 in America/New_York (EDT, UTC−4).
-- Run with: npm run test:db. Everything is rolled back.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(53);

create function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Setup (as postgres): clean slate (rolled back), org tz New York.
-- M manager, A / B reps.
-- ---------------------------------------------------------------------------
delete from public.prospects;
update public.org_settings set timezone = 'America/New_York', stale_days = 14 where id;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000013a1', 'm@reports.test', '{"role":"manager"}',   '{"full_name":"M"}'),
  ('00000000-0000-0000-0000-0000000013a2', 'a@reports.test', '{"role":"sales_rep"}', '{"full_name":"A"}'),
  ('00000000-0000-0000-0000-0000000013a3', 'b@reports.test', '{"role":"sales_rep"}', '{"full_name":"B"}');

-- Every prospect starts at 'prospect' (the insert trigger writes the first
-- stage_history row); created_at is pinned on insert.
insert into public.prospects (id, name, owner_id, deal_value, currency, created_at) values
  -- A
  ('00000000-0000-0000-0000-0000013a00a1', 'a1 full path won',          '00000000-0000-0000-0000-0000000013a2', 1000, 'USD', '2025-09-05 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00a2', 'a2 skip, back, lost',       '00000000-0000-0000-0000-0000000013a2', 500,  'USD', '2025-09-06 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00a3', 'a3 lost, reopened, won',    '00000000-0000-0000-0000-0000000013a2', null, 'USD', '2025-09-07 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00a4', 'a4 contacted then lost',    '00000000-0000-0000-0000-0000000013a2', 2000, 'EUR', '2025-09-08 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00a5', 'a5 open demo booked',       '00000000-0000-0000-0000-0000000013a2', 300,  'EUR', '2025-09-09 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00a6', 'a6 open untouched',         '00000000-0000-0000-0000-0000000013a2', null, 'USD', '2025-09-10 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00a7', 'a7 created before period',  '00000000-0000-0000-0000-0000000013a2', 700,  'USD', '2025-08-31 23:59-04'),
  ('00000000-0000-0000-0000-0000013a00a8', 'a8 created at period start','00000000-0000-0000-0000-0000000013a2', 100,  'USD', '2025-09-01 00:00-04'),
  ('00000000-0000-0000-0000-0000013a00a9', 'a9 won after period',       '00000000-0000-0000-0000-0000000013a2', 50,   'USD', '2025-09-12 12:00-04'),
  -- B
  ('00000000-0000-0000-0000-0000013a00b1', 'b1 lost at conversation',   '00000000-0000-0000-0000-0000000013a3', 900,  'USD', '2025-09-05 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00b2', 'b2 won in GBP',             '00000000-0000-0000-0000-0000000013a3', 400,  'GBP', '2025-09-06 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00b3', 'b3 open contacted',         '00000000-0000-0000-0000-0000000013a3', null, 'USD', '2025-09-07 12:00-04');

do $$
declare
  a1 constant uuid := '00000000-0000-0000-0000-0000013a00a1';
  a2 constant uuid := '00000000-0000-0000-0000-0000013a00a2';
  a3 constant uuid := '00000000-0000-0000-0000-0000013a00a3';
  a4 constant uuid := '00000000-0000-0000-0000-0000013a00a4';
  a5 constant uuid := '00000000-0000-0000-0000-0000013a00a5';
  a7 constant uuid := '00000000-0000-0000-0000-0000013a00a7';
  a8 constant uuid := '00000000-0000-0000-0000-0000013a00a8';
  a9 constant uuid := '00000000-0000-0000-0000-0000013a00a9';
  b1 constant uuid := '00000000-0000-0000-0000-0000013a00b1';
  b2 constant uuid := '00000000-0000-0000-0000-0000013a00b2';
  b3 constant uuid := '00000000-0000-0000-0000-0000013a00b3';
begin
  -- a1: every stage in order → won
  perform public.move_prospect_stage(a1, 'contacted');
  perform public.move_prospect_stage(a1, 'conversation');
  perform public.move_prospect_stage(a1, 'qualified');
  perform public.move_prospect_stage(a1, 'demo_booked');
  perform public.move_prospect_stage(a1, 'demo_attended');
  perform public.move_prospect_stage(a1, 'follow_up');
  perform public.move_prospect_stage(a1, 'closed_won', 'product_fit');
  -- a2: skip to qualified, back to contacted, lost (reach = qualified)
  perform public.move_prospect_stage(a2, 'qualified');
  perform public.move_prospect_stage(a2, 'contacted');
  perform public.move_prospect_stage(a2, 'closed_lost', 'price');
  -- a3: contacted → lost → reopened at conversation → skip to demo attended → won
  perform public.move_prospect_stage(a3, 'contacted');
  perform public.move_prospect_stage(a3, 'closed_lost', 'timing');
  perform public.move_prospect_stage(a3, 'conversation');
  perform public.move_prospect_stage(a3, 'demo_attended');
  perform public.move_prospect_stage(a3, 'closed_won', 'relationship');
  -- a4: closed_lost-only path after contacted (reach = contacted)
  perform public.move_prospect_stage(a4, 'contacted');
  perform public.move_prospect_stage(a4, 'closed_lost', 'no_budget');
  -- a5: skip to demo booked (open)
  perform public.move_prospect_stage(a5, 'demo_booked');
  -- a7: straight to won (created before the period, closed inside)
  perform public.move_prospect_stage(a7, 'closed_won', 'urgent_need');
  -- a8: skip to follow-up (reach 7 ⇒ ≥ demo attended, not won)
  perform public.move_prospect_stage(a8, 'follow_up');
  -- a9: straight to won (closed right after the period)
  perform public.move_prospect_stage(a9, 'closed_won', 'other');
  -- B
  perform public.move_prospect_stage(b1, 'contacted');
  perform public.move_prospect_stage(b1, 'conversation');
  perform public.move_prospect_stage(b1, 'closed_lost', 'competitor');
  perform public.move_prospect_stage(b2, 'demo_attended');
  perform public.move_prospect_stage(b2, 'closed_won', 'urgent_need');
  perform public.move_prospect_stage(b3, 'contacted');
end;
$$;

-- Pin closed_at (stage unchanged → the trigger keeps the value).
update public.prospects p set closed_at = v.closed_at::timestamptz
from (values
  ('00000000-0000-0000-0000-0000013a00a1'::uuid, '2025-09-20 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00a2', '2025-09-21 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00a3', '2025-09-25 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00a4', '2025-09-30 23:30-04'), -- last evening (= Oct 1 UTC) → inside
  ('00000000-0000-0000-0000-0000013a00a7', '2025-09-15 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00a9', '2025-10-01 00:00-04'), -- first instant after → outside
  ('00000000-0000-0000-0000-0000013a00b1', '2025-09-10 12:00-04'),
  ('00000000-0000-0000-0000-0000013a00b2', '2025-09-11 12:00-04')
) as v(id, closed_at)
where p.id = v.id;

-- Follow-ups: A overdue (a5), today (a6), upcoming (a8); completed in the
-- period (a1, a2 last evening) and one just before (a2). B: overdue + 1 completed.
insert into public.follow_ups (prospect_id, due_date, note, status, completed_at) values
  ('00000000-0000-0000-0000-0000013a00a5', public.org_today() - 1, 'late',  'pending', null),
  ('00000000-0000-0000-0000-0000013a00a6', public.org_today(),     'today', 'pending', null),
  ('00000000-0000-0000-0000-0000013a00a8', public.org_today() + 3, 'soon',  'pending', null),
  ('00000000-0000-0000-0000-0000013a00a1', '2025-09-14', 'done in', 'completed', '2025-09-15 10:00-04'),
  ('00000000-0000-0000-0000-0000013a00a2', '2025-08-30', 'done before', 'completed', '2025-08-31 23:59-04'),
  ('00000000-0000-0000-0000-0000013a00a2', '2025-09-30', 'done last evening', 'completed', '2025-09-30 23:59-04'),
  ('00000000-0000-0000-0000-0000013a00b3', public.org_today() - 5, 'late', 'pending', null),
  ('00000000-0000-0000-0000-0000013a00b1', '2025-09-09', 'done', 'completed', '2025-09-10 09:00-04');

-- ---------------------------------------------------------------------------
-- Shapes + grants (1–8)
-- ---------------------------------------------------------------------------
select has_function('public', 'report_stage_counts', array['uuid'], 'report_stage_counts() exists');
select has_function('public', 'report_funnel', array['date', 'date', 'uuid'], 'report_funnel() exists');
select has_function('public', 'report_outcomes', array['date', 'date', 'uuid'], 'report_outcomes() exists');
select has_function('public', 'report_pipeline_value', array['uuid'], 'report_pipeline_value() exists');
select has_function('public', 'report_follow_ups', array['date', 'date', 'uuid'], 'report_follow_ups() exists');
select is(
  (select count(*)::integer from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('report_stage_counts', 'report_stage_reached', 'report_funnel', 'report_outcomes',
                      'report_pipeline_value', 'report_follow_ups', 'prospects_created_in_period',
                      'prospects_closed_in_period', 'org_period_bounds', 'closed_outcome_counts')
      and not prosecdef
      and array_to_string(proconfig, ',') like '%search_path=%'),
  10, 'report functions are security invoker with a pinned search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.report_funnel(date, date, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.report_outcomes(date, date, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.report_stage_counts(uuid)', 'execute'),
  'authenticated can call the report functions'
);
select ok(
  not has_function_privilege('anon', 'public.report_funnel(date, date, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.report_outcomes(date, date, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.report_follow_ups(date, date, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.report_stage_counts(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.report_pipeline_value(uuid)', 'execute'),
  'anon cannot call the report functions'
);

-- ---------------------------------------------------------------------------
-- Helpers (9–12)
-- ---------------------------------------------------------------------------
select is(public.stage_funnel_rank('closed_lost'), null, 'closed_lost is unranked');
select is(public.stage_funnel_rank('closed_won'), 8, 'closed_won ranks above follow_up (7)');
select results_eq(
  $$ select start_at, end_at from public.org_period_bounds('2025-09-01', '2025-09-30') $$,
  $$ values ('2025-09-01 04:00+00'::timestamptz, '2025-10-01 04:00+00'::timestamptz) $$,
  'period = [Sep 1 00:00 NY, Oct 1 00:00 NY)'
);
select throws_ok(
  $$ select * from public.report_funnel('2025-09-30', '2025-09-01') $$,
  '22023', null, 'reversed period → 22023'
);

-- ---------------------------------------------------------------------------
-- Manager M (13–26): whole team, then filtered to A and B
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-0000000013a1');

select results_eq(
  $$ select stage::text, prospect_count from public.report_stage_counts() $$,
  $$ values ('prospect', 1), ('contacted', 1), ('conversation', 0), ('qualified', 0), ('demo_booked', 1),
            ('demo_attended', 0), ('follow_up', 1), ('closed_won', 5), ('closed_lost', 3) $$,
  'M stage counts now: 9 stages, SPEC order, zero-filled (total 12)'
);
select results_eq(
  $$ select step, stage::text, prospect_count, step_conversion_pct, overall_conversion_pct
       from public.report_funnel('2025-09-01', '2025-09-30') $$,
  $$ values (1, 'prospect',      11, null::numeric, 100.0::numeric),
            (2, 'contacted',     10, 90.9, 90.9),
            (3, 'conversation',   8, 80.0, 72.7),
            (4, 'qualified',      7, 87.5, 63.6),
            (5, 'demo_booked',    6, 85.7, 54.5),
            (6, 'demo_attended',  5, 83.3, 45.5),
            (7, 'closed_won',     4, 80.0, 36.4) $$,
  'M funnel (11 created in the period; overall = 4 / 11 = 36.4%)'
);
select results_eq(
  $$ select won, lost, win_rate_pct, won_value, won_without_value, lost_reasons
       from public.report_outcomes('2025-09-01', '2025-09-30') $$,
  $$ values (4, 3, 57.1::numeric,
             '[{"currency":"GBP","total":400.00,"count":1},{"currency":"USD","total":1700.00,"count":2}]'::jsonb,
             1,
             '[{"reason":"competitor","count":1},{"reason":"no_budget","count":1},{"reason":"price","count":1}]'::jsonb) $$,
  'M outcomes: 4 won / 3 lost = 57.1%, won value per currency (a3 without value), lost reasons'
);
select results_eq(
  $$ select currency, total_value, prospect_count from public.report_pipeline_value() $$,
  $$ values ('EUR'::text, 300.00::numeric, 1), ('USD', 100.00, 1), (null, null, 2) $$,
  'M pipeline now: EUR 300 · USD 100 · 2 open without value (nulls ignored)'
);
select results_eq(
  $$ select overdue, due_today, completed from public.report_follow_ups('2025-09-01', '2025-09-30') $$,
  $$ values (2, 1, 3) $$,
  'M follow-ups: 2 overdue + 1 today now, 3 completed in the period (edges NY)'
);

select results_eq(
  $$ select stage::text, prospect_count from public.report_stage_reached('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a2') $$,
  $$ values ('prospect', 8), ('contacted', 7), ('conversation', 6), ('qualified', 6), ('demo_booked', 5),
            ('demo_attended', 4), ('follow_up', 4), ('closed_won', 3) $$,
  'M filtered to A: reached counts (skip counts skipped stages, backward move keeps the max, reopened won counts all)'
);
select results_eq(
  $$ select step, stage::text, prospect_count, step_conversion_pct, overall_conversion_pct
       from public.report_funnel('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a2') $$,
  $$ values (1, 'prospect',      8, null::numeric, 100.0::numeric),
            (2, 'contacted',     7, 87.5, 87.5),
            (3, 'conversation',  6, 85.7, 75.0),
            (4, 'qualified',     6, 100.0, 75.0),
            (5, 'demo_booked',   5, 83.3, 62.5),
            (6, 'demo_attended', 4, 80.0, 50.0),
            (7, 'closed_won',    3, 75.0, 37.5) $$,
  'A funnel: a7 (created 1 min before) out, a8 (00:00 NY day 1) in; overall 3 / 8 = 37.5%'
);
select results_eq(
  $$ select won, lost, win_rate_pct, won_value, won_without_value, lost_reasons
       from public.report_outcomes('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a2') $$,
  $$ values (3, 2, 60.0::numeric,
             '[{"currency":"USD","total":1700.00,"count":2}]'::jsonb,
             1,
             '[{"reason":"no_budget","count":1},{"reason":"price","count":1}]'::jsonb) $$,
  'A outcomes: a1 + a3 (reopened, no value) + a7 won, a2 + a4 (11:30 pm NY) lost, a9 (00:00 NY Oct 1) excluded; a3''s old "timing" loss not counted'
);
select results_eq(
  $$ select won, lost from public.closed_outcome_counts('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a2') $$,
  $$ values (3, 2) $$,
  'closed_outcome_counts() agrees with report_outcomes()'
);
select results_eq(
  $$ select currency, total_value, prospect_count from public.report_pipeline_value('00000000-0000-0000-0000-0000000013a2') $$,
  $$ values ('EUR'::text, 300.00::numeric, 1), ('USD', 100.00, 1), (null, null, 1) $$,
  'A pipeline: a5 EUR 300, a8 USD 100, a6 without value; closed deals ignored'
);
select results_eq(
  $$ select overdue, due_today, completed from public.report_follow_ups('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a2') $$,
  $$ values (1, 1, 2) $$,
  'A follow-ups: 1 overdue, 1 today, 2 completed (Aug 31 23:59 NY excluded, Sep 30 23:59 NY included)'
);
select results_eq(
  $$ select step, prospect_count, step_conversion_pct, overall_conversion_pct
       from public.report_funnel('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a3') $$,
  $$ values (1, 3, null::numeric, 100.0::numeric), (2, 3, 100.0, 100.0), (3, 2, 66.7, 66.7),
            (4, 1, 50.0, 33.3), (5, 1, 100.0, 33.3), (6, 1, 100.0, 33.3), (7, 1, 100.0, 33.3) $$,
  'B funnel: b1 reached conversation, b2 skipped to demo attended then won, b3 contacted'
);
select results_eq(
  $$ select won, lost, win_rate_pct, won_value, won_without_value, lost_reasons
       from public.report_outcomes('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a3') $$,
  $$ values (1, 1, 50.0::numeric, '[{"currency":"GBP","total":400.00,"count":1}]'::jsonb, 0,
             '[{"reason":"competitor","count":1}]'::jsonb) $$,
  'B outcomes: 1 won (GBP) / 1 lost = 50%'
);
select results_eq(
  $$ select step, prospect_count, step_conversion_pct, overall_conversion_pct
       from public.report_funnel('2024-01-01', '2024-01-31') $$,
  $$ values (1, 0, null::numeric, null::numeric), (2, 0, null, null), (3, 0, null, null), (4, 0, null, null),
            (5, 0, null, null), (6, 0, null, null), (7, 0, null, null) $$,
  'empty period: 7 zero steps, conversions undefined (null)'
);
select results_eq(
  $$ select won, lost, win_rate_pct, won_value, won_without_value, lost_reasons
       from public.report_outcomes('2024-01-01', '2024-01-31') $$,
  $$ values (0, 0, null::numeric, '[]'::jsonb, 0, '[]'::jsonb) $$,
  'empty period: no outcomes, win rate null'
);
reset role;

-- ---------------------------------------------------------------------------
-- The org timezone decides the period (27–28): Honolulu (UTC−10)
-- a8 (Sep 1 04:00Z = Aug 31 6 pm HST) leaves the cohort; a9 (Oct 1 04:00Z =
-- Sep 30 6 pm HST) closes inside the period.
-- ---------------------------------------------------------------------------
update public.org_settings set timezone = 'Pacific/Honolulu' where id;
select is(
  (select prospect_count from public.report_funnel('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a2') where step = 1),
  7, 'Honolulu: A cohort = 7 (a8 created Aug 31 HST)'
);
select results_eq(
  $$ select won, lost from public.report_outcomes('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a2') $$,
  $$ values (4, 2) $$,
  'Honolulu: a9 closed Sep 30 HST → 4 won'
);
update public.org_settings set timezone = 'America/New_York' where id;

-- ---------------------------------------------------------------------------
-- RLS: rep A (29–41)
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-0000000013a2');
select results_eq(
  $$ select stage::text, prospect_count from public.report_stage_counts() $$,
  $$ values ('prospect', 1), ('contacted', 0), ('conversation', 0), ('qualified', 0), ('demo_booked', 1),
            ('demo_attended', 0), ('follow_up', 1), ('closed_won', 4), ('closed_lost', 2) $$,
  'rep A stage counts: own prospects only'
);
select is(
  (select array_agg(prospect_count order by step) from public.report_funnel('2025-09-01', '2025-09-30')),
  array[8, 7, 6, 6, 5, 4, 3], 'rep A funnel without owner = own funnel'
);
select is(
  (select overall_conversion_pct from public.report_funnel('2025-09-01', '2025-09-30') where stage = 'closed_won'),
  37.5, 'rep A overall conversion 37.5%'
);
select results_eq(
  $$ select won, lost, win_rate_pct from public.report_outcomes('2025-09-01', '2025-09-30') $$,
  $$ values (3, 2, 60.0::numeric) $$,
  'rep A win rate 60%'
);
select results_eq(
  $$ select currency, total_value, prospect_count from public.report_pipeline_value() $$,
  $$ values ('EUR'::text, 300.00::numeric, 1), ('USD', 100.00, 1), (null, null, 1) $$,
  'rep A pipeline value: own only'
);
select results_eq(
  $$ select overdue, due_today, completed from public.report_follow_ups('2025-09-01', '2025-09-30') $$,
  $$ values (1, 1, 2) $$,
  'rep A follow-ups: own only'
);
-- A asking for B's numbers gets nothing (RLS), never B's data.
select is(
  (select sum(prospect_count)::integer from public.report_stage_counts('00000000-0000-0000-0000-0000000013a3')),
  0, 'rep A filtering by B: stage counts 0'
);
select is(
  (select array_agg(prospect_count order by step) from public.report_funnel('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a3')),
  array[0, 0, 0, 0, 0, 0, 0], 'rep A filtering by B: empty funnel'
);
select results_eq(
  $$ select won, lost, win_rate_pct, won_value, lost_reasons from public.report_outcomes('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a3') $$,
  $$ values (0, 0, null::numeric, '[]'::jsonb, '[]'::jsonb) $$,
  'rep A filtering by B: no outcomes'
);
select is(
  (select count(*)::integer from public.report_pipeline_value('00000000-0000-0000-0000-0000000013a3')),
  0, 'rep A filtering by B: no pipeline rows'
);
select results_eq(
  $$ select overdue, due_today, completed from public.report_follow_ups('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a3') $$,
  $$ values (0, 0, 0) $$,
  'rep A filtering by B: no follow-ups'
);
select is(
  (select count(*)::integer from public.prospects_created_in_period('2025-09-01', '2025-09-30')),
  8, 'rep A cohort helper sees own 8 prospects'
);
select is(
  (select count(*)::integer from public.prospects_closed_in_period('2025-09-01', '2025-09-30')),
  5, 'rep A closed helper: 5 closed in the period'
);
reset role;

-- ---------------------------------------------------------------------------
-- RLS: rep B (42–47)
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-0000000013a3');
select results_eq(
  $$ select stage::text, prospect_count from public.report_stage_counts() where prospect_count > 0 $$,
  $$ values ('contacted', 1), ('closed_won', 1), ('closed_lost', 1) $$,
  'rep B stage counts: own only'
);
select is(
  (select array_agg(prospect_count order by step) from public.report_funnel('2025-09-01', '2025-09-30')),
  array[3, 3, 2, 1, 1, 1, 1], 'rep B funnel'
);
select is(
  (select prospect_count from public.report_stage_reached('2025-09-01', '2025-09-30') where stage = 'follow_up'),
  1, 'rep B reached follow-up: b2 (won counts as reached)'
);
select results_eq(
  $$ select currency, total_value, prospect_count from public.report_pipeline_value() $$,
  $$ values (null::text, null::numeric, 1) $$,
  'rep B pipeline: only b3, without value'
);
select results_eq(
  $$ select overdue, due_today, completed from public.report_follow_ups('2025-09-01', '2025-09-30') $$,
  $$ values (1, 0, 1) $$,
  'rep B follow-ups'
);
select results_eq(
  $$ select won, lost from public.report_outcomes('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a2') $$,
  $$ values (0, 0) $$,
  'rep B cannot see A''s outcomes'
);
reset role;

-- ---------------------------------------------------------------------------
-- Stage history is the source (48–52): the funnel reach survives later moves.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::integer from public.stage_history where prospect_id = '00000000-0000-0000-0000-0000013a00a2'),
  4, 'a2 history: created + 3 real moves'
);
-- Move a5 back to prospect: it still reached demo_booked.
select public.move_prospect_stage('00000000-0000-0000-0000-0000013a00a5', 'prospect') is not null as moved_back;
select is(
  (select prospect_count from public.report_funnel('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a2') where stage = 'demo_booked'),
  5, 'a backward move never lowers the funnel (a5 back to prospect still counts at demo booked)'
);
select is(
  (select prospect_count from public.report_stage_counts('00000000-0000-0000-0000-0000000013a2') where stage = 'prospect'),
  2, 'but the current stage counts move (a5 + a6 now at prospect)'
);
-- A prospect created directly as closed_lost counts only as a Prospect.
insert into public.prospects (id, name, owner_id, stage, close_reason, currency, created_at) values
  ('00000000-0000-0000-0000-0000013a00aa', 'aa created lost', '00000000-0000-0000-0000-0000000013a2',
   'closed_lost', 'other', 'USD', '2025-09-15 12:00-04');
select is(
  (select array_agg(prospect_count order by step) from public.report_funnel('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a2')),
  array[9, 7, 6, 6, 5, 4, 3], 'created as closed_lost: counts as a Prospect only'
);
select is(
  (select step_conversion_pct from public.report_funnel('2025-09-01', '2025-09-30', '00000000-0000-0000-0000-0000000013a2') where stage = 'contacted'),
  77.8, 'step conversion recomputed: 7 / 9 = 77.8%'
);

select * from finish();
rollback;
