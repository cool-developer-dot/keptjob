-- pgTAP tests for Row Level Security (Prompt 2, SPEC §4).
-- Run with: npm run test:db   (local Supabase must be running)
-- Users: M = manager, A / B = sales reps. Queries run as the real API role
-- (`authenticated` + request.jwt.claims); setup runs as postgres (BYPASSRLS).
-- Everything runs in one transaction and is rolled back.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(94);

-- Act as a signed-in user. Call while role is postgres (use `reset role` first).
create function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Clear the JWT claims (system/no auth.uid()). Call after `reset role`.
create function pg_temp.logout() returns void
language sql as $$ select set_config('request.jwt.claims', '', true); $$;

-- Executes a DML statement and returns the number of affected rows.
create function pg_temp.rows_affected(q text) returns int
language plpgsql as $$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ===========================================================================
-- Setup (as postgres)
-- ===========================================================================
-- M aa01 (manager), A aa02, B aa03 (reps)
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000aa01', 'm@rls.test', '{"role":"manager"}',   '{"full_name":"M"}'),
  ('00000000-0000-0000-0000-00000000aa02', 'a@rls.test', '{"role":"sales_rep"}', '{"full_name":"A"}'),
  ('00000000-0000-0000-0000-00000000aa03', 'b@rls.test', '{"role":"sales_rep"}', '{"full_name":"B"}');
-- Make M the only manager (robust against seed data).
update public.users set role = 'sales_rep'
 where role = 'manager' and id <> '00000000-0000-0000-0000-00000000aa01';

-- PA bb01 (owner A), PB bb02 (owner B), PX bb03 (owner B, deleted by M later)
insert into public.prospects (id, name, owner_id) values
  ('00000000-0000-0000-0000-00000000bb01', 'PA', '00000000-0000-0000-0000-00000000aa02'),
  ('00000000-0000-0000-0000-00000000bb02', 'PB', '00000000-0000-0000-0000-00000000aa03'),
  ('00000000-0000-0000-0000-00000000bb03', 'PX', '00000000-0000-0000-0000-00000000aa03');

-- follow-ups: cc01 PA pending, cc02 PA completed, cc03 PB pending
insert into public.follow_ups (id, prospect_id, due_date, note) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000bb01', current_date + 3, 'Call A'),
  ('00000000-0000-0000-0000-00000000cc03', '00000000-0000-0000-0000-00000000bb02', current_date + 3, 'Call B');
insert into public.follow_ups (id, prospect_id, due_date, note, status, completed_at, completed_by) values
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-00000000bb01', current_date - 3, 'Intro',
   'completed', now(), '00000000-0000-0000-0000-00000000aa02');

-- activities: dd01 PA, dd02 PB
insert into public.activities (id, prospect_id, user_id, type, content) values
  ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-00000000bb01',
   '00000000-0000-0000-0000-00000000aa02', 'call', 'A call'),
  ('00000000-0000-0000-0000-00000000dd02', '00000000-0000-0000-0000-00000000bb02',
   '00000000-0000-0000-0000-00000000aa03', 'call', 'B call');

-- ai_insights: ee01 PA, ee02 PB
insert into public.ai_insights
  (id, prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model, created_by)
values
  ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000bb01', 'sum A', 'unknown', 'price',
   'call', 'medium', 'test-model', '00000000-0000-0000-0000-00000000aa02'),
  ('00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-00000000bb02', 'sum B', 'unknown', 'price',
   'call', 'medium', 'test-model', '00000000-0000-0000-0000-00000000aa03');

-- ===========================================================================
-- 1. RLS enabled everywhere; anon gets nothing
-- ===========================================================================
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity),
  0, 'RLS is enabled on every public table');
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity),
  7, 'all 7 public tables have RLS');
select is(
  (select count(*)::int from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v')
      and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))),
  0, 'anon has no privileges on any public table or view');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0, 'anon cannot execute any public function');

set local role anon;
select throws_ok($$select * from public.prospects$$, '42501', null, 'anon cannot select prospects');
select throws_ok($$select public.is_manager()$$, '42501', null, 'anon cannot call is_manager()');
reset role;

-- ===========================================================================
-- 2. Rep A cannot see or change B's data
-- ===========================================================================
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa02');

select results_eq($$select name from public.prospects order by name$$, $$values ('PA'::text)$$,
  'A sees only own prospects');
select results_eq($$select name from public.prospects_with_flags order by name$$, $$values ('PA'::text)$$,
  'flags view respects RLS for A');
select is((select count(*)::int from public.activities where prospect_id = '00000000-0000-0000-0000-00000000bb02'), 0,
  'A sees none of B''s activities');
select is((select count(*)::int from public.follow_ups where prospect_id = '00000000-0000-0000-0000-00000000bb02'), 0,
  'A sees none of B''s follow-ups');
select is((select count(*)::int from public.stage_history where prospect_id = '00000000-0000-0000-0000-00000000bb02'), 0,
  'A sees none of B''s stage history');
select is((select count(*)::int from public.ai_insights where prospect_id = '00000000-0000-0000-0000-00000000bb02'), 0,
  'A sees none of B''s AI insights');
select ok((select count(*) from public.activities where prospect_id = '00000000-0000-0000-0000-00000000bb01') > 0
      and (select count(*) from public.stage_history where prospect_id = '00000000-0000-0000-0000-00000000bb01') > 0
      and (select count(*) from public.ai_insights where prospect_id = '00000000-0000-0000-0000-00000000bb01') > 0
      and (select count(*) from public.follow_ups where prospect_id = '00000000-0000-0000-0000-00000000bb01') = 2,
  'A sees the child rows of own prospects');
select ok(not public.can_access_prospect('00000000-0000-0000-0000-00000000bb02'), 'can_access_prospect(PB) false for A');
select ok(public.can_access_prospect('00000000-0000-0000-0000-00000000bb01'), 'can_access_prospect(PA) true for A');
select ok(not public.can_access_prospect(gen_random_uuid()), 'can_access_prospect(unknown) false');

select is(pg_temp.rows_affected($$update public.prospects set name = 'hacked' where id = '00000000-0000-0000-0000-00000000bb02'$$),
  0, 'A cannot update B''s prospect');
select is(pg_temp.rows_affected($$update public.follow_ups set note = 'hacked' where id = '00000000-0000-0000-0000-00000000cc03'$$),
  0, 'A cannot update B''s follow-up');
select is(pg_temp.rows_affected($$delete from public.follow_ups where id = '00000000-0000-0000-0000-00000000cc03'$$),
  0, 'A cannot delete B''s follow-up');
select throws_ok(
  $$insert into public.activities (prospect_id, type, content) values ('00000000-0000-0000-0000-00000000bb02', 'note', 'x')$$,
  '42501', null, 'A cannot add an activity to B''s prospect');
select throws_ok(
  $$insert into public.follow_ups (prospect_id, due_date, note) values ('00000000-0000-0000-0000-00000000bb02', current_date, 'x')$$,
  '42501', null, 'A cannot add a follow-up to B''s prospect');
select throws_ok(
  $$insert into public.ai_insights (prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model)
    values ('00000000-0000-0000-0000-00000000bb02', 's', 'yes', 'o', 'n', 'high', 'm')$$,
  '42501', null, 'A cannot add an AI insight to B''s prospect');
select throws_ok(
  $$select public.move_prospect_stage('00000000-0000-0000-0000-00000000bb02', 'contacted')$$,
  'P0002', 'Prospect not found', 'move_prospect_stage cannot touch B''s prospect');

-- ===========================================================================
-- 3. Rep A works with own data
-- ===========================================================================
select lives_ok(
  $$insert into public.prospects (id, name) values ('00000000-0000-0000-0000-00000000bb04', 'PA2')$$,
  'A can create a prospect');
select is((select owner_id from public.prospects where id = '00000000-0000-0000-0000-00000000bb04'),
  '00000000-0000-0000-0000-00000000aa02'::uuid, 'owner_id defaults to A');
select throws_ok(
  $$insert into public.prospects (name, owner_id) values ('For B', '00000000-0000-0000-0000-00000000aa03')$$,
  '42501', null, 'A cannot create a prospect owned by B');
select lives_ok(
  $$insert into public.activities (prospect_id, type, content) values ('00000000-0000-0000-0000-00000000bb01', 'note', 'mine')$$,
  'A can add an activity to own prospect');
select throws_ok(
  $$insert into public.activities (prospect_id, user_id, type, content)
    values ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000aa03', 'note', 'as B')$$,
  '42501', null, 'activity user_id must be auth.uid()');
select throws_ok(
  $$insert into public.activities (prospect_id, type, metadata)
    values ('00000000-0000-0000-0000-00000000bb01', 'stage_change', '{"from":"prospect","to":"closed_won"}')$$,
  '42501', null, 'stage_change activities cannot be inserted via the API');
select throws_ok(
  $$insert into public.activities (prospect_id, type) values ('00000000-0000-0000-0000-00000000bb01', 'owner_change')$$,
  '42501', null, 'owner_change activities cannot be inserted via the API');
select throws_ok(
  $$insert into public.activities (prospect_id, type, content, created_at)
    values ('00000000-0000-0000-0000-00000000bb01', 'note', 'x', now() - interval '1 year')$$,
  '42501', null, 'activities.created_at is not writable');
select lives_ok(
  $$insert into public.follow_ups (id, prospect_id, due_date, note)
    values ('00000000-0000-0000-0000-00000000cc04', '00000000-0000-0000-0000-00000000bb01', current_date + 1, 'Next')$$,
  'A can add a follow-up to own prospect');
select lives_ok(
  $$update public.follow_ups set status = 'completed', completed_at = now(), completed_by = auth.uid()
     where id = '00000000-0000-0000-0000-00000000cc04'$$,
  'A can complete own follow-up');
select throws_ok(
  $$update public.follow_ups set prospect_id = '00000000-0000-0000-0000-00000000bb04' where id = '00000000-0000-0000-0000-00000000cc01'$$,
  '42501', null, 'follow_ups.prospect_id is immutable via the API');
select is(pg_temp.rows_affected($$delete from public.follow_ups where id = '00000000-0000-0000-0000-00000000cc04'$$),
  1, 'A can delete own follow-up');
select lives_ok(
  $$insert into public.ai_insights (prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model)
    values ('00000000-0000-0000-0000-00000000bb01', 's', 'yes', 'o', 'n', 'high', 'm')$$,
  'A can add an AI insight to own prospect (created_by defaults to A)');
select throws_ok(
  $$insert into public.ai_insights (prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model, created_by)
    values ('00000000-0000-0000-0000-00000000bb01', 's', 'yes', 'o', 'n', 'high', 'm', '00000000-0000-0000-0000-00000000aa03')$$,
  '42501', null, 'ai_insights.created_by must be auth.uid()');
select throws_ok(
  $$insert into public.ai_insights (prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model, created_at)
    values ('00000000-0000-0000-0000-00000000bb01', 's', 'yes', 'o', 'n', 'high', 'm', now() - interval '1 day')$$,
  '42501', null, 'ai_insights.created_at is not writable (rate limit cannot be bypassed)');
select lives_ok(
  $$select public.move_prospect_stage('00000000-0000-0000-0000-00000000bb01', 'contacted', null, null, 'first call')$$,
  'A can move own prospect via the RPC');
select is((select count(*)::int from public.stage_history
            where prospect_id = '00000000-0000-0000-0000-00000000bb01' and to_stage = 'contacted'
              and changed_by = '00000000-0000-0000-0000-00000000aa02' and note = 'first call'),
  1, 'stage change under RLS is recorded in stage_history by the trigger');
select is((select count(*)::int from public.activities
            where prospect_id = '00000000-0000-0000-0000-00000000bb01' and type = 'stage_change'),
  1, 'stage change under RLS writes the stage_change activity');
select lives_ok(
  $$update public.prospects set notes = 'updated', decision_maker_status = 'yes' where id = '00000000-0000-0000-0000-00000000bb01'$$,
  'A can update own prospect');

-- ===========================================================================
-- 4. A cannot change owner_id, delete prospects or write derived columns
-- ===========================================================================
select throws_ok(
  $$update public.prospects set owner_id = '00000000-0000-0000-0000-00000000aa03' where id = '00000000-0000-0000-0000-00000000bb01'$$,
  '42501', null, 'A cannot change owner_id');
select is(pg_temp.rows_affected($$delete from public.prospects where id = '00000000-0000-0000-0000-00000000bb01'$$),
  0, 'A cannot delete own prospect');
select is(pg_temp.rows_affected($$delete from public.prospects where id = '00000000-0000-0000-0000-00000000bb02'$$),
  0, 'A cannot delete B''s prospect');
select throws_ok(
  $$update public.prospects set last_activity_at = now() where id = '00000000-0000-0000-0000-00000000bb01'$$,
  '42501', null, 'prospects.last_activity_at is not writable via the API');
select throws_ok(
  $$update public.prospects set closed_at = now() where id = '00000000-0000-0000-0000-00000000bb01'$$,
  '42501', null, 'prospects.closed_at is not writable via the API');
select throws_ok(
  $$update public.prospects set follow_up_date = current_date where id = '00000000-0000-0000-0000-00000000bb01'$$,
  '42501', null, 'prospects.follow_up_date is not writable via the API');

reset role;
select pg_temp.logout();
select is((select count(*)::int from public.prospects where id in ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bb02')),
  2, 'PA and PB still exist after A''s delete attempts');
select results_eq(
  $$select name, owner_id from public.prospects where id = '00000000-0000-0000-0000-00000000bb02'$$,
  $$values ('PB'::text, '00000000-0000-0000-0000-00000000aa03'::uuid)$$,
  'PB is unchanged');
select is((select note from public.follow_ups where id = '00000000-0000-0000-0000-00000000cc03'), 'Call B',
  'B''s follow-up is unchanged');

-- ===========================================================================
-- 5. Manager M sees everything and reassigns A -> B
-- ===========================================================================
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa01');

select is((select count(*)::int from public.prospects
            where id in ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000bb02',
                         '00000000-0000-0000-0000-00000000bb03', '00000000-0000-0000-0000-00000000bb04')),
  4, 'M sees all prospects');
select ok((select count(*) from public.activities where prospect_id = '00000000-0000-0000-0000-00000000bb02') > 0
      and (select count(*) from public.follow_ups where prospect_id = '00000000-0000-0000-0000-00000000bb02') > 0
      and (select count(*) from public.stage_history where prospect_id = '00000000-0000-0000-0000-00000000bb02') > 0
      and (select count(*) from public.ai_insights where prospect_id = '00000000-0000-0000-0000-00000000bb02') > 0,
  'M sees the child rows of B''s prospects');
select ok(public.can_access_prospect('00000000-0000-0000-0000-00000000bb02'), 'can_access_prospect(PB) true for M');

select lives_ok(
  $$update public.prospects set owner_id = '00000000-0000-0000-0000-00000000aa03' where id = '00000000-0000-0000-0000-00000000bb01'$$,
  'M can reassign PA from A to B');
select is((select owner_id from public.prospects where id = '00000000-0000-0000-0000-00000000bb01'),
  '00000000-0000-0000-0000-00000000aa03'::uuid, 'PA is now owned by B');
select is((select owner_id from public.follow_ups where id = '00000000-0000-0000-0000-00000000cc01'),
  '00000000-0000-0000-0000-00000000aa03'::uuid, 'pending follow-up moved to B');
select is((select owner_id from public.follow_ups where id = '00000000-0000-0000-0000-00000000cc02'),
  '00000000-0000-0000-0000-00000000aa02'::uuid, 'completed follow-up keeps owner A');
select ok(exists(
  select 1 from public.activities
   where prospect_id = '00000000-0000-0000-0000-00000000bb01' and type = 'owner_change'
     and user_id = '00000000-0000-0000-0000-00000000aa01'
     and metadata = jsonb_build_object('from_owner', '00000000-0000-0000-0000-00000000aa02',
                                       'to_owner', '00000000-0000-0000-0000-00000000aa03')),
  'owner_change activity by M exists (visible to M)');
select lives_ok(
  $$insert into public.prospects (name, owner_id) values ('M for A', '00000000-0000-0000-0000-00000000aa02')$$,
  'M can create a prospect for A');
select is(pg_temp.rows_affected($$delete from public.prospects where id = '00000000-0000-0000-0000-00000000bb03'$$),
  1, 'M can delete a prospect');

reset role;
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa02');
select is((select count(*)::int from public.prospects where id = '00000000-0000-0000-0000-00000000bb01'), 0,
  'after reassignment A no longer sees PA');
reset role;
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa03');
select is((select count(*)::int from public.prospects where id = '00000000-0000-0000-0000-00000000bb01'), 1,
  'after reassignment B sees PA');
select ok(exists(select 1 from public.activities
                  where prospect_id = '00000000-0000-0000-0000-00000000bb01' and type = 'owner_change'),
  'B sees the owner_change activity');

-- ===========================================================================
-- 6. Append-only: nobody updates/deletes stage_history, activities, ai_insights
-- ===========================================================================
reset role;
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa01');
select throws_ok($$update public.stage_history set note = 'x'$$, '42501', null, 'M cannot update stage_history');
select throws_ok($$delete from public.stage_history$$, '42501', null, 'M cannot delete stage_history');
select throws_ok(
  $$insert into public.stage_history (prospect_id, to_stage) values ('00000000-0000-0000-0000-00000000bb02', 'qualified')$$,
  '42501', null, 'M cannot insert stage_history');
select throws_ok($$update public.activities set content = 'x'$$, '42501', null, 'M cannot update activities');
select throws_ok($$delete from public.activities$$, '42501', null, 'M cannot delete activities');
select throws_ok($$update public.ai_insights set summary = 'x'$$, '42501', null, 'M cannot update ai_insights');
select throws_ok($$delete from public.ai_insights$$, '42501', null, 'M cannot delete ai_insights');

reset role;
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa02');
select throws_ok($$update public.stage_history set note = 'x'$$, '42501', null, 'A cannot update stage_history');
select throws_ok($$delete from public.stage_history$$, '42501', null, 'A cannot delete stage_history');
select throws_ok($$update public.activities set content = 'x'$$, '42501', null, 'A cannot update activities');
select throws_ok($$delete from public.activities$$, '42501', null, 'A cannot delete activities');

-- ===========================================================================
-- 7. Users and roles
-- ===========================================================================
select is((select count(*)::int from public.users
            where id in ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000aa02',
                         '00000000-0000-0000-0000-00000000aa03')),
  3, 'A can list team members');
select is(pg_temp.rows_affected($$update public.users set full_name = 'Alex A' where id = '00000000-0000-0000-0000-00000000aa02'$$),
  1, 'A can update own full_name');
select is(pg_temp.rows_affected($$update public.users set full_name = 'hacked' where id = '00000000-0000-0000-0000-00000000aa03'$$),
  0, 'A cannot update B''s name');
select throws_ok(
  $$update public.users set role = 'manager' where id = '00000000-0000-0000-0000-00000000aa02'$$,
  '42501', 'Only managers can change roles', 'A cannot change their own role');
select throws_ok(
  $$update public.users set email = 'x@rls.test' where id = '00000000-0000-0000-0000-00000000aa02'$$,
  '42501', null, 'users.email is not writable via the API');
select throws_ok(
  $$insert into public.users (id, email) values (gen_random_uuid(), 'new@rls.test')$$,
  '42501', null, 'users cannot be inserted via the API');
select throws_ok(
  $$delete from public.users where id = '00000000-0000-0000-0000-00000000aa02'$$,
  '42501', null, 'users cannot be deleted via the API');

reset role;
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa01');
select throws_ok(
  $$update public.users set full_name = 'Renamed' where id = '00000000-0000-0000-0000-00000000aa03'$$,
  '42501', 'Users can only change their own name', 'M cannot rename another user');
select lives_ok(
  $$update public.users set role = 'manager' where id = '00000000-0000-0000-0000-00000000aa03'$$,
  'M can change B''s role');
reset role;
select is((select raw_app_meta_data ->> 'role' from auth.users where id = '00000000-0000-0000-0000-00000000aa03'),
  'manager', 'role change by M syncs to auth app_metadata');
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa01');
select lives_ok(
  $$update public.users set role = 'sales_rep' where id = '00000000-0000-0000-0000-00000000aa03'$$,
  'M can demote B while M remains manager');
select throws_ok(
  $$update public.users set role = 'sales_rep' where id = '00000000-0000-0000-0000-00000000aa01'$$,
  'P0001', 'At least one manager must remain', 'the last manager cannot be demoted');

-- system path (service role / GoTrue: no auth.uid()) still syncs roles
reset role;
select pg_temp.logout();
update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"manager"}'
 where id = '00000000-0000-0000-0000-00000000aa02';
select is((select role::text from public.users where id = '00000000-0000-0000-0000-00000000aa02'), 'manager',
  'auth app_metadata role change still syncs to public.users');

-- ===========================================================================
-- 8. org_settings
-- ===========================================================================
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa03');
select is((select count(*)::int from public.org_settings), 1, 'B (rep) can read org_settings');
select is(pg_temp.rows_affected($$update public.org_settings set stale_days = 30$$), 0,
  'a rep cannot update org_settings');
select throws_ok($$insert into public.org_settings (id) values (false)$$, '42501', null,
  'org_settings cannot be inserted via the API');
reset role;
select pg_temp.login_as('00000000-0000-0000-0000-00000000aa01');
select is(pg_temp.rows_affected($$update public.org_settings set stale_days = 30$$), 1,
  'a manager can update org_settings');
select throws_ok($$update public.org_settings set updated_by = null$$, '42501', null,
  'org_settings.updated_by is not writable via the API');
reset role;
select pg_temp.logout();

-- ===========================================================================
-- 9. Realtime publication
-- ===========================================================================
select ok(exists(select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'prospects'),
  'prospects is in the supabase_realtime publication');

select * from finish();
rollback;
