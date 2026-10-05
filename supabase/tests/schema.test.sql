-- pgTAP tests for the Prompt 1 schema (enums, constraints, triggers, view).
-- Run with: npm run test:db   (= npx supabase test db; local Supabase must be running)
-- Everything runs in one transaction and is rolled back.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(113);

-- Act as a user (simulates auth.uid()); null = system/seed write.
create function pg_temp.act_as(p_user uuid) returns void
language sql as $$
  select set_config(
    'request.jwt.claims',
    case when p_user is null then '' else json_build_object('sub', p_user, 'role', 'authenticated')::text end,
    true
  );
$$;

-- Fixed ids
-- M  = manager, A / B = sales reps, X = tries to self-promote via user metadata,
-- Y  = invalid app role
-- P1..P7 = prospects

-- ===========================================================================
-- 1. Enums, tables, view
-- ===========================================================================
select enum_has_labels('public', 'pipeline_stage',
  array['prospect','contacted','conversation','qualified','demo_booked','demo_attended','follow_up','closed_won','closed_lost'],
  'pipeline_stage has the SPEC values in order');
select enum_has_labels('public', 'decision_maker_status', array['yes','no','unknown'],
  'decision_maker_status values');
select enum_has_labels('public', 'objection_category',
  array['price','timing','competitor','budget','no_authority','not_interested','other'],
  'objection_category values');
select enum_has_labels('public', 'activity_type',
  array['call','conversation','note','demo','follow_up','stage_change','owner_change','ai_insight'],
  'activity_type values');
select enum_has_labels('public', 'follow_up_status', array['pending','completed'], 'follow_up_status values');
select enum_has_labels('public', 'deal_health', array['high','medium','low'], 'deal_health values');
select enum_has_labels('public', 'user_role', array['manager','sales_rep'], 'user_role values');

select tables_are('public',
  array['org_settings','users','prospects','activities','follow_ups','stage_history','ai_insights'],
  'public has exactly the 7 CRM tables');
select has_view('public', 'prospects_with_flags', 'prospects_with_flags view exists');

-- ===========================================================================
-- 2. org_settings
-- ===========================================================================
select results_eq(
  $$select default_currency::text, timezone, stale_days from public.org_settings$$,
  $$values ('USD'::text, 'America/New_York'::text, 14)$$,
  'default org_settings row (USD, America/New_York, 14)');
select throws_ok($$update public.org_settings set default_currency = 'usd'$$, '23514', null,
  'lowercase currency rejected');
select throws_ok($$update public.org_settings set timezone = 'Europe/London'$$, '23514', null,
  'non-US timezone rejected');
select throws_ok($$update public.org_settings set stale_days = 0$$, '23514', null, 'stale_days 0 rejected');
select throws_ok($$update public.org_settings set stale_days = 366$$, '23514', null, 'stale_days 366 rejected');
select throws_ok($$insert into public.org_settings (id) values (false)$$, '23514', null,
  'a second org_settings row is rejected');

-- ===========================================================================
-- 3. org_today()
-- ===========================================================================
select is(public.org_today(), (now() at time zone 'America/New_York')::date,
  'org_today() = today in America/New_York');
update public.org_settings set timezone = 'Pacific/Honolulu';
select is(public.org_today(), (now() at time zone 'Pacific/Honolulu')::date,
  'org_today() follows the org timezone (Honolulu)');
update public.org_settings set timezone = 'America/New_York';

-- ===========================================================================
-- 4. Users: handle_new_user, role sync
-- ===========================================================================
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'mia@example.com',  '{"role":"manager"}',   '{"full_name":"Mia Manager"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'alex@example.com', '{"role":"sales_rep"}', '{"full_name":"Alex Rep"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'bea@example.com',  '{}',                   '{}'),
  ('00000000-0000-0000-0000-0000000000c1', 'xav@example.com',  '{}',                   '{"full_name":"Xav","role":"manager"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'yan@example.com',  '{"role":"admin"}',     '{"full_name":"Yan"}');

select results_eq(
  $$select role::text, full_name, email from public.users where id = '00000000-0000-0000-0000-0000000000a1'$$,
  $$values ('manager'::text, 'Mia Manager'::text, 'mia@example.com'::text)$$,
  'handle_new_user: manager role from raw_app_meta_data, full_name from user metadata');
select is((select role::text from public.users where id = '00000000-0000-0000-0000-0000000000b1'), 'sales_rep',
  'handle_new_user: sales_rep from raw_app_meta_data');
select results_eq(
  $$select role::text, full_name from public.users where id = '00000000-0000-0000-0000-0000000000b2'$$,
  $$values ('sales_rep'::text, 'bea'::text)$$,
  'handle_new_user: default role sales_rep, full_name falls back to email local part');
select is((select role::text from public.users where id = '00000000-0000-0000-0000-0000000000c1'), 'sales_rep',
  'handle_new_user ignores role in raw_user_meta_data');
select is((select role::text from public.users where id = '00000000-0000-0000-0000-0000000000c2'), 'sales_rep',
  'handle_new_user: invalid app role falls back to sales_rep');

update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"manager"}'
 where id = '00000000-0000-0000-0000-0000000000c1';
select is((select role::text from public.users where id = '00000000-0000-0000-0000-0000000000c1'), 'manager',
  'app_metadata.role change syncs to public.users');

update public.users set role = 'sales_rep' where id = '00000000-0000-0000-0000-0000000000c1';
select is((select raw_app_meta_data ->> 'role' from auth.users where id = '00000000-0000-0000-0000-0000000000c1'),
  'sales_rep', 'public.users.role change syncs to auth app_metadata');

update auth.users set email = 'bea.new@example.com' where id = '00000000-0000-0000-0000-0000000000b2';
select is((select email from public.users where id = '00000000-0000-0000-0000-0000000000b2'),
  'bea.new@example.com', 'auth email change syncs to public.users');

-- is_manager()
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select ok(public.is_manager(), 'is_manager() true for a manager');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select ok(not public.is_manager(), 'is_manager() false for a sales rep');
select pg_temp.act_as(null);
select ok(not public.is_manager(), 'is_manager() false without a user');

-- ===========================================================================
-- 5. Last manager
-- ===========================================================================
select throws_ok(
  $$update public.users set role = 'sales_rep' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', 'At least one manager must remain', 'cannot demote the last manager');
select throws_ok(
  $$delete from public.users where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', 'At least one manager must remain', 'cannot delete the last manager');
select throws_ok(
  $$delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'P0001', 'At least one manager must remain', 'cannot delete the last manager via auth.users cascade');
update public.users set role = 'manager' where id = '00000000-0000-0000-0000-0000000000c2';
select lives_ok(
  $$update public.users set role = 'sales_rep' where id = '00000000-0000-0000-0000-0000000000c2'$$,
  'demoting a manager is fine while another manager exists');
select is((select count(*)::int from public.users where role = 'manager'), 1, 'exactly one manager left');

-- ===========================================================================
-- 6. prospects BEFORE/AFTER INSERT
-- ===========================================================================
update public.org_settings set default_currency = 'EUR';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
insert into public.prospects (id, name) values ('00000000-0000-0000-0000-0000000000d1', 'Acme lead');

select results_eq(
  $$select currency::text, owner_id, created_by, stage::text from public.prospects
     where id = '00000000-0000-0000-0000-0000000000d1'$$,
  $$values ('EUR'::text, '00000000-0000-0000-0000-0000000000b1'::uuid,
            '00000000-0000-0000-0000-0000000000b1'::uuid, 'prospect'::text)$$,
  'insert: currency from org default, owner_id and created_by = auth.uid(), stage prospect');
select results_eq(
  $$select from_stage::text, to_stage::text, changed_by from public.stage_history
     where prospect_id = '00000000-0000-0000-0000-0000000000d1'$$,
  $$values (null::text, 'prospect'::text, '00000000-0000-0000-0000-0000000000b1'::uuid)$$,
  'insert creates stage_history null -> prospect by the creator');

insert into public.prospects (id, name, currency) values ('00000000-0000-0000-0000-0000000000d7', 'Pound Co', 'GBP');
select is((select currency::text from public.prospects where id = '00000000-0000-0000-0000-0000000000d7'), 'GBP',
  'explicit currency is kept');
select throws_ok($$insert into public.prospects (name) values ('   ')$$, '23514', null, 'blank name rejected');
select throws_ok($$insert into public.prospects (name, deal_value) values ('Neg', -1)$$, '23514', null,
  'negative deal_value rejected');

select pg_temp.act_as(null);
update public.org_settings set default_currency = 'USD';
select throws_ok($$insert into public.prospects (name) values ('Orphan')$$, '23502', null,
  'system insert without owner_id fails (no auth.uid())');

-- ===========================================================================
-- 7/8. Stage changes, close_reason CHECK, reopen (P1, as rep A)
-- ===========================================================================
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');

update public.prospects set stage = 'contacted' where id = '00000000-0000-0000-0000-0000000000d1';
select results_eq(
  $$select from_stage::text, to_stage::text, changed_by, close_reason, note from public.stage_history
     where prospect_id = '00000000-0000-0000-0000-0000000000d1' and from_stage is not null$$,
  $$values ('prospect'::text, 'contacted'::text, '00000000-0000-0000-0000-0000000000b1'::uuid, null::text, null::text)$$,
  'update: stage_history prospect -> contacted by auth.uid()');
select ok(exists(
  select 1 from public.activities
   where prospect_id = '00000000-0000-0000-0000-0000000000d1'
     and type = 'stage_change'
     and user_id = '00000000-0000-0000-0000-0000000000b1'
     and metadata = '{"from":"prospect","to":"contacted","close_reason":null}'::jsonb),
  'update: stage_change activity with {from,to,close_reason}');

update public.prospects set stage = 'demo_booked' where id = '00000000-0000-0000-0000-0000000000d1';
update public.prospects set stage = 'conversation' where id = '00000000-0000-0000-0000-0000000000d1';
select ok(exists(select 1 from public.stage_history where prospect_id = '00000000-0000-0000-0000-0000000000d1'
                   and from_stage = 'contacted' and to_stage = 'demo_booked'), 'skipped stages are recorded');
select ok(exists(select 1 from public.stage_history where prospect_id = '00000000-0000-0000-0000-0000000000d1'
                   and from_stage = 'demo_booked' and to_stage = 'conversation'), 'backward move is recorded');

update public.prospects set notes = 'Talked about pricing' where id = '00000000-0000-0000-0000-0000000000d1';
select is((select count(*)::int from public.stage_history where prospect_id = '00000000-0000-0000-0000-0000000000d1'), 4,
  'a non-stage update adds no stage_history');
select is((select count(*)::int from public.activities where prospect_id = '00000000-0000-0000-0000-0000000000d1'
            and type = 'stage_change'), 3, 'one stage_change activity per stage change');

-- close_reason CHECK
select throws_ok(
  $$update public.prospects set stage = 'closed_won', close_reason = 'no_budget' where id = '00000000-0000-0000-0000-0000000000d1'$$,
  '23514', null, 'closed_won with a lost-only reason is rejected');
select throws_ok(
  $$update public.prospects set stage = 'closed_won' where id = '00000000-0000-0000-0000-0000000000d1'$$,
  '23514', null, 'closed_won without a reason is rejected');
select throws_ok(
  $$update public.prospects set stage = 'closed_lost' where id = '00000000-0000-0000-0000-0000000000d1'$$,
  '23514', null, 'closed_lost without a reason is rejected');
select throws_ok(
  $$update public.prospects set stage = 'closed_lost', close_reason = 'product_fit' where id = '00000000-0000-0000-0000-0000000000d1'$$,
  '23514', null, 'closed_lost with a won-only reason is rejected');
select throws_ok(
  $$update public.prospects set close_reason = 'price' where id = '00000000-0000-0000-0000-0000000000d1'$$,
  '23514', null, 'an open stage cannot have a close_reason');
select throws_ok(
  $$update public.prospects set close_notes = 'x' where id = '00000000-0000-0000-0000-0000000000d1'$$,
  '23514', null, 'an open stage cannot have close_notes');

select lives_ok(
  $$update public.prospects set stage = 'closed_lost', close_reason = 'no_budget', close_notes = 'Budget frozen'
     where id = '00000000-0000-0000-0000-0000000000d1'$$,
  'closed_lost with a lost reason is accepted');
select results_eq(
  $$select close_reason, close_notes, closed_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d1'$$,
  $$values ('no_budget'::text, 'Budget frozen'::text, now())$$,
  'closing sets closed_at = now() and keeps reason + notes');
select ok(exists(select 1 from public.stage_history where prospect_id = '00000000-0000-0000-0000-0000000000d1'
                   and to_stage = 'closed_lost' and close_reason = 'no_budget'),
  'stage_history records the close_reason');
select ok(exists(select 1 from public.activities where prospect_id = '00000000-0000-0000-0000-0000000000d1'
                   and type = 'stage_change' and metadata ->> 'close_reason' = 'no_budget'),
  'stage_change activity metadata has the close_reason');

-- reopen
select lives_ok(
  $$update public.prospects set stage = 'qualified' where id = '00000000-0000-0000-0000-0000000000d1'$$,
  'reopening with only a stage change passes the CHECK');
select results_eq(
  $$select close_reason, close_notes, closed_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d1'$$,
  $$values (null::text, null::text, null::timestamptz)$$,
  'reopen clears close_reason, close_notes and closed_at');
select results_eq(
  $$select from_stage::text, close_reason from public.stage_history
     where prospect_id = '00000000-0000-0000-0000-0000000000d1' and to_stage = 'qualified'$$,
  $$values ('closed_lost'::text, null::text)$$,
  'reopen is recorded closed_lost -> qualified');
select is((select count(*)::int from public.stage_history where prospect_id = '00000000-0000-0000-0000-0000000000d1'
            and close_reason = 'no_budget'), 1, 'history keeps the old close_reason after reopen');

-- move_prospect_stage RPC (note)
select is((public.move_prospect_stage('00000000-0000-0000-0000-0000000000d1', 'closed_won', 'product_fit', ' Signed ', 'Signed after demo')).stage::text,
  'closed_won', 'move_prospect_stage returns the updated row');
select results_eq(
  $$select close_reason, note, changed_by from public.stage_history
     where prospect_id = '00000000-0000-0000-0000-0000000000d1' and to_stage = 'closed_won'$$,
  $$values ('product_fit'::text, 'Signed after demo'::text, '00000000-0000-0000-0000-0000000000b1'::uuid)$$,
  'move_prospect_stage records close_reason and note in stage_history');
select is((select close_notes from public.prospects where id = '00000000-0000-0000-0000-0000000000d1'), 'Signed',
  'move_prospect_stage stores trimmed close_notes');
select ok(exists(select 1 from public.activities where prospect_id = '00000000-0000-0000-0000-0000000000d1'
                   and type = 'stage_change' and content = 'Signed after demo'),
  'the note becomes the stage_change activity content');
select lives_ok(
  $$select public.move_prospect_stage('00000000-0000-0000-0000-0000000000d1', 'closed_won', 'other')$$,
  'same-stage move is accepted');
select is((select count(*)::int from public.stage_history where prospect_id = '00000000-0000-0000-0000-0000000000d1'), 7,
  'same-stage move is a no-op (no history)');
select is(current_setting('app.stage_change_note', true), '', 'the note setting is reset after the RPC');
select results_eq(
  $$select (public.move_prospect_stage('00000000-0000-0000-0000-0000000000d1', 'follow_up', 'price', 'x', null)).close_reason$$,
  $$values (null::text)$$,
  'move_prospect_stage to an open stage ignores close fields');
select throws_ok(
  $$select public.move_prospect_stage('00000000-0000-0000-0000-00000000ffff', 'contacted')$$,
  'P0002', 'Prospect not found', 'move_prospect_stage on a missing prospect raises P0002');

-- insert directly into a closed stage (seed path)
insert into public.prospects (id, name, stage, close_reason)
values ('00000000-0000-0000-0000-0000000000d2', 'Won Co', 'closed_won', 'relationship');
select ok((select closed_at is not null from public.prospects where id = '00000000-0000-0000-0000-0000000000d2'),
  'insert into a closed stage sets closed_at');
select results_eq(
  $$select from_stage::text, to_stage::text, close_reason from public.stage_history
     where prospect_id = '00000000-0000-0000-0000-0000000000d2'$$,
  $$values (null::text, 'closed_won'::text, 'relationship'::text)$$,
  'insert into a closed stage records the close_reason in history');

-- system update: changed_by null
select pg_temp.act_as(null);
update public.prospects set stage = 'contacted' where id = '00000000-0000-0000-0000-0000000000d7';
select ok(exists(select 1 from public.stage_history where prospect_id = '00000000-0000-0000-0000-0000000000d7'
                   and to_stage = 'contacted' and changed_by is null), 'system stage change has changed_by null');

-- ===========================================================================
-- 11. Owner change (P3)
-- ===========================================================================
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
insert into public.prospects (id, name) values ('00000000-0000-0000-0000-0000000000d3', 'Reassign Inc');
insert into public.follow_ups (id, prospect_id, due_date, note) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d3', current_date + 3, 'Call back');
insert into public.follow_ups (id, prospect_id, due_date, note, status, completed_at, completed_by) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d3', current_date - 3, 'Intro call',
   'completed', now(), '00000000-0000-0000-0000-0000000000b1');
select is((select owner_id from public.follow_ups where id = '00000000-0000-0000-0000-0000000000e1'),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'follow-up owner defaults to the prospect owner');
select is((select created_by from public.follow_ups where id = '00000000-0000-0000-0000-0000000000e1'),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'follow-up created_by = auth.uid()');

update public.prospects set last_activity_at = now() - interval '5 days' where id = '00000000-0000-0000-0000-0000000000d3';

select throws_ok(
  $$update public.prospects set owner_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-0000000000d3'$$,
  '42501', 'Only managers can reassign prospects', 'a rep cannot change owner_id');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$update public.prospects set owner_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-0000000000d3'$$,
  'a manager can reassign');
select ok(exists(
  select 1 from public.activities
   where prospect_id = '00000000-0000-0000-0000-0000000000d3'
     and type = 'owner_change'
     and user_id = '00000000-0000-0000-0000-0000000000a1'
     and metadata = jsonb_build_object('from_owner', '00000000-0000-0000-0000-0000000000b1',
                                       'to_owner', '00000000-0000-0000-0000-0000000000b2')),
  'owner_change activity with {from_owner,to_owner}');
select is((select owner_id from public.follow_ups where id = '00000000-0000-0000-0000-0000000000e1'),
  '00000000-0000-0000-0000-0000000000b2'::uuid, 'pending follow-ups move to the new owner');
select is((select owner_id from public.follow_ups where id = '00000000-0000-0000-0000-0000000000e2'),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'completed follow-ups keep their owner');
select is((select last_activity_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d3'),
  now() - interval '5 days', 'owner_change does not touch last_activity_at');
select is((select count(*)::int from public.stage_history where prospect_id = '00000000-0000-0000-0000-0000000000d3'), 1,
  'reassignment adds no stage_history');

select pg_temp.act_as(null);
select lives_ok(
  $$update public.prospects set owner_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000000d3'$$,
  'system (no auth.uid()) can reassign');

-- ===========================================================================
-- 12. follow_up_date derivation (P4)
-- ===========================================================================
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
insert into public.prospects (id, name) values ('00000000-0000-0000-0000-0000000000d4', 'Follow Co');
select is((select follow_up_date from public.prospects where id = '00000000-0000-0000-0000-0000000000d4'), null::date,
  'no follow-ups -> follow_up_date null');

insert into public.follow_ups (id, prospect_id, due_date, note) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d4', current_date + 10, 'Later');
select is((select follow_up_date from public.prospects where id = '00000000-0000-0000-0000-0000000000d4'), current_date + 10,
  'one pending follow-up -> its due date');
insert into public.follow_ups (id, prospect_id, due_date, note) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d4', current_date + 5, 'Sooner');
select is((select follow_up_date from public.prospects where id = '00000000-0000-0000-0000-0000000000d4'), current_date + 5,
  'earliest pending due date wins');

update public.follow_ups set status = 'completed', completed_at = now(), completed_by = '00000000-0000-0000-0000-0000000000b1'
 where id = '00000000-0000-0000-0000-0000000000f2';
select is((select follow_up_date from public.prospects where id = '00000000-0000-0000-0000-0000000000d4'), current_date + 10,
  'completing the earliest -> next pending due date');

update public.follow_ups set due_date = current_date + 7 where id = '00000000-0000-0000-0000-0000000000f1';
select is((select follow_up_date from public.prospects where id = '00000000-0000-0000-0000-0000000000d4'), current_date + 7,
  'rescheduling updates follow_up_date');

update public.follow_ups set status = 'pending', completed_at = null, completed_by = null
 where id = '00000000-0000-0000-0000-0000000000f2';
select is((select follow_up_date from public.prospects where id = '00000000-0000-0000-0000-0000000000d4'), current_date + 5,
  'reopening a completed follow-up counts again');

update public.prospects set follow_up_date = '2000-01-01' where id = '00000000-0000-0000-0000-0000000000d4';
select is((select follow_up_date from public.prospects where id = '00000000-0000-0000-0000-0000000000d4'), current_date + 5,
  'follow_up_date cannot be edited directly');

delete from public.follow_ups where prospect_id = '00000000-0000-0000-0000-0000000000d4';
select is((select follow_up_date from public.prospects where id = '00000000-0000-0000-0000-0000000000d4'), null::date,
  'deleting all follow-ups -> null');

select throws_ok(
  $$insert into public.follow_ups (prospect_id, due_date, note, status)
    values ('00000000-0000-0000-0000-0000000000d4', current_date, 'x', 'completed')$$,
  '23514', null, 'completed follow-up without completed_at is rejected');
select throws_ok(
  $$insert into public.follow_ups (prospect_id, due_date, note, completed_at)
    values ('00000000-0000-0000-0000-0000000000d4', current_date, 'x', now())$$,
  '23514', null, 'pending follow-up with completed_at is rejected');

-- ===========================================================================
-- 13. last_activity_at (P5)
-- ===========================================================================
insert into public.prospects (id, name) values ('00000000-0000-0000-0000-0000000000d5', 'Activity Co');
update public.prospects set last_activity_at = now() - interval '20 days' where id = '00000000-0000-0000-0000-0000000000d5';

insert into public.activities (prospect_id, type, content) values
  ('00000000-0000-0000-0000-0000000000d5', 'ai_insight', 'AI summary');
select is((select last_activity_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d5'),
  now() - interval '20 days', 'ai_insight activity does not update last_activity_at');

insert into public.activities (prospect_id, type) values ('00000000-0000-0000-0000-0000000000d5', 'owner_change');
select is((select last_activity_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d5'),
  now() - interval '20 days', 'owner_change activity does not update last_activity_at');

insert into public.ai_insights (prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model)
values ('00000000-0000-0000-0000-0000000000d5', 's', 'unknown', 'price', 'call', 'medium', 'test-model');
select is((select last_activity_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d5'),
  now() - interval '20 days', 'inserting an ai_insights row does not update last_activity_at');
select is((select created_by from public.ai_insights where prospect_id = '00000000-0000-0000-0000-0000000000d5'),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'ai_insights.created_by defaults to auth.uid()');

insert into public.activities (prospect_id, type, occurred_at) values
  ('00000000-0000-0000-0000-0000000000d5', 'call', now() - interval '30 days');
select is((select last_activity_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d5'),
  now() - interval '20 days', 'a back-dated call never moves last_activity_at backwards');

insert into public.activities (prospect_id, type, occurred_at) values
  ('00000000-0000-0000-0000-0000000000d5', 'call', now() - interval '2 days');
select is((select last_activity_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d5'),
  now() - interval '2 days', 'a call moves last_activity_at forward to occurred_at');
select is((select user_id from public.activities where prospect_id = '00000000-0000-0000-0000-0000000000d5' and type = 'call'
            order by occurred_at desc limit 1),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'activities.user_id defaults to auth.uid()');

insert into public.activities (prospect_id, type, occurred_at) values
  ('00000000-0000-0000-0000-0000000000d5', 'note', now() + interval '1 day');
select is((select last_activity_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d5'),
  now(), 'a future occurred_at is clamped to now()');

update public.prospects set last_activity_at = now() - interval '20 days' where id = '00000000-0000-0000-0000-0000000000d5';
insert into public.activities (prospect_id, type, occurred_at) values
  ('00000000-0000-0000-0000-0000000000d5', 'conversation', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000d5', 'demo', now() - interval '3 days');
select is((select last_activity_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d5'),
  now() - interval '1 day', 'conversation/demo update last_activity_at (max wins)');

update public.prospects set last_activity_at = now() - interval '20 days' where id = '00000000-0000-0000-0000-0000000000d5';
insert into public.activities (prospect_id, type) values ('00000000-0000-0000-0000-0000000000d5', 'follow_up');
select is((select last_activity_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d5'),
  now(), 'follow_up activity updates last_activity_at');

update public.prospects set last_activity_at = now() - interval '20 days' where id = '00000000-0000-0000-0000-0000000000d5';
update public.prospects set stage = 'contacted' where id = '00000000-0000-0000-0000-0000000000d5';
select is((select last_activity_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d5'),
  now(), 'a stage change updates last_activity_at');

-- ===========================================================================
-- 14. prospects_with_flags (P6)
-- ===========================================================================
insert into public.prospects (id, name) values ('00000000-0000-0000-0000-0000000000d6', 'Flag Co');
select results_eq(
  $$select is_stale, has_overdue_follow_up from public.prospects_with_flags where id = '00000000-0000-0000-0000-0000000000d6'$$,
  $$values (false, false)$$, 'fresh prospect: not stale, no overdue follow-up');

update public.prospects set last_activity_at = now() - interval '15 days' where id = '00000000-0000-0000-0000-0000000000d6';
select ok((select is_stale from public.prospects_with_flags where id = '00000000-0000-0000-0000-0000000000d6'),
  'no activity for > stale_days (14) -> stale');

update public.prospects set last_activity_at = now() - interval '13 days' where id = '00000000-0000-0000-0000-0000000000d6';
select ok(not (select is_stale from public.prospects_with_flags where id = '00000000-0000-0000-0000-0000000000d6'),
  '13 days without activity -> not stale');

update public.org_settings set stale_days = 7;
select ok((select is_stale from public.prospects_with_flags where id = '00000000-0000-0000-0000-0000000000d6'),
  'is_stale follows org stale_days');
update public.org_settings set stale_days = 14;

update public.prospects set last_activity_at = now() - interval '30 days' where id = '00000000-0000-0000-0000-0000000000d2';
select ok(not (select is_stale from public.prospects_with_flags where id = '00000000-0000-0000-0000-0000000000d2'),
  'closed prospects are never stale');

insert into public.follow_ups (prospect_id, due_date, note) values
  ('00000000-0000-0000-0000-0000000000d6', public.org_today(), 'Today');
select ok(not (select has_overdue_follow_up from public.prospects_with_flags where id = '00000000-0000-0000-0000-0000000000d6'),
  'a follow-up due today (org tz) is not overdue');
insert into public.follow_ups (prospect_id, due_date, note) values
  ('00000000-0000-0000-0000-0000000000d6', public.org_today() - 1, 'Yesterday');
select ok((select has_overdue_follow_up from public.prospects_with_flags where id = '00000000-0000-0000-0000-0000000000d6'),
  'a pending follow-up due before org_today() -> overdue');
update public.follow_ups set status = 'completed', completed_at = now()
 where prospect_id = '00000000-0000-0000-0000-0000000000d6' and note = 'Yesterday';
select ok(not (select has_overdue_follow_up from public.prospects_with_flags where id = '00000000-0000-0000-0000-0000000000d6'),
  'completed overdue follow-ups do not count');

-- ===========================================================================
-- 15. updated_at / created_at
-- ===========================================================================
insert into public.prospects (id, name, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000d8', 'Timestamps Co', now() - interval '2 days', now() - interval '2 days');
update public.prospects set company = 'TS Inc', created_at = now() where id = '00000000-0000-0000-0000-0000000000d8';
select results_eq(
  $$select created_at, updated_at from public.prospects where id = '00000000-0000-0000-0000-0000000000d8'$$,
  $$values (now() - interval '2 days', now())$$,
  'updated_at is bumped on update; created_at is immutable');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
update public.org_settings set stale_days = 21;
select results_eq(
  $$select updated_by, updated_at from public.org_settings$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid, now())$$,
  'org_settings update records updated_by and updated_at');

-- ===========================================================================
-- Cascade: deleting a prospect removes child rows
-- ===========================================================================
delete from public.prospects where id = '00000000-0000-0000-0000-0000000000d5';
select is((select count(*)::int from public.activities where prospect_id = '00000000-0000-0000-0000-0000000000d5')
        + (select count(*)::int from public.stage_history where prospect_id = '00000000-0000-0000-0000-0000000000d5')
        + (select count(*)::int from public.ai_insights where prospect_id = '00000000-0000-0000-0000-0000000000d5'),
  0, 'deleting a prospect cascades to activities, stage_history, ai_insights');

select * from finish();
rollback;
