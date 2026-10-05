-- pgTAP tests for Prompt 10 (Follow-ups page): follow_up_bucket() incl. org-tz
-- edge cases, the follow_up_buckets view + follow_up_bucket_counts() RPC under
-- RLS, and latest_conversation_activities. Run with: npm run test:db.
-- Everything is rolled back.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(40);

create function pg_temp.login_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Shorthand for the pure function.
create function pg_temp.b(p_status text, p_due date, p_completed timestamptz, p_now timestamptz, p_tz text)
returns text language sql as $$
  select public.follow_up_bucket(p_status::public.follow_up_status, p_due, p_completed, p_now, p_tz);
$$;

-- ---------------------------------------------------------------------------
-- Shape + grants
-- ---------------------------------------------------------------------------
select has_function('public', 'follow_up_bucket',
  array['follow_up_status', 'date', 'timestamp with time zone', 'timestamp with time zone', 'text'],
  'follow_up_bucket() exists');
select has_function('public', 'follow_up_bucket_counts', array['uuid'], 'follow_up_bucket_counts() exists');
select has_view('public', 'follow_up_buckets', 'follow_up_buckets view exists');
select has_view('public', 'latest_conversation_activities', 'latest_conversation_activities view exists');
select ok(
  (select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.follow_up_buckets'::regclass),
  'follow_up_buckets is security_invoker'
);
select ok(
  (select 'security_invoker=true' = any (reloptions) from pg_class where oid = 'public.latest_conversation_activities'::regclass),
  'latest_conversation_activities is security_invoker'
);
select ok(has_table_privilege('authenticated', 'public.follow_up_buckets', 'select'), 'authenticated can select follow_up_buckets');
select ok(not has_table_privilege('anon', 'public.follow_up_buckets', 'select'), 'anon cannot select follow_up_buckets');
select ok(not has_table_privilege('anon', 'public.latest_conversation_activities', 'select'), 'anon cannot select latest_conversation_activities');
select ok(has_function_privilege('authenticated', 'public.follow_up_bucket_counts(uuid)', 'execute'), 'authenticated can call the counts RPC');
select ok(not has_function_privilege('anon', 'public.follow_up_bucket_counts(uuid)', 'execute'), 'anon cannot call the counts RPC');

-- ---------------------------------------------------------------------------
-- follow_up_bucket(): org-tz edge cases
-- ---------------------------------------------------------------------------
-- 11 pm New York on Oct 5 = 03:00 UTC on Oct 6: org today is still Oct 5.
select is(pg_temp.b('pending', '2026-10-05', null, '2026-10-06 03:00+00', 'America/New_York'), 'today',
  '11 pm NY (next day in UTC): due today (NY) is today');
select is(pg_temp.b('pending', '2026-10-06', null, '2026-10-06 03:00+00', 'America/New_York'), 'upcoming',
  '11 pm NY: due "UTC today" is still upcoming');
select is(pg_temp.b('pending', '2026-10-04', null, '2026-10-06 03:00+00', 'America/New_York'), 'overdue',
  '11 pm NY: due yesterday is overdue');
select is(pg_temp.b('pending', '2026-10-05', null, '2026-10-06 03:00+00', 'UTC'), 'overdue',
  'same instant in UTC: Oct 5 is already overdue (the org timezone decides)');
-- Honolulu (UTC-10, no DST): 09:30 UTC Oct 6 = 23:30 Oct 5 HST, while New York is on Oct 6.
select is(pg_temp.b('pending', '2026-10-05', null, '2026-10-06 09:30+00', 'Pacific/Honolulu'), 'today',
  'Honolulu 11:30 pm: due Oct 5 is today');
select is(pg_temp.b('pending', '2026-10-05', null, '2026-10-06 09:30+00', 'America/New_York'), 'overdue',
  'same instant in New York: due Oct 5 is overdue');
-- DST spring forward (Mar 8 2026, NY): EST before, EDT after.
select is(pg_temp.b('pending', '2026-03-08', null, '2026-03-08 04:30+00', 'America/New_York'), 'upcoming',
  'DST spring: 11:30 pm EST Mar 7 → Mar 8 is upcoming');
select is(pg_temp.b('pending', '2026-03-08', null, '2026-03-09 03:30+00', 'America/New_York'), 'today',
  'DST spring: 11:30 pm EDT Mar 8 (03:30 UTC Mar 9) → Mar 8 is today');
-- DST fall back (Nov 1 2026, NY): EDT before, EST after.
select is(pg_temp.b('pending', '2026-11-01', null, '2026-11-01 03:30+00', 'America/New_York'), 'upcoming',
  'DST fall: 11:30 pm EDT Oct 31 → Nov 1 is upcoming');
select is(pg_temp.b('pending', '2026-11-01', null, '2026-11-02 04:30+00', 'America/New_York'), 'today',
  'DST fall: 11:30 pm EST Nov 1 (04:30 UTC Nov 2) → Nov 1 is today');
-- Upcoming window: today+1 … today+7.
select is(pg_temp.b('pending', '2026-10-12', null, '2026-10-05 16:00+00', 'America/New_York'), 'upcoming',
  'due today + 7 is upcoming');
select is(pg_temp.b('pending', '2026-10-13', null, '2026-10-05 16:00+00', 'America/New_York'), 'later',
  'due today + 8 is later');
-- Completed window: the 30 org days ending today (today Oct 5 NY → from Sep 6).
select is(pg_temp.b('completed', '2026-09-01', '2026-09-06 04:30+00', '2026-10-06 03:00+00', 'America/New_York'), 'completed',
  'completed 00:30 am NY on today − 29 is in the window');
select is(pg_temp.b('completed', '2026-09-01', '2026-09-06 03:30+00', '2026-10-06 03:00+00', 'America/New_York'), null,
  'completed 11:30 pm NY on today − 30 (already Sep 6 in UTC) is out of the window');
select is(pg_temp.b('completed', '2020-01-01', '2026-10-05 12:00+00', '2026-10-05 16:00+00', 'America/New_York'), 'completed',
  'completed today counts regardless of the (old) due date');

-- ---------------------------------------------------------------------------
-- Setup (as postgres): M manager, A / B reps; PA (A), PB (B)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000fa01', 'm@fu.test', '{"role":"manager"}',   '{"full_name":"M"}'),
  ('00000000-0000-0000-0000-00000000fa02', 'a@fu.test', '{"role":"sales_rep"}', '{"full_name":"A"}'),
  ('00000000-0000-0000-0000-00000000fa03', 'b@fu.test', '{"role":"sales_rep"}', '{"full_name":"B"}');

insert into public.prospects (id, name, owner_id) values
  ('00000000-0000-0000-0000-0000000fb001', 'PA', '00000000-0000-0000-0000-00000000fa02'),
  ('00000000-0000-0000-0000-0000000fb002', 'PB', '00000000-0000-0000-0000-00000000fa03');

insert into public.follow_ups (prospect_id, owner_id, due_date, note, status, completed_at) values
  ('00000000-0000-0000-0000-0000000fb001', '00000000-0000-0000-0000-00000000fa02', public.org_today() - 2,  'a overdue',  'pending', null),
  ('00000000-0000-0000-0000-0000000fb001', '00000000-0000-0000-0000-00000000fa02', public.org_today(),      'a today',    'pending', null),
  ('00000000-0000-0000-0000-0000000fb001', '00000000-0000-0000-0000-00000000fa02', public.org_today() + 3,  'a upcoming', 'pending', null),
  ('00000000-0000-0000-0000-0000000fb001', '00000000-0000-0000-0000-00000000fa02', public.org_today() + 10, 'a later',    'pending', null),
  ('00000000-0000-0000-0000-0000000fb001', '00000000-0000-0000-0000-00000000fa02', public.org_today() - 5,  'a done',     'completed', now()),
  ('00000000-0000-0000-0000-0000000fb001', '00000000-0000-0000-0000-00000000fa02', public.org_today() - 50, 'a old done', 'completed', now() - interval '40 days'),
  ('00000000-0000-0000-0000-0000000fb002', '00000000-0000-0000-0000-00000000fa03', public.org_today() - 1,  'b overdue',  'pending', null);

-- PA activities: note (older), call (newer, long), then newer rows that must be ignored.
insert into public.activities (prospect_id, type, content, occurred_at) values
  ('00000000-0000-0000-0000-0000000fb001', 'note',         'older note',          now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000fb001', 'call',         repeat('x', 300),      now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000fb001', 'conversation', '   ',                 now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000fb001', 'follow_up',    'completed follow-up', now() - interval '1 hour');

-- ---------------------------------------------------------------------------
-- View + RPC under RLS
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-00000000fa02');
select results_eq(
  $$ select note, bucket from public.follow_up_buckets
      where prospect_id in ('00000000-0000-0000-0000-0000000fb001', '00000000-0000-0000-0000-0000000fb002')
      order by note $$,
  $$ values ('a done', 'completed'), ('a later', 'later'), ('a overdue', 'overdue'), ('a today', 'today'), ('a upcoming', 'upcoming') $$,
  'rep A: own follow-ups bucketed; completed > 30 days ago excluded; none of B''s'
);
select results_eq(
  $$ select overdue, today, upcoming, completed from public.follow_up_bucket_counts() $$,
  $$ values (1, 1, 1, 1) $$,
  'rep A: counts over everything visible (own only)'
);
select results_eq(
  $$ select overdue, today, upcoming, completed from public.follow_up_bucket_counts('00000000-0000-0000-0000-00000000fa03') $$,
  $$ values (0, 0, 0, 0) $$,
  'rep A: asking for rep B''s counts returns zeros (RLS)'
);
select results_eq(
  $$ select snippet = repeat('x', 280), content_length, type::text from public.latest_conversation_activities
      where prospect_id = '00000000-0000-0000-0000-0000000fb001' $$,
  $$ values (true, 300, 'call') $$,
  'latest conversation = newest call/conversation/note with content (blank + follow_up ignored), snippet 280 chars'
);
reset role;

select pg_temp.login_as('00000000-0000-0000-0000-00000000fa03');
select results_eq(
  $$ select overdue, today, upcoming, completed from public.follow_up_bucket_counts() $$,
  $$ values (1, 0, 0, 0) $$,
  'rep B: own counts only'
);
select is_empty(
  $$ select 1 from public.follow_up_buckets where prospect_id = '00000000-0000-0000-0000-0000000fb001' $$,
  'rep B cannot see rep A''s follow-ups through the view'
);
select is_empty(
  $$ select 1 from public.latest_conversation_activities where prospect_id = '00000000-0000-0000-0000-0000000fb001' $$,
  'rep B cannot see rep A''s latest conversation'
);
reset role;

select pg_temp.login_as('00000000-0000-0000-0000-00000000fa01');
select results_eq(
  $$ select overdue, today, upcoming, completed from public.follow_up_bucket_counts('00000000-0000-0000-0000-00000000fa02') $$,
  $$ values (1, 1, 1, 1) $$,
  'manager: rep A''s counts'
);
select results_eq(
  $$ select overdue, today, upcoming, completed from public.follow_up_bucket_counts('00000000-0000-0000-0000-00000000fa03') $$,
  $$ values (1, 0, 0, 0) $$,
  'manager: rep B''s counts'
);
select results_eq(
  $$ select count(*)::int from public.follow_up_buckets
      where prospect_id in ('00000000-0000-0000-0000-0000000fb001', '00000000-0000-0000-0000-0000000fb002') $$,
  $$ values (6) $$,
  'manager sees every rep''s follow-ups in the view'
);
select results_eq(
  $$ select overdue, today, upcoming, completed from public.follow_up_bucket_counts('00000000-0000-0000-0000-00000000fa01') $$,
  $$ values (0, 0, 0, 0) $$,
  'manager''s own counts (badge) exclude the reps'' follow-ups'
);
reset role;

-- Counts and view rows use the same definition.
select pg_temp.login_as('00000000-0000-0000-0000-00000000fa01');
select results_eq(
  $$ select
       (select count(*)::int from public.follow_up_buckets where bucket = 'overdue'),
       (select count(*)::int from public.follow_up_buckets where bucket = 'today'),
       (select count(*)::int from public.follow_up_buckets where bucket = 'upcoming'),
       (select count(*)::int from public.follow_up_buckets where bucket = 'completed') $$,
  $$ select overdue, today, upcoming, completed from public.follow_up_bucket_counts() $$,
  'RPC counts = number of view rows per bucket'
);
reset role;

-- The view uses the org timezone from org_settings.
update public.org_settings set timezone = 'Pacific/Honolulu' where id;
select is(
  (select bucket from public.follow_up_buckets where note = 'a today'),
  (select public.follow_up_bucket(f.status, f.due_date, f.completed_at, now(), 'Pacific/Honolulu')
     from public.follow_ups f where f.note = 'a today'),
  'view buckets with the current org timezone'
);
select is(
  (select public.org_today() = (now() at time zone 'Pacific/Honolulu')::date),
  true,
  'org_today() follows the org timezone'
);

select * from finish();
rollback;
