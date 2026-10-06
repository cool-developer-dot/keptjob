-- Backfill public.users for auth users created before the CRM schema existed
-- (e.g. accounts added in the Supabase dashboard before the first migration
-- ran, so the on_auth_user_created trigger wasn't there yet). Same values as
-- public.handle_new_user(); idempotent; a no-op when every auth user already
-- has a profile (always the case on a fresh local reset: the seed runs later).

insert into public.users (id, email, full_name, role)
select
  a.id,
  coalesce(a.email, ''),
  coalesce(
    nullif(btrim(a.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(a.email, ''), '@', 1)
  ),
  case
    when a.raw_app_meta_data ->> 'role' in ('manager', 'sales_rep')
      then (a.raw_app_meta_data ->> 'role')::public.user_role
    else 'sales_rep'::public.user_role
  end
from auth.users a
where not exists (select 1 from public.users u where u.id = a.id);
