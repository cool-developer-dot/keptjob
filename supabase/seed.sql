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

-- ---------------------------------------------------------------------------
-- Demo prospects (Prompt 7; Prompt 14 expands this). Fixed UUIDs
-- 22222222-2222-4222-8222-0000000000NN (prospects) and
-- 33333333-3333-4333-8333-0000000000NN (follow-ups); re-runnable.
-- Riley (…0002) and Sam (…0003). Dates are relative to now() / org_today(),
-- so "overdue", "today" and "stale" stay meaningful whenever the seed runs.
-- ---------------------------------------------------------------------------
insert into public.prospects (
  id, name, company, email, phone, stage, decision_maker_status, objections,
  objection_notes, notes, demo_at, close_reason, close_notes, deal_value, currency, owner_id,
  created_by, last_activity_at, created_at
) values
  ('22222222-2222-4222-8222-000000000001', 'Jordan Lee', 'Northwind Traders', 'jordan.lee@northwind.example', '+1 212 555 0101',
   'qualified', 'yes', '{price}', 'Wants a volume discount.', 'Interested in the annual plan.', null, null, null,
   12000, 'USD', '11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000002',
   now() - interval '2 days', now() - interval '20 days'),
  ('22222222-2222-4222-8222-000000000002', 'Priya Shah', 'Contoso Health', 'priya.shah@contoso.example', null,
   'demo_booked', 'unknown', '{timing,budget}', 'Budget review next quarter.', null, now() + interval '2 days', null, null,
   8500, 'USD', '11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000002',
   now() - interval '1 day', now() - interval '15 days'),
  ('22222222-2222-4222-8222-000000000003', 'Marcus Chen', 'Fabrikam Logistics', 'marcus.chen@fabrikam.example', '+1 312 555 0133',
   'contacted', 'no', '{no_authority}', 'Needs sign-off from the COO.', null, null, null, null,
   null, 'USD', '11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000002',
   now() - interval '30 days', now() - interval '45 days'),
  ('22222222-2222-4222-8222-000000000004', 'Elena García', 'Tailspin Toys', 'elena.garcia@tailspin.example', null,
   'closed_won', 'yes', '{}', null, 'Signed the 12-month contract.', null, 'product_fit', 'Great fit for their team.',
   24000, 'USD', '11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000002',
   now() - interval '5 days', now() - interval '60 days'),
  ('22222222-2222-4222-8222-000000000005', 'Tom Becker', 'Litware Inc', 'tom.becker@litware.example', null,
   'prospect', 'unknown', '{}', null, null, null, null, null,
   3000, 'USD', '11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000002',
   now() - interval '3 hours', now() - interval '3 hours'),
  ('22222222-2222-4222-8222-000000000006', 'Aisha Khan', 'Adventure Works', 'aisha.khan@adventure-works.example', '+1 415 555 0166',
   'conversation', 'yes', '{competitor}', 'Currently evaluating a competitor.', null, null, null, null,
   15000, 'USD', '11111111-1111-4111-8111-000000000003', '11111111-1111-4111-8111-000000000003',
   now() - interval '20 days', now() - interval '35 days'),
  ('22222222-2222-4222-8222-000000000007', 'Liam O''Brien', 'Wingtip Supplies', 'liam.obrien@wingtip.example', null,
   'follow_up', 'unknown', '{price,other}', null, 'Asked for a proposal in EUR.', null, null, null,
   4200, 'EUR', '11111111-1111-4111-8111-000000000003', '11111111-1111-4111-8111-000000000003',
   now() - interval '4 days', now() - interval '25 days'),
  ('22222222-2222-4222-8222-000000000008', 'Sofia Rossi', 'Blue Yonder Airlines', 'sofia.rossi@blueyonder.example', null,
   'closed_lost', 'no', '{budget}', null, null, null, 'no_budget', 'Budget frozen this year.',
   9000, 'USD', '11111111-1111-4111-8111-000000000003', '11111111-1111-4111-8111-000000000003',
   now() - interval '40 days', now() - interval '90 days')
on conflict (id) do nothing;

insert into public.follow_ups (id, prospect_id, due_date, note) values
  ('33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-000000000001', public.org_today() - 1, 'Send the volume pricing'),
  ('33333333-3333-4333-8333-000000000002', '22222222-2222-4222-8222-000000000002', public.org_today(), 'Confirm demo attendees'),
  ('33333333-3333-4333-8333-000000000003', '22222222-2222-4222-8222-000000000005', public.org_today() + 5, 'Intro call'),
  ('33333333-3333-4333-8333-000000000004', '22222222-2222-4222-8222-000000000006', public.org_today() - 3, 'Compare with the competitor offer'),
  ('33333333-3333-4333-8333-000000000005', '22222222-2222-4222-8222-000000000007', public.org_today() + 1, 'Send the EUR proposal')
on conflict (id) do nothing;
