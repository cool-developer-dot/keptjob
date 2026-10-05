-- pgTAP tests for Prompt 9 (Kanban): latest_ai_insights view (RLS via
-- security_invoker) and the owner-change Realtime broadcast + its policy.
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

-- ---------------------------------------------------------------------------
-- Setup (as postgres): M manager, A / B reps; PA (A), PB (B), PN (A, no insight)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000dd01', 'm@pipe.test', '{"role":"manager"}',   '{"full_name":"M"}'),
  ('00000000-0000-0000-0000-00000000dd02', 'a@pipe.test', '{"role":"sales_rep"}', '{"full_name":"A"}'),
  ('00000000-0000-0000-0000-00000000dd03', 'b@pipe.test', '{"role":"sales_rep"}', '{"full_name":"B"}');

insert into public.prospects (id, name, owner_id) values
  ('00000000-0000-0000-0000-0000000ee001', 'PA', '00000000-0000-0000-0000-00000000dd02'),
  ('00000000-0000-0000-0000-0000000ee002', 'PB', '00000000-0000-0000-0000-00000000dd03'),
  ('00000000-0000-0000-0000-0000000ee003', 'PN', '00000000-0000-0000-0000-00000000dd02');

-- PA: older "low", newer "high"; PB: one "medium".
insert into public.ai_insights
  (prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model, created_by, created_at)
values
  ('00000000-0000-0000-0000-0000000ee001', 's', 'unknown', 'o', 'n', 'low',    'm', '00000000-0000-0000-0000-00000000dd02', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000ee001', 's', 'unknown', 'o', 'n', 'high',   'm', '00000000-0000-0000-0000-00000000dd02', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000ee002', 's', 'unknown', 'o', 'n', 'medium', 'm', '00000000-0000-0000-0000-00000000dd03', now());

-- ---------------------------------------------------------------------------
-- View shape + grants
-- ---------------------------------------------------------------------------
select has_view('public', 'latest_ai_insights', 'latest_ai_insights view exists');
select ok(
  (select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.latest_ai_insights'::regclass),
  'latest_ai_insights is security_invoker'
);
select ok(has_table_privilege('authenticated', 'public.latest_ai_insights', 'select'), 'authenticated can select the view');
select ok(not has_table_privilege('anon', 'public.latest_ai_insights', 'select'), 'anon cannot select the view');

-- ---------------------------------------------------------------------------
-- RLS through the view
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000dd02');
select results_eq(
  $$ select prospect_id, deal_health::text from public.latest_ai_insights
      where prospect_id in ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-0000000ee002', '00000000-0000-0000-0000-0000000ee003') $$,
  $$ values ('00000000-0000-0000-0000-0000000ee001'::uuid, 'high') $$,
  'rep A sees only the latest insight of their own prospect'
);
reset role;

select pg_temp.login_as('00000000-0000-0000-0000-00000000dd03');
select results_eq(
  $$ select prospect_id, deal_health::text from public.latest_ai_insights
      where prospect_id in ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-0000000ee002') $$,
  $$ values ('00000000-0000-0000-0000-0000000ee002'::uuid, 'medium') $$,
  'rep B sees only their own'
);
reset role;

select pg_temp.login_as('00000000-0000-0000-0000-00000000dd01');
select results_eq(
  $$ select prospect_id, deal_health::text from public.latest_ai_insights
      where prospect_id in ('00000000-0000-0000-0000-0000000ee001', '00000000-0000-0000-0000-0000000ee002', '00000000-0000-0000-0000-0000000ee003')
      order by prospect_id $$,
  $$ values ('00000000-0000-0000-0000-0000000ee001'::uuid, 'high'), ('00000000-0000-0000-0000-0000000ee002'::uuid, 'medium') $$,
  'manager sees the latest insight of every prospect (one row each)'
);
reset role;

-- ---------------------------------------------------------------------------
-- Owner-change broadcast trigger
-- ---------------------------------------------------------------------------
select has_trigger('public', 'prospects', 'prospects_broadcast_owner_change', 'owner-change broadcast trigger exists');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
    where oid = 'public.prospects_broadcast_owner_change()'::regprocedure),
  'trigger function is security definer with an empty search_path'
);
select ok(
  not has_function_privilege('authenticated', 'public.prospects_broadcast_owner_change()', 'execute'),
  'authenticated cannot execute the trigger function directly'
);

-- Manager reassigns PA from A to B → one private broadcast on A's topic.
select pg_temp.login_as('00000000-0000-0000-0000-00000000dd01');
update public.prospects set owner_id = '00000000-0000-0000-0000-00000000dd03'
 where id = '00000000-0000-0000-0000-0000000ee001';
reset role;

select results_eq(
  $$ select event, private, payload->>'prospect_id' from realtime.messages
      where topic = 'user:00000000-0000-0000-0000-00000000dd02' $$,
  $$ values ('prospect_owner_changed'::text, true, '00000000-0000-0000-0000-0000000ee001'::text) $$,
  'reassignment broadcasts prospect_owner_changed (id only) to the previous owner'
);
select is(
  (select count(*)::int from realtime.messages where topic = 'user:00000000-0000-0000-0000-00000000dd03'),
  0,
  'the new owner gets no broadcast (postgres_changes covers them)'
);

-- A non-owner update (name) broadcasts nothing.
update public.prospects set name = 'PB renamed' where id = '00000000-0000-0000-0000-0000000ee002';
select is(
  (select count(*)::int from realtime.messages where topic like 'user:00000000-0000-0000-0000-00000000dd%'),
  1,
  'updates that keep the owner broadcast nothing'
);

-- ---------------------------------------------------------------------------
-- realtime.messages policy: only your own `user:<id>` topic
-- ---------------------------------------------------------------------------
select policies_are(
  'realtime', 'messages', array['users receive their own broadcasts'],
  'realtime.messages has only the own-topic policy'
);

select pg_temp.login_as('00000000-0000-0000-0000-00000000dd02');
select set_config('realtime.topic', 'user:00000000-0000-0000-0000-00000000dd02', true);
select is(
  (select count(*)::int from realtime.messages where topic = 'user:00000000-0000-0000-0000-00000000dd02'),
  1,
  'rep A can read broadcasts on their own topic'
);
select set_config('realtime.topic', 'user:00000000-0000-0000-0000-00000000dd03', true);
select is(
  (select count(*)::int from realtime.messages),
  0,
  'rep A cannot read another user''s topic'
);
reset role;

select * from finish();
rollback;
