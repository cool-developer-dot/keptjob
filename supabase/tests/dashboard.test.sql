-- pgTAP tests for Prompt 12 (Dashboard): open_pipeline_value(),
-- closed_outcome_counts() (org-tz period edges), latest_ai_insights next step,
-- deals_needing_attention ranks, and RLS for reps A / B and manager M.
-- Run with: npm run test:db. Everything is rolled back.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

create function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Setup (as postgres): M manager, A / B reps (fresh ids, so the seed never
-- matches an owner filter). Org timezone New York, stale_days 14.
-- ---------------------------------------------------------------------------
update public.org_settings set timezone = 'America/New_York', stale_days = 14 where id;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000da01', 'm@dash.test', '{"role":"manager"}',   '{"full_name":"M"}'),
  ('00000000-0000-0000-0000-00000000da02', 'a@dash.test', '{"role":"sales_rep"}', '{"full_name":"A"}'),
  ('00000000-0000-0000-0000-00000000da03', 'b@dash.test', '{"role":"sales_rep"}', '{"full_name":"B"}');

-- A1 overdue + stale + AI low (rank 1) · A2 stale, upcoming follow-up (2)
-- A3 AI low, follow-up today (3) · A4 no follow-up, no value (4)
-- A8 healthy (not listed) · A5 won, A6 lost (in period), A7 lost (1 min before) · B1 B's.
insert into public.prospects (id, name, owner_id, stage, deal_value, currency, close_reason, closed_at, last_activity_at) values
  ('00000000-0000-0000-0000-0000000da0a1', 'A1', '00000000-0000-0000-0000-00000000da02', 'prospect',    1000,   'USD', null, null, now() - interval '20 days'),
  ('00000000-0000-0000-0000-0000000da0a2', 'A2', '00000000-0000-0000-0000-00000000da02', 'qualified',   500.50, 'USD', null, null, now() - interval '30 days'),
  ('00000000-0000-0000-0000-0000000da0a3', 'A3', '00000000-0000-0000-0000-00000000da02', 'contacted',   200,    'EUR', null, null, now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000da0a4', 'A4', '00000000-0000-0000-0000-00000000da02', 'conversation', null,  'USD', null, null, now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000da0a8', 'A8', '00000000-0000-0000-0000-00000000da02', 'follow_up',   0,      'USD', null, null, now()),
  ('00000000-0000-0000-0000-0000000da0a5', 'A5', '00000000-0000-0000-0000-00000000da02', 'closed_won',  9999,   'USD', 'product_fit', '2026-10-06 03:30+00', now()),
  ('00000000-0000-0000-0000-0000000da0a6', 'A6', '00000000-0000-0000-0000-00000000da02', 'closed_lost', 50,     'USD', 'price',       '2026-07-08 04:00+00', now()),
  ('00000000-0000-0000-0000-0000000da0a7', 'A7', '00000000-0000-0000-0000-00000000da02', 'closed_lost', 50,     'USD', 'timing',      '2026-07-08 03:59+00', now()),
  ('00000000-0000-0000-0000-0000000da0b1', 'B1', '00000000-0000-0000-0000-00000000da03', 'prospect',    700,    'USD', null, null, now());

insert into public.follow_ups (prospect_id, due_date, note) values
  ('00000000-0000-0000-0000-0000000da0a1', public.org_today() - 2, 'late'),
  ('00000000-0000-0000-0000-0000000da0a2', public.org_today() + 3, 'soon'),
  ('00000000-0000-0000-0000-0000000da0a3', public.org_today(),     'today'),
  ('00000000-0000-0000-0000-0000000da0a8', public.org_today() + 1, 'next'),
  ('00000000-0000-0000-0000-0000000da0b1', public.org_today() + 1, 'next');

insert into public.ai_insights
  (prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model, created_by, created_at)
values
  ('00000000-0000-0000-0000-0000000da0a1', 's', 'unknown', 'Price', 'Old step', 'high', 'm', '00000000-0000-0000-0000-00000000da02', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000da0a1', 's', 'unknown', 'Price', 'Call the CFO', 'low', 'm', '00000000-0000-0000-0000-00000000da02', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000da0a3', 's', 'unknown', 'Timing', 'Send a case study', 'low', 'm', '00000000-0000-0000-0000-00000000da02', now()),
  ('00000000-0000-0000-0000-0000000da0a8', 's', 'unknown', 'None', 'Book the demo', 'high', 'm', '00000000-0000-0000-0000-00000000da02', now());

-- ---------------------------------------------------------------------------
-- Shapes + grants
-- ---------------------------------------------------------------------------
select has_function('public', 'open_pipeline_value', array['uuid'], 'open_pipeline_value() exists');
select has_function('public', 'closed_outcome_counts', array['date', 'date', 'uuid'], 'closed_outcome_counts() exists');
select has_view('public', 'deals_needing_attention', 'deals_needing_attention view exists');
select ok(
  (select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.deals_needing_attention'::regclass),
  'deals_needing_attention is security_invoker'
);
select ok(
  (select not prosecdef from pg_proc where oid = 'public.open_pipeline_value(uuid)'::regprocedure)
  and (select not prosecdef from pg_proc where oid = 'public.closed_outcome_counts(date, date, uuid)'::regprocedure),
  'metric functions are security invoker'
);
select ok(has_function_privilege('authenticated', 'public.open_pipeline_value(uuid)', 'execute'), 'authenticated can call open_pipeline_value');
select ok(not has_function_privilege('anon', 'public.open_pipeline_value(uuid)', 'execute'), 'anon cannot call open_pipeline_value');
select ok(not has_function_privilege('anon', 'public.closed_outcome_counts(date, date, uuid)', 'execute'), 'anon cannot call closed_outcome_counts');
select ok(has_table_privilege('authenticated', 'public.deals_needing_attention', 'select'), 'authenticated can select deals_needing_attention');
select ok(not has_table_privilege('anon', 'public.deals_needing_attention', 'select'), 'anon cannot select deals_needing_attention');
select ok(not has_table_privilege('authenticated', 'public.deals_needing_attention', 'insert'), 'deals_needing_attention is read-only');
select has_column('public', 'latest_ai_insights', 'recommended_next_step', 'latest_ai_insights exposes the next step');

-- ---------------------------------------------------------------------------
-- open_pipeline_value(): open only, per currency, nulls counted apart
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select currency, total_value, prospect_count from public.open_pipeline_value('00000000-0000-0000-0000-00000000da02') $$,
  $$ values ('EUR'::text, 200.00::numeric, 1), ('USD', 1500.50, 3), (null, null, 1) $$,
  'A: EUR 200 (1) · USD 1,500.50 (3 incl. a 0 value) · 1 without value; closed deals ignored'
);
select is(
  (select sum(prospect_count)::integer from public.open_pipeline_value('00000000-0000-0000-0000-00000000da02')),
  5, 'sum of prospect_count = open prospects'
);

-- ---------------------------------------------------------------------------
-- closed_outcome_counts(): org-tz calendar dates, inclusive bounds
-- A5 won 2026-10-06 03:30Z = Oct 5 23:30 EDT; A6 lost 07-08 04:00Z = Jul 8 00:00
-- EDT; A7 lost 07-08 03:59Z = Jul 7 23:59 EDT.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select won, lost from public.closed_outcome_counts('2026-07-08', '2026-10-05', '00000000-0000-0000-0000-00000000da02') $$,
  $$ values (1, 1) $$,
  'Jul 8 – Oct 5 (NY): A5 won (11:30 pm NY = next day UTC) + A6 lost; A7 (Jul 7 NY) excluded'
);
select results_eq(
  $$ select won, lost from public.closed_outcome_counts('2026-07-07', '2026-10-04', '00000000-0000-0000-0000-00000000da02') $$,
  $$ values (0, 2) $$,
  'Jul 7 – Oct 4 (NY): A6 + A7 lost, A5 (Oct 5 NY) excluded'
);
update public.org_settings set timezone = 'Pacific/Honolulu' where id;
select results_eq(
  $$ select won, lost from public.closed_outcome_counts('2026-07-08', '2026-10-05', '00000000-0000-0000-0000-00000000da02') $$,
  $$ values (1, 0) $$,
  'the org timezone decides the date (Honolulu: A6 is Jul 7 6 pm, excluded)'
);
update public.org_settings set timezone = 'America/New_York' where id;

-- ---------------------------------------------------------------------------
-- latest_ai_insights: newest next step
-- ---------------------------------------------------------------------------
select is(
  (select recommended_next_step from public.latest_ai_insights where prospect_id = '00000000-0000-0000-0000-0000000da0a1'),
  'Call the CFO', 'latest_ai_insights returns the newest next step'
);

-- ---------------------------------------------------------------------------
-- deals_needing_attention: flags + ranks + order
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select name, attention_rank, has_overdue_follow_up, is_stale, low_health, no_follow_up
       from public.deals_needing_attention
      where owner_id = '00000000-0000-0000-0000-00000000da02'
      order by attention_rank, follow_up_date asc nulls last, last_activity_at, id $$,
  $$ values ('A1'::text, 1, true, true, true, false),
            ('A2', 2, false, true, false, false),
            ('A3', 3, false, false, true, false),
            ('A4', 4, false, false, false, true) $$,
  'A1 overdue (1, every flag) > A2 stale (2) > A3 AI low (3) > A4 no follow-up (4); healthy A8 and closed deals excluded'
);

-- An older low insight does not count once a newer one is high.
update public.ai_insights set created_at = now() + interval '1 minute'
 where prospect_id = '00000000-0000-0000-0000-0000000da0a1' and recommended_next_step = 'Old step';
select is(
  (select low_health from public.deals_needing_attention where id = '00000000-0000-0000-0000-0000000da0a1'),
  false, 'low_health uses the latest insight only'
);

-- Completing the overdue follow-up: A1 drops to stale (rank 2).
update public.follow_ups set status = 'completed', completed_at = now()
 where prospect_id = '00000000-0000-0000-0000-0000000da0a1';
select is(
  (select attention_rank from public.deals_needing_attention where id = '00000000-0000-0000-0000-0000000da0a1'),
  2, 'without the overdue follow-up A1 ranks as stale'
);

-- Closing a deal removes it.
update public.prospects set stage = 'closed_lost', close_reason = 'price'
 where id = '00000000-0000-0000-0000-0000000da0a4';
select is(
  (select count(*)::integer from public.deals_needing_attention where id = '00000000-0000-0000-0000-0000000da0a4'),
  0, 'closed deals never need attention'
);

-- ---------------------------------------------------------------------------
-- RLS (security invoker)
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000da02');
select is(
  (select sum(prospect_count)::integer from public.open_pipeline_value()),
  4, 'rep A: pipeline over their own open prospects only (A4 now closed)'
);
select is(
  (select sum(prospect_count)::integer from public.open_pipeline_value('00000000-0000-0000-0000-00000000da03')),
  null, 'rep A filtering by B sees nothing'
);
select results_eq(
  $$ select won, lost from public.closed_outcome_counts('2026-07-07', '2026-10-04') $$,
  $$ values (0, 2) $$,
  'rep A: own closed deals in the period (A6, A7)'
);
select is(
  (select count(*)::integer from public.deals_needing_attention where owner_id <> '00000000-0000-0000-0000-00000000da02'),
  0, 'rep A sees no other owner in deals_needing_attention'
);
reset role;

select pg_temp.login_as('00000000-0000-0000-0000-00000000da03');
select results_eq(
  $$ select currency, total_value, prospect_count from public.open_pipeline_value() $$,
  $$ values ('USD'::text, 700.00::numeric, 1) $$,
  'rep B: only B1'
);
select is(
  (select count(*)::integer from public.deals_needing_attention),
  0, 'rep B: B1 is healthy, nothing needs attention'
);
select results_eq(
  $$ select won, lost from public.closed_outcome_counts('2026-07-08', '2026-10-05', '00000000-0000-0000-0000-00000000da02') $$,
  $$ values (0, 0) $$,
  'rep B cannot count A''s closed deals'
);
reset role;

select pg_temp.login_as('00000000-0000-0000-0000-00000000da01');
select is(
  (select sum(prospect_count)::integer from public.open_pipeline_value('00000000-0000-0000-0000-00000000da03')),
  1, 'manager filtered to B: 1 open prospect'
);
select ok(
  (select sum(prospect_count) from public.open_pipeline_value())
    = (select count(*) from public.prospects where stage not in ('closed_won', 'closed_lost')),
  'manager (all): open prospects of the whole team'
);
select is(
  (select count(*)::integer from public.deals_needing_attention where owner_id = '00000000-0000-0000-0000-00000000da02'),
  3, 'manager sees A''s attention rows (A1, A2, A3)'
);
reset role;

select * from finish();
rollback;
