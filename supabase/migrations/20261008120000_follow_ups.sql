-- Prompt 10 (Follow-ups page): one bucketing definition for the follow-up tabs
-- and their counts, plus the latest conversation snippet per prospect.
--
-- Single source of truth: follow_up_bucket() decides the tab of a follow-up
-- relative to the org "today" (SPEC §6/§8). The follow_up_buckets view applies
-- it with now() + the org timezone, and both the tab lists and the counts RPC
-- read that view, so counts and contents can never disagree.
-- TS mirror (parity-tested): followUpViewBucket() in src/lib/time.ts.

-- ---------------------------------------------------------------------------
-- follow_up_bucket(): pure; `now` and the timezone are explicit so the org-tz
-- edge cases (11 pm New York = next day UTC, DST, Honolulu) are testable.
--   pending:   due < today → overdue · = today → today · ≤ today + 7 → upcoming · else later
--   completed: org-tz date of completed_at within the 30 org calendar days
--              ending today (≥ today − 29) → completed · else null
-- ---------------------------------------------------------------------------
create function public.follow_up_bucket(
  p_status public.follow_up_status,
  p_due_date date,
  p_completed_at timestamptz,
  p_now timestamptz,
  p_timezone text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status = 'pending' then
      case
        when p_due_date < t.today then 'overdue'
        when p_due_date = t.today then 'today'
        when p_due_date <= t.today + 7 then 'upcoming'
        else 'later'
      end
    when p_completed_at is not null
      and (p_completed_at at time zone p_timezone)::date >= t.today - 29 then 'completed'
    else null
  end
  from (select (p_now at time zone p_timezone)::date as today) t;
$$;

comment on function public.follow_up_bucket(public.follow_up_status, date, timestamptz, timestamptz, text) is
  'Follow-ups page tab of a follow-up relative to the org-local date of p_now: overdue/today/upcoming (≤ today+7)/later for pending, completed (last 30 org days) or null. Mirror: followUpViewBucket() in src/lib/time.ts.';

revoke execute on function public.follow_up_bucket(public.follow_up_status, date, timestamptz, timestamptz, text)
  from public, anon;
grant execute on function public.follow_up_bucket(public.follow_up_status, date, timestamptz, timestamptz, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- follow_up_buckets: follow-ups + their bucket (security_invoker → follow_ups
-- RLS: reps see their own prospects' rows, managers everything). Old completed
-- rows are filtered out before bucketing (the function makes the exact cut).
-- Selects f.*, so recreate it when follow_ups gains columns.
-- ---------------------------------------------------------------------------
create view public.follow_up_buckets
with (security_invoker = true)
as
select
  f.*,
  public.follow_up_bucket(f.status, f.due_date, f.completed_at, now(), s.timezone) as bucket
from public.follow_ups f
left join public.org_settings s on s.id
where f.status = 'pending'
   or f.completed_at >= now() - interval '32 days';

comment on view public.follow_up_buckets is
  'follow_ups + bucket (overdue/today/upcoming/later/completed, org timezone) for the Follow-ups page; same definition as follow_up_bucket_counts(). security_invoker.';

revoke all on public.follow_up_buckets from public, anon, authenticated;
grant select on public.follow_up_buckets to authenticated;

-- ---------------------------------------------------------------------------
-- follow_up_bucket_counts(): tab counts from the same view (RLS applies).
-- p_owner_id null → every follow-up the caller can see; otherwise that owner's.
-- ---------------------------------------------------------------------------
create function public.follow_up_bucket_counts(p_owner_id uuid default null)
returns table (overdue integer, today integer, upcoming integer, completed integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (count(*) filter (where b.bucket = 'overdue'))::integer,
    (count(*) filter (where b.bucket = 'today'))::integer,
    (count(*) filter (where b.bucket = 'upcoming'))::integer,
    (count(*) filter (where b.bucket = 'completed'))::integer
  from public.follow_up_buckets b
  where p_owner_id is null or b.owner_id = p_owner_id;
$$;

comment on function public.follow_up_bucket_counts(uuid) is
  'Follow-ups page tab counts (overdue/today/upcoming/completed) over follow_up_buckets; optional owner filter. Sidebar badge = overdue + today for the current user.';

revoke execute on function public.follow_up_bucket_counts(uuid) from public, anon;
grant execute on function public.follow_up_bucket_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- latest_conversation_activities: newest call / conversation / note with
-- content per prospect ("last conversation" snippet). Embedded per prospect;
-- the prospect_id filter is pushed into the distinct-on → partial index lookup.
-- ---------------------------------------------------------------------------
create index activities_conversation_prospect_idx
  on public.activities (prospect_id, occurred_at desc, id desc)
  where type in ('call', 'conversation', 'note');

create view public.latest_conversation_activities
with (security_invoker = true)
as
select distinct on (a.prospect_id)
  a.prospect_id,
  a.id,
  a.type,
  a.occurred_at,
  left(a.content, 280) as snippet,
  char_length(a.content) as content_length
from public.activities a
where a.type in ('call', 'conversation', 'note')
  and a.content is not null
  and btrim(a.content) <> ''
order by a.prospect_id, a.occurred_at desc, a.id desc;

comment on view public.latest_conversation_activities is
  'Newest call/conversation/note activity with content per prospect (snippet = first 280 chars). security_invoker: RLS of activities applies.';

revoke all on public.latest_conversation_activities from public, anon, authenticated;
grant select on public.latest_conversation_activities to authenticated;
