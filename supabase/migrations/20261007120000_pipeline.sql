-- Prompt 9 (Kanban pipeline): latest AI insight per prospect + Realtime
-- notification for owner reassignment.

-- ---------------------------------------------------------------------------
-- latest_ai_insights: the newest ai_insights row per prospect (distinct on,
-- served by ai_insights_prospect_id_created_at_idx). security_invoker → the
-- caller's RLS on ai_insights applies (reps: own prospects only).
-- ---------------------------------------------------------------------------
create view public.latest_ai_insights
with (security_invoker = true)
as
select distinct on (i.prospect_id)
  i.prospect_id,
  i.id,
  i.deal_health,
  i.created_at
from public.ai_insights i
order by i.prospect_id, i.created_at desc, i.id desc;

comment on view public.latest_ai_insights is
  'Newest AI insight per prospect (deal_health for Kanban cards / dashboard). security_invoker: RLS of ai_insights applies.';

revoke all on public.latest_ai_insights from public, anon, authenticated;
grant select on public.latest_ai_insights to authenticated;

-- ---------------------------------------------------------------------------
-- Owner reassignment → private Realtime broadcast to the previous owner.
--
-- postgres_changes checks RLS against the NEW row, so a rep whose prospect is
-- reassigned away never receives that UPDATE (and their Kanban would keep the
-- card). This trigger sends a broadcast (payload: only the prospect id) on the
-- private topic `user:<old owner id>`; the policy below lets each user receive
-- only their own topic. realtime.send() swallows its own errors (warning), so a
-- Realtime problem never blocks the reassignment.
-- ---------------------------------------------------------------------------
create function public.prospects_broadcast_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('prospect_id', new.id),
    'prospect_owner_changed',
    'user:' || old.owner_id::text,
    true
  );
  return null;
end;
$$;

revoke execute on function public.prospects_broadcast_owner_change() from public, anon, authenticated;

create trigger prospects_broadcast_owner_change
  after update of owner_id on public.prospects
  for each row
  when (old.owner_id is distinct from new.owner_id)
  execute function public.prospects_broadcast_owner_change();

-- Private broadcast channels: a signed-in user may join/receive only `user:<own id>`.
create policy "users receive their own broadcasts"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'user:' || (select auth.uid())::text
  );
