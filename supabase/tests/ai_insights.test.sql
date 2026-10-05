-- pgTAP tests for Prompt 11 (AI insights): ai_insight_recent_count() (DB-clock
-- rate limit) and record_ai_insight() (atomic insight + ai_insight activity,
-- RLS, limit re-check, last_activity_at untouched).
-- Run with: npm run test:db. Everything is rolled back.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

create function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.as_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Setup (as postgres): M manager, A / B reps; PA (A), PB (B)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000aa01', 'm@ai.test', '{"role":"manager"}',   '{"full_name":"M"}'),
  ('00000000-0000-0000-0000-00000000aa02', 'a@ai.test', '{"role":"sales_rep"}', '{"full_name":"A"}'),
  ('00000000-0000-0000-0000-00000000aa03', 'b@ai.test', '{"role":"sales_rep"}', '{"full_name":"B"}');

insert into public.prospects (id, name, owner_id) values
  ('00000000-0000-0000-0000-0000000bb001', 'PA', '00000000-0000-0000-0000-00000000aa02'),
  ('00000000-0000-0000-0000-0000000bb002', 'PB', '00000000-0000-0000-0000-00000000aa03');

-- A known, older last_activity_at to prove the ai_insight activity doesn't move it.
update public.prospects set last_activity_at = '2026-01-01 12:00:00+00'
 where id = '00000000-0000-0000-0000-0000000bb001';

-- One insight by A from 11 minutes ago: outside the window.
insert into public.ai_insights
  (prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model, created_by, created_at)
values
  ('00000000-0000-0000-0000-0000000bb001', 'old', 'unknown', 'o', 'n', 'low', 'm',
   '00000000-0000-0000-0000-00000000aa02', now() - interval '11 minutes');

-- ---------------------------------------------------------------------------
-- Shape + grants
-- ---------------------------------------------------------------------------
select has_function('public', 'ai_insight_recent_count', array[]::text[], 'ai_insight_recent_count() exists');
select has_function('public', 'record_ai_insight',
  array['uuid', 'text', 'decision_maker_status', 'text', 'text', 'deal_health', 'text'], 'record_ai_insight() exists');
select ok(not has_function_privilege('anon', 'public.ai_insight_recent_count()', 'execute'), 'anon cannot count');
select ok(not has_function_privilege('anon',
  'public.record_ai_insight(uuid, text, public.decision_maker_status, text, text, public.deal_health, text)', 'execute'),
  'anon cannot record');
select ok(has_function_privilege('authenticated',
  'public.record_ai_insight(uuid, text, public.decision_maker_status, text, text, public.deal_health, text)', 'execute'),
  'authenticated can record');

-- ---------------------------------------------------------------------------
-- Rep A records an insight on own prospect
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa02');
select is(public.ai_insight_recent_count(), 0, 'A: insights older than 10 minutes do not count');

select lives_ok(
  $$ select public.record_ai_insight('00000000-0000-0000-0000-0000000bb001', 'Summary A', 'yes',
       'Price', 'Call back Friday', 'high', 'test-model') $$,
  'A records an insight on own prospect'
);

select results_eq(
  $$ select created_by, model, decision_maker_status::text, deal_health::text
       from public.ai_insights where summary = 'Summary A' $$,
  $$ values ('00000000-0000-0000-0000-00000000aa02'::uuid, 'test-model', 'yes', 'high') $$,
  'insight row: created_by = A, model + output recorded'
);

select results_eq(
  $$ select a.user_id, a.content, a.metadata ->> 'deal_health', (a.metadata ->> 'insight_id')::uuid = i.id
       from public.activities a join public.ai_insights i on i.summary = 'Summary A'
      where a.prospect_id = '00000000-0000-0000-0000-0000000bb001' and a.type = 'ai_insight' $$,
  $$ values ('00000000-0000-0000-0000-00000000aa02'::uuid, 'Summary A', 'high', true) $$,
  'one ai_insight activity by A: content = summary, metadata { insight_id, deal_health }'
);

select is(
  (select last_activity_at from public.prospects where id = '00000000-0000-0000-0000-0000000bb001'),
  '2026-01-01 12:00:00+00'::timestamptz,
  'last_activity_at unchanged by the ai_insight activity'
);

select is(public.ai_insight_recent_count(), 1, 'A: count = 1 after recording');

-- ---------------------------------------------------------------------------
-- Rep B: no access to A's prospect; own count separate
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa03');
select is(public.ai_insight_recent_count(), 0, 'B: count only includes own insights');
select throws_ok(
  $$ select public.record_ai_insight('00000000-0000-0000-0000-0000000bb001', 'Summary B', 'no',
       'x', 'y', 'low', 'test-model') $$,
  '42501', null,
  'B cannot record an insight on A''s prospect (RLS)'
);
select is(
  (select count(*)::int from public.activities where content = 'Summary B'),
  0,
  'nothing stored for the denied call'
);

-- ---------------------------------------------------------------------------
-- Manager can record on any prospect; counts are per user
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa01');
select lives_ok(
  $$ select public.record_ai_insight('00000000-0000-0000-0000-0000000bb002', 'Summary M', 'unknown',
       'Unknown', 'Ask about timing', 'medium', 'test-model') $$,
  'manager records an insight on B''s prospect'
);
select is(public.ai_insight_recent_count(), 1, 'M: count = 1');

-- ---------------------------------------------------------------------------
-- Rate limit: A reaches 10 in the window → the 11th is rejected
-- ---------------------------------------------------------------------------
select pg_temp.as_postgres();
insert into public.ai_insights
  (prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model, created_by, created_at)
select '00000000-0000-0000-0000-0000000bb001', 'bulk ' || g, 'unknown', 'o', 'n', 'medium', 'm',
       '00000000-0000-0000-0000-00000000aa02', now() - interval '5 minutes'
  from generate_series(1, 9) g;

select pg_temp.login_as('00000000-0000-0000-0000-00000000aa02');
select is(public.ai_insight_recent_count(), 10, 'A: 10 insights in the last 10 minutes');
select throws_ok(
  $$ select public.record_ai_insight('00000000-0000-0000-0000-0000000bb001', 'Summary 11', 'yes',
       'Price', 'n', 'high', 'test-model') $$,
  'P0001', 'AI insight rate limit reached',
  'the 11th insight within 10 minutes is rejected'
);
select is(
  (select count(*)::int from public.ai_insights where summary = 'Summary 11'),
  0,
  'nothing stored for the rate-limited call'
);

-- ---------------------------------------------------------------------------
-- Not signed in (no sub) → 42501; append-only stays (no update grant)
-- ---------------------------------------------------------------------------
select pg_temp.as_postgres();
select set_config('role', 'authenticated', true);
select throws_ok(
  $$ select public.record_ai_insight('00000000-0000-0000-0000-0000000bb001', 'Anon', 'yes',
       'x', 'y', 'high', 'test-model') $$,
  '42501', 'Not signed in',
  'record_ai_insight requires a signed-in user'
);
select pg_temp.as_postgres();
select ok(not has_table_privilege('authenticated', 'public.ai_insights', 'update'), 'ai_insights stays append-only (no update)');
select ok(not has_column_privilege('authenticated', 'public.ai_insights', 'created_at', 'insert'),
  'created_at is not writable (rate limit cannot be bypassed)');

select * from finish();
rollback;
