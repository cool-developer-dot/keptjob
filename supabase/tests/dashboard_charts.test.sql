-- pgTAP tests for the dashboard charts: dashboard_daily_activity(),
-- dashboard_weekly_flow(), dashboard_team_summary(); zero-filling, org-tz
-- day edges, owner filter and RLS for reps A / B and manager M.
-- Run with: npm run test:db. Everything is rolled back.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

create function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Clean slate (rolled back): only this file's rows exist.
set local session_replication_role = replica;
delete from public.activities;
delete from public.follow_ups;
delete from public.stage_history;
delete from public.ai_insights;
delete from public.prospects;
set local session_replication_role = origin;

update public.org_settings set timezone = 'America/New_York', stale_days = 14 where id;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000dc01', 'm@charts.test', '{"role":"manager"}',   '{"full_name":"M Charts"}'),
  ('00000000-0000-0000-0000-00000000dc02', 'a@charts.test', '{"role":"sales_rep"}', '{"full_name":"A Charts"}'),
  ('00000000-0000-0000-0000-00000000dc03', 'b@charts.test', '{"role":"sales_rep"}', '{"full_name":"B Charts"}');

insert into public.prospects (id, name, owner_id, stage, close_reason, closed_at, created_at, last_activity_at) values
  ('00000000-0000-0000-0000-0000000dc0a1', 'A open',  '00000000-0000-0000-0000-00000000dc02', 'qualified',  null, null,
     now() - interval '2 days', now() - interval '20 days'),
  ('00000000-0000-0000-0000-0000000dc0a2', 'A won',   '00000000-0000-0000-0000-00000000dc02', 'closed_won', 'product_fit', now() - interval '1 day',
     now() - interval '20 days', now()),
  ('00000000-0000-0000-0000-0000000dc0b1', 'B open',  '00000000-0000-0000-0000-00000000dc03', 'prospect',   null, null,
     now(), now());

-- created_at is trigger-protected on insert; pin it for the flow test.
set local session_replication_role = replica;
update public.prospects set created_at = now() - interval '2 days' where id = '00000000-0000-0000-0000-0000000dc0a1';
update public.prospects set created_at = now() - interval '20 days' where id = '00000000-0000-0000-0000-0000000dc0a2';
set local session_replication_role = origin;

-- Activities: 2 today for A (call + note), 1 for A eight days ago, 1 ai_insight today (not counted), 1 today for B.
-- "Today" = noon in New York so the org day is unambiguous.
insert into public.activities (prospect_id, user_id, type, content, occurred_at) values
  ('00000000-0000-0000-0000-0000000dc0a1', '00000000-0000-0000-0000-00000000dc02', 'call', 'c',
     (public.org_today()::timestamp + interval '12 hours') at time zone 'America/New_York'),
  ('00000000-0000-0000-0000-0000000dc0a1', '00000000-0000-0000-0000-00000000dc02', 'note', 'n',
     (public.org_today()::timestamp + interval '12 hours') at time zone 'America/New_York'),
  ('00000000-0000-0000-0000-0000000dc0a1', '00000000-0000-0000-0000-00000000dc02', 'call', 'old',
     ((public.org_today() - 8)::timestamp + interval '12 hours') at time zone 'America/New_York'),
  ('00000000-0000-0000-0000-0000000dc0a1', '00000000-0000-0000-0000-00000000dc02', 'ai_insight', 'ai',
     (public.org_today()::timestamp + interval '12 hours') at time zone 'America/New_York'),
  ('00000000-0000-0000-0000-0000000dc0b1', '00000000-0000-0000-0000-00000000dc03', 'call', 'b',
     (public.org_today()::timestamp + interval '12 hours') at time zone 'America/New_York');

insert into public.follow_ups (prospect_id, owner_id, due_date, note) values
  ('00000000-0000-0000-0000-0000000dc0a1', '00000000-0000-0000-0000-00000000dc02', public.org_today() - 3, 'late');

-- ---------------------------------------------------------------------------
-- Manager M: sees everything.
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000dc01');

select is((select count(*)::int from public.dashboard_daily_activity(14)), 14, 'daily: 14 zero-filled days');
select is((select max(day) from public.dashboard_daily_activity(14)), public.org_today(), 'daily: ends on org today');
select is((select activity_count from public.dashboard_daily_activity(14) where day = public.org_today()), 3,
  'daily: today counts A call + note + B call, not the ai_insight');
select is((select activity_count from public.dashboard_daily_activity(14) where day = public.org_today() - 8), 1,
  'daily: eight days ago');
select is((select activity_count from public.dashboard_daily_activity(14, '00000000-0000-0000-0000-00000000dc02')
  where day = public.org_today()), 2, 'daily: owner filter = A');
select is((select count(*)::int from public.dashboard_daily_activity(7)), 7, 'daily: p_days respected');

select is((select count(*)::int from public.dashboard_weekly_flow(8)), 8, 'flow: 8 windows');
select is((select week_end from public.dashboard_weekly_flow(8) order by week_start desc limit 1), public.org_today(),
  'flow: newest window ends today');
select is((select created_count from public.dashboard_weekly_flow(8) order by week_start desc limit 1), 2,
  'flow: A open (2 days) + B open (today) created this week');
select is((select won_count from public.dashboard_weekly_flow(8) order by week_start desc limit 1), 1,
  'flow: A won yesterday');

select is(
  (select row(open_count, stale_count, overdue_count, won_count, lost_count)::text
     from public.dashboard_team_summary() where user_id = '00000000-0000-0000-0000-00000000dc02'),
  '(1,0,1,1,0)', 'team: A has 1 open (active today, so not stale), 1 overdue follow-up, 1 won');
select is(
  (select row(open_count, stale_count, overdue_count, won_count, lost_count)::text
     from public.dashboard_team_summary() where user_id = '00000000-0000-0000-0000-00000000dc03'),
  '(1,0,0,0,0)', 'team: B has 1 open');
select ok(
  not exists (select 1 from public.dashboard_team_summary() where user_id = '00000000-0000-0000-0000-00000000dc01'),
  'team: managers are not listed');

-- ---------------------------------------------------------------------------
-- Rep B: RLS hides A's rows everywhere.
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000dc03');

select is((select activity_count from public.dashboard_daily_activity(14) where day = public.org_today()), 1,
  'RLS daily: B only sees their own call');
select is((select sum(won_count)::int from public.dashboard_weekly_flow(8)), 0, 'RLS flow: B sees no wins');
select is(
  (select row(open_count, stale_count, overdue_count, won_count, lost_count)::text
     from public.dashboard_team_summary() where user_id = '00000000-0000-0000-0000-00000000dc02'),
  '(0,0,0,0,0)', 'RLS team: A''s row is zeros for B');
reset role;

select * from finish();
rollback;
