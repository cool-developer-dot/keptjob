-- Local development seed (runs on `npm run db:reset`).
-- Dev users: 1 manager + 2 sales reps. Credentials are documented in README.md.
-- Prompt 14 expands this file with prospects, activities, follow-ups, etc.
--
-- Users are inserted straight into auth.users, so every column GoTrue expects
-- must look like a GoTrue-created user, otherwise password login fails:
--   * bcrypt password via extensions.crypt(..., extensions.gen_salt('bf'))
--   * token columns set to '' (GoTrue scans them into non-nullable strings)
--   * raw_app_meta_data with provider/providers + the role (never user metadata)
--   * a matching auth.identities row (provider 'email')
-- public.users rows are created by the on_auth_user_created trigger.

with seed_users (id, email, full_name, role) as (
  values
    ('11111111-1111-4111-8111-000000000001'::uuid, 'morgan.manager@example.com', 'Morgan Manager', 'manager'),
    ('11111111-1111-4111-8111-000000000002'::uuid, 'riley.rep@example.com',      'Riley Rep',      'sales_rep'),
    ('11111111-1111-4111-8111-000000000003'::uuid, 'sam.rep@example.com',        'Sam Rep',        'sales_rep')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', su.id, 'authenticated', 'authenticated', su.email,
  extensions.crypt('Password123!', extensions.gen_salt('bf')), now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', su.role),
  jsonb_build_object('full_name', su.full_name),
  now(), now(),
  '', '', '', '', '', '', '', ''
from seed_users su
on conflict (id) do nothing;

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.id, u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email', now(), now(), now()
from auth.users u
where u.id in (
  '11111111-1111-4111-8111-000000000001',
  '11111111-1111-4111-8111-000000000002',
  '11111111-1111-4111-8111-000000000003'
)
on conflict (provider_id, provider) do nothing;
