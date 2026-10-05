-- Local development seed (runs on `npm run db:reset`).
-- Dev users: 1 manager + 2 sales reps. Credentials are documented in README.md.
-- Followed by the demo CRM data (Prompt 14), see the second half of this file.
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

-- ===========================================================================
-- Demo CRM data (Prompt 14): 40 prospects (Riley 21, Sam 19; every stage for
-- both reps), activities over the past ~60 days, follow-ups (overdue / today
-- / upcoming / later / completed), demos, consistent stage history (incl. a
-- skip, backward moves and a lost → reopened → won deal), closed deals with
-- reasons, one reassignment and a few AI insights.
--
-- Fixed ids (tests rely on them):
--   prospects  22222222-2222-4222-8222-0000000000NN  (01–08 predate Prompt 14
--              and keep their name/owner/stage/value/last-activity age)
--   follow-ups 33333333-3333-4333-8333-0000000000NN  (01–05 likewise)
--   insights   44444444-4444-4444-8444-0000000000NN
-- Everything else (history, activities) gets deterministic md5-based ids.
--
-- Time specs (all relative, so the seed never goes stale):
--   '-3d 10:30'  3 org days ago at 10:30 org time (business hours, DST-safe)
--   '+2d 14:00'  2 org days ahead (demo dates)
--   '3 hours'    now() - interval '3 hours' (items from today)
-- Follow-up due dates are offsets from org_today().
--
-- Strategy: the triggers would stamp every row with now() and recompute
-- derived fields, so the backdated rows are inserted with
-- session_replication_role = replica (user triggers off), stage_history and
-- its stage_change activities are derived from one list of moves, derived
-- columns are recomputed explicitly, and a final block asserts consistency
-- (a broken seed fails `npm run db:reset`).
-- ===========================================================================

create function pg_temp.seed_at(spec text) returns timestamptz
language sql stable as $$
  select case
    when spec is null then null
    when spec ~ '^[+-]?[0-9]+d [0-9]{2}:[0-9]{2}$' then
      ((public.org_today() + split_part(spec, 'd', 1)::int) + split_part(spec, ' ', 2)::time)
        at time zone (select s.timezone from public.org_settings s where s.id)
    else now() - spec::interval
  end
$$;

create function pg_temp.seed_user(code text) returns uuid
language sql immutable as $$
  select case code
    when 'M' then '11111111-1111-4111-8111-000000000001'::uuid
    when 'R' then '11111111-1111-4111-8111-000000000002'::uuid
    when 'S' then '11111111-1111-4111-8111-000000000003'::uuid
  end
$$;

create function pg_temp.seed_id(prefix text, n int) returns uuid
language sql immutable as $$
  select (prefix || lpad(n::text, 12, '0'))::uuid
$$;

create function pg_temp.prospect_id(n int) returns uuid
language sql immutable as $$
  select pg_temp.seed_id('22222222-2222-4222-8222-', n)
$$;

-- Deterministic v4-shaped uuid from a key (re-runs hit "on conflict do nothing").
create function pg_temp.seed_uuid(key text) returns uuid
language sql immutable as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8'
          || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
  from (select md5(key) as h) x
$$;

-- ---------------------------------------------------------------------------
-- Prospects (current owner; stage / close reason / created_at come from the moves)
-- ---------------------------------------------------------------------------
create temp table seed_prospects (
  n int primary key,
  name text not null,
  company text,
  email text,
  phone text,
  owner text not null,
  dm public.decision_maker_status not null,
  objections public.objection_category[] not null,
  objection_notes text,
  notes text,
  deal_value numeric(12, 2),
  currency char(3) not null,
  demo text,
  close_notes text
);

insert into seed_prospects values
  -- Riley (R)
  (1, 'Jordan Lee', 'Northwind Traders', 'jordan.lee@northwind.example', '+1 212 555 0101', 'R', 'yes', '{price}',
   'Wants a volume discount.', 'Interested in the annual plan.', 12000, 'USD', null, null),
  (2, 'Priya Shah', 'Contoso Health', 'priya.shah@contoso.example', null, 'R', 'unknown', '{timing,budget}',
   'Budget review next quarter.', null, 8500, 'USD', '+2d 14:00', null),
  (3, 'Marcus Chen', 'Fabrikam Logistics', 'marcus.chen@fabrikam.example', '+1 312 555 0133', 'R', 'no', '{no_authority}',
   'Needs sign-off from the COO.', null, null, 'USD', null, null),
  (4, 'Elena García', 'Tailspin Toys', 'elena.garcia@tailspin.example', null, 'R', 'yes', '{}',
   null, 'Signed the 12-month contract.', 24000, 'USD', '-33d 15:00', 'Great fit for their team.'),
  (5, 'Tom Becker', 'Litware Inc', 'tom.becker@litware.example', null, 'R', 'unknown', '{}',
   null, null, 3000, 'USD', null, null),
  (9, 'Hannah Brooks', 'Proseware', 'hannah.brooks@proseware.example', '+1 646 555 0109', 'R', 'unknown', '{}',
   null, 'Inbound from the pricing page; small inside-sales team.', 6000, 'USD', null, null),
  (10, 'Diego Alvarez', 'Woodgrove Bank', 'diego.alvarez@woodgrove.example', '+1 305 555 0110', 'R', 'no', '{timing}',
   'Busy with a core-banking migration until next month.', 'Leads the SMB banking sales team (14 reps).', 22000, 'USD', null, null),
  (11, 'Grace Kim', 'Alpine Ski House', 'grace.kim@alpineskihouse.example', null, 'R', 'yes', '{price}',
   'Comparing per-seat vs. flat pricing.', 'Seasonal sales team of 30; decision this month.', 18000, 'USD', null, null),
  (12, 'Noah Patel', 'Coho Winery', 'noah.patel@cohowinery.example', '+1 707 555 0112', 'R', 'yes', '{budget}',
   'Budget split across two wineries.', 'Wants one shared pipeline for both wineries.', 9500, 'USD', '-3d 15:00', null),
  (13, 'Olivia Novak', 'Lucerne Publishing', 'olivia.novak@lucernepublishing.example', null, 'R', 'yes', '{timing,competitor}',
   'Also talking to a competitor; decision after the book fair.', 'Demo was rebooked once (she was out sick).', 14500, 'USD', '-27d 14:00', null),
  (14, 'Ethan Wright', 'Trey Research', 'ethan.wright@treyresearch.example', null, 'R', 'unknown', '{}',
   null, 'Met at the SaaS Growth meetup.', null, 'USD', null, null),
  (15, 'Mia Johansson', 'Fourth Coffee', 'mia.johansson@fourthcoffee.example', '+1 206 555 0115', 'R', 'yes', '{competitor,price}',
   'Their POS vendor bundles a CRM.', null, 7800, 'USD', '-19d 14:00', 'Chose the CRM bundled with their POS.'),
  (16, 'Lucas Silva', 'Wide World Importers', 'lucas.silva@wideworldimporters.example', null, 'R', 'yes', '{price}',
   'Wanted a prepay discount.', 'Annual prepay, 10% off.', 32000, 'USD', '-35d 14:00', 'Annual prepay discount closed it.'),
  (17, 'Ava Thompson', 'Humongous Insurance', 'ava.thompson@humongousinsurance.example', '+1 860 555 0117', 'R', 'no', '{no_authority}',
   'The VP Sales must join the demo.', '60 seats across three regional teams.', 45000, 'USD', '+5d 15:00', null),
  (18, 'James O''Connor', 'Relecloud', 'james.oconnor@relecloud.example', null, 'R', 'unknown', '{budget}',
   'Waiting for next year''s budget.', null, null, 'USD', null, null),
  (19, 'Chloe Martin', 'Lamna Healthcare', 'chloe.martin@lamnahealthcare.example', '+1 617 555 0119', 'R', 'yes', '{}',
   null, 'Referral from Elena (Tailspin Toys).', 16000, 'USD', null, null),
  (20, 'Benjamin Ross', 'A. Datum Corporation', 'benjamin.ross@adatum.example', null, 'R', 'unknown', '{not_interested}',
   '"Not now" on the first call.', null, 5000, 'USD', null, 'No reply after four attempts.'),
  (21, 'Zoe Clarke', 'Margie''s Travel', 'zoe.clarke@margiestravel.example', null, 'R', 'unknown', '{other}',
   'Reps need to update deals from their phones.', null, 4000, 'USD', null, null),
  (22, 'Ryan Cooper', 'Consolidated Messenger', 'ryan.cooper@consolidatedmessenger.example', '+1 773 555 0122', 'R', 'unknown', '{}',
   null, null, null, 'USD', null, null),
  (23, 'Emma Davis', 'City Power & Light', 'emma.davis@citypowerlight.example', null, 'R', 'yes', '{timing}',
   'Wanted to go live before the new fiscal year.', null, 9600, 'USD', '-16d 14:00', 'Long-standing relationship with their COO.'),
  (24, 'Owen Fischer', 'Southridge Video', 'owen.fischer@southridgevideo.example', '+1 818 555 0124', 'R', 'yes', '{price}',
   'Asked for a smaller starter package.', null, 7200, 'USD', '-10d 14:00', null),
  -- Sam (S)
  (6, 'Aisha Khan', 'Adventure Works', 'aisha.khan@adventure-works.example', '+1 415 555 0166', 'S', 'yes', '{competitor}',
   'Currently evaluating a competitor.', null, 15000, 'USD', null, null),
  (7, 'Liam O''Brien', 'Wingtip Supplies', 'liam.obrien@wingtip.example', null, 'S', 'unknown', '{price,other}',
   null, 'Asked for a proposal in EUR.', 4200, 'EUR', '-11d 14:00', null),
  (8, 'Sofia Rossi', 'Blue Yonder Airlines', 'sofia.rossi@blueyonder.example', null, 'S', 'no', '{budget}',
   null, null, 9000, 'USD', null, 'Budget frozen this year.'),
  (25, 'Fatima Haddad', 'Bellows College', 'fatima.haddad@bellowscollege.example', null, 'S', 'unknown', '{}',
   null, 'Asked for education pricing via the contact form.', 3500, 'USD', null, null),
  (26, 'Daniel Weber', 'Graphic Design Institute', 'daniel.weber@graphicdesigninstitute.example', '+1 503 555 0126', 'S', 'no', '{no_authority}',
   'The dean of admissions signs contracts.', null, 5200, 'USD', null, null),
  (27, 'Sophie Laurent', 'Nod Publishers', 'sophie.laurent@nodpublishers.example', '+33 1 55 50 01 27', 'S', 'yes', '{price,competitor}',
   'Has a quote from a cheaper tool.', 'Values the AI follow-up suggestions.', 11000, 'EUR', null, null),
  (28, 'Kenji Tanaka', 'VanArsdel Ltd', 'kenji.tanaka@vanarsdel.example', '+1 408 555 0128', 'S', 'yes', '{other}',
   'Security review required before purchase.', null, 26000, 'USD', null, null),
  (29, 'Laura Bianchi', 'Munson''s Pickles and Preserves Farm', 'laura.bianchi@munsonspickles.example', null, 'S', 'yes', '{}',
   null, 'Family business, 12 reps, currently on spreadsheets.', 6800, 'USD', '+1d 11:00', null),
  (30, 'Ahmed Saleh', 'First Up Consultants', 'ahmed.saleh@firstupconsultants.example', '+1 202 555 0130', 'S', 'unknown', '{timing}',
   'Wants to start next quarter.', null, 12500, 'USD', '-6d 14:00', null),
  (31, 'Rachel Adler', 'Tailwind Traders', 'rachel.adler@tailwindtraders.example', null, 'S', 'yes', '{price}',
   'Negotiating a multi-year discount.', 'Budget approved on the first call.', 13500, 'USD', '-20d 14:00', null),
  (32, 'Victor Ivanov', 'Contoso Pharmaceuticals', 'victor.ivanov@contosopharma.example', '+1 908 555 0132', 'S', 'yes', '{timing}',
   'Needed it live before the sales kickoff.', null, 21000, 'USD', '-15d 14:00', 'Live before their sales kickoff.'),
  (33, 'Nina Petrova', 'Fincher Architects', 'nina.petrova@fincherarchitects.example', null, 'S', 'yes', '{price}',
   'Price per seat too high for a 6-person team.', null, 8800, 'USD', '-30d 14:00', 'Went with a cheaper tool; revisit next year.'),
  (34, 'Carlos Mendes', 'Best For You Organics', 'carlos.mendes@bestforyouorganics.example', null, 'S', 'yes', '{}',
   null, 'Franchise rollout; pricing per store to be agreed later.', null, 'USD', null, 'Bundled with their franchise rollout.'),
  (35, 'Hiro Sato', 'Cronus Furniture', 'hiro.sato@cronusfurniture.example', null, 'S', 'unknown', '{}',
   null, null, null, 'USD', null, null),
  (36, 'Megan Lewis', 'Kokoro Robotics', 'megan.lewis@kokororobotics.example', '+1 512 555 0136', 'S', 'no', '{no_authority}',
   'The CTO must approve new tooling.', 'Missed the first demo; rebooking with the CTO.', 6400, 'USD', '-12d 14:00', null),
  (37, 'Paul Schneider', 'Brightline Analytics', 'paul.schneider@brightline.example', null, 'S', 'unknown', '{other}',
   'Wants a data export to their BI tool.', 'Reassigned from Riley to Sam (BI territory).', null, 'USD', null, null),
  (38, 'Leah Cohen', 'Harborview Dental Group', 'leah.cohen@harborviewdental.example', '+1 619 555 0138', 'S', 'unknown', '{not_interested}',
   'Happy with their current process.', null, 4800, 'USD', null, null),
  (39, 'Omar Farouk', 'Summit Ridge Outfitters', 'omar.farouk@summitridge.example', null, 'S', 'yes', '{other}',
   'Needs inventory management in the same tool.', null, 5600, 'USD', null, 'Needs inventory features we don''t offer.'),
  (40, 'Thomas Berg', 'Copperline Freight', 'thomas.berg@copperline.example', '+1 414 555 0140', 'S', 'yes', '{timing}',
   'Paused for a reorg, then resumed.', null, 11000, 'USD', '-9d 14:00', 'Came back after their reorg.');

-- ---------------------------------------------------------------------------
-- Stage moves, in order. seq 0 = creation (from null) by the creator; the
-- last move is the current stage (and close reason). by = who moved it.
-- ---------------------------------------------------------------------------
create temp table seed_moves (
  n int not null,
  seq int not null,
  stage public.pipeline_stage not null,
  at text not null,
  by text not null,
  reason text,
  note text,
  primary key (n, seq)
);

insert into seed_moves values
  (1, 0, 'prospect', '-20d 09:15', 'R', null, null),
  (1, 1, 'contacted', '-19d 10:00', 'R', null, null),
  (1, 2, 'conversation', '-14d 14:30', 'R', null, null),
  (1, 3, 'qualified', '-9d 11:00', 'R', null, 'Budget confirmed for Q4'),

  (2, 0, 'prospect', '-15d 10:00', 'R', null, null),
  (2, 1, 'contacted', '-14d 11:30', 'R', null, null),
  (2, 2, 'conversation', '-10d 15:00', 'R', null, null),
  (2, 3, 'qualified', '-6d 10:30', 'R', null, null),
  (2, 4, 'demo_booked', '-1d 13:00', 'R', null, 'Demo with Priya and two clinic managers'),

  (3, 0, 'prospect', '-45d 09:30', 'R', null, null),
  (3, 1, 'contacted', '-30d 11:00', 'R', null, null),

  (4, 0, 'prospect', '-60d 10:00', 'R', null, null),
  (4, 1, 'contacted', '-58d 11:00', 'R', null, null),
  (4, 2, 'conversation', '-52d 14:00', 'R', null, null),
  (4, 3, 'qualified', '-45d 10:00', 'R', null, null),
  (4, 4, 'demo_booked', '-38d 15:00', 'R', null, null),
  (4, 5, 'demo_attended', '-33d 16:00', 'R', null, null),
  (4, 6, 'follow_up', '-25d 10:00', 'R', null, null),
  (4, 7, 'closed_won', '-5d 15:30', 'R', 'product_fit', '12-month contract signed'),

  (5, 0, 'prospect', '3 hours', 'R', null, null),

  (6, 0, 'prospect', '-35d 10:00', 'S', null, null),
  (6, 1, 'contacted', '-33d 11:00', 'S', null, null),
  (6, 2, 'conversation', '-20d 15:00', 'S', null, 'Comparing us with their current vendor'),

  (7, 0, 'prospect', '-25d 09:00', 'S', null, null),
  (7, 1, 'contacted', '-24d 10:00', 'S', null, null),
  (7, 2, 'conversation', '-21d 14:00', 'S', null, null),
  (7, 3, 'qualified', '-18d 10:00', 'S', null, null),
  (7, 4, 'demo_booked', '-15d 11:00', 'S', null, null),
  (7, 5, 'demo_attended', '-11d 15:00', 'S', null, null),
  (7, 6, 'follow_up', '-4d 10:00', 'S', null, 'Waiting on feedback to the EUR proposal'),

  (8, 0, 'prospect', '-90d 10:00', 'S', null, null),
  (8, 1, 'contacted', '-85d 11:00', 'S', null, null),
  (8, 2, 'conversation', '-70d 14:00', 'S', null, null),
  (8, 3, 'qualified', '-60d 10:00', 'S', null, null),
  (8, 4, 'closed_lost', '-40d 16:00', 'S', 'no_budget', null),

  (9, 0, 'prospect', '-6d 09:00', 'R', null, null),
  (9, 1, 'contacted', '-3d 10:15', 'R', null, null),

  (10, 0, 'prospect', '-21d 10:00', 'R', null, null),
  (10, 1, 'contacted', '-18d 11:00', 'R', null, null),
  (10, 2, 'conversation', '-6d 14:00', 'R', null, null),

  (11, 0, 'prospect', '-16d 09:30', 'R', null, null),
  (11, 1, 'contacted', '-15d 10:00', 'R', null, null),
  (11, 2, 'conversation', '-11d 13:00', 'R', null, null),
  (11, 3, 'qualified', '-4d 11:00', 'R', null, 'Budget approved; decision this month'),

  (12, 0, 'prospect', '-28d 10:00', 'R', null, null),
  (12, 1, 'contacted', '-26d 11:00', 'R', null, null),
  (12, 2, 'conversation', '-20d 15:00', 'R', null, null),
  (12, 3, 'qualified', '-14d 10:00', 'R', null, null),
  (12, 4, 'demo_booked', '-10d 12:00', 'R', null, null),
  (12, 5, 'demo_attended', '-3d 16:00', 'R', null, null),

  -- Backward move: demo booked → qualified (demo postponed), then rebooked.
  (13, 0, 'prospect', '-50d 10:00', 'R', null, null),
  (13, 1, 'contacted', '-48d 11:00', 'R', null, null),
  (13, 2, 'conversation', '-44d 14:00', 'R', null, null),
  (13, 3, 'qualified', '-40d 10:00', 'R', null, null),
  (13, 4, 'demo_booked', '-36d 11:00', 'R', null, null),
  (13, 5, 'qualified', '-33d 09:30', 'R', null, 'Demo postponed: Olivia out sick'),
  (13, 6, 'demo_booked', '-30d 10:00', 'R', null, 'Demo rebooked'),
  (13, 7, 'demo_attended', '-27d 15:00', 'R', null, null),
  (13, 8, 'follow_up', '-8d 10:00', 'R', null, null),

  (14, 0, 'prospect', '-10d 09:00', 'R', null, null),

  (15, 0, 'prospect', '-40d 10:00', 'R', null, null),
  (15, 1, 'contacted', '-38d 11:00', 'R', null, null),
  (15, 2, 'conversation', '-33d 14:00', 'R', null, null),
  (15, 3, 'qualified', '-27d 10:00', 'R', null, null),
  (15, 4, 'demo_booked', '-22d 11:00', 'R', null, null),
  (15, 5, 'demo_attended', '-19d 15:00', 'R', null, null),
  (15, 6, 'closed_lost', '-12d 16:00', 'R', 'competitor', null),

  (16, 0, 'prospect', '-55d 10:00', 'R', null, null),
  (16, 1, 'contacted', '-53d 11:00', 'R', null, null),
  (16, 2, 'conversation', '-48d 14:00', 'R', null, null),
  (16, 3, 'qualified', '-43d 10:00', 'R', null, null),
  (16, 4, 'demo_booked', '-38d 11:00', 'R', null, null),
  (16, 5, 'demo_attended', '-35d 15:00', 'R', null, null),
  (16, 6, 'follow_up', '-30d 10:00', 'R', null, null),
  (16, 7, 'closed_won', '-20d 14:00', 'R', 'price_value', null),

  (17, 0, 'prospect', '-18d 10:00', 'R', null, null),
  (17, 1, 'contacted', '-17d 11:00', 'R', null, null),
  (17, 2, 'conversation', '-12d 14:00', 'R', null, null),
  (17, 3, 'qualified', '-7d 10:00', 'R', null, null),
  (17, 4, 'demo_booked', '-2d 11:00', 'R', null, 'Demo with Ava and the VP Sales'),

  (18, 0, 'prospect', '-32d 10:00', 'R', null, null),
  (18, 1, 'contacted', '-30d 11:00', 'R', null, null),
  (18, 2, 'conversation', '-18d 14:00', 'R', null, null),

  -- Skip: contacted → qualified.
  (19, 0, 'prospect', '-9d 10:00', 'R', null, null),
  (19, 1, 'contacted', '-8d 11:00', 'R', null, null),
  (19, 2, 'qualified', '-5d 15:00', 'R', null, 'Qualified on the referral call; skipped discovery'),

  (20, 0, 'prospect', '-58d 10:00', 'R', null, null),
  (20, 1, 'contacted', '-55d 11:00', 'R', null, null),
  (20, 2, 'closed_lost', '-35d 16:00', 'R', 'no_response', null),

  (21, 0, 'prospect', '-12d 10:00', 'R', null, null),
  (21, 1, 'contacted', '-8d 11:30', 'R', null, null),

  (22, 0, 'prospect', '-1d 16:00', 'R', null, null),

  -- Skip: conversation → demo booked.
  (23, 0, 'prospect', '-30d 10:00', 'R', null, null),
  (23, 1, 'contacted', '-29d 11:00', 'R', null, null),
  (23, 2, 'conversation', '-25d 14:00', 'R', null, null),
  (23, 3, 'demo_booked', '-20d 11:00', 'R', null, null),
  (23, 4, 'demo_attended', '-16d 15:00', 'R', null, null),
  (23, 5, 'closed_won', '-2d 11:00', 'R', 'relationship', 'PO received'),

  (24, 0, 'prospect', '-24d 10:00', 'R', null, null),
  (24, 1, 'contacted', '-23d 11:00', 'R', null, null),
  (24, 2, 'conversation', '-19d 14:00', 'R', null, null),
  (24, 3, 'qualified', '-16d 10:00', 'R', null, null),
  (24, 4, 'demo_booked', '-13d 11:00', 'R', null, null),
  (24, 5, 'demo_attended', '-10d 15:00', 'R', null, null),
  (24, 6, 'follow_up', '-7d 10:00', 'R', null, null),

  (25, 0, 'prospect', '-2d 09:00', 'S', null, null),

  (26, 0, 'prospect', '-9d 10:00', 'S', null, null),
  (26, 1, 'contacted', '-5d 11:00', 'S', null, null),

  (27, 0, 'prospect', '-14d 10:00', 'S', null, null),
  (27, 1, 'contacted', '-12d 11:00', 'S', null, null),
  (27, 2, 'conversation', '-2d 14:00', 'S', null, null),

  (28, 0, 'prospect', '-27d 10:00', 'S', null, null),
  (28, 1, 'contacted', '-25d 11:00', 'S', null, null),
  (28, 2, 'conversation', '-19d 14:00', 'S', null, null),
  (28, 3, 'qualified', '-10d 10:00', 'S', null, null),

  (29, 0, 'prospect', '-13d 10:00', 'S', null, null),
  (29, 1, 'contacted', '-12d 11:00', 'S', null, null),
  (29, 2, 'conversation', '-9d 14:00', 'S', null, null),
  (29, 3, 'qualified', '-6d 10:00', 'S', null, null),
  (29, 4, 'demo_booked', '-3d 11:00', 'S', null, null),

  (30, 0, 'prospect', '-22d 10:00', 'S', null, null),
  (30, 1, 'contacted', '-21d 11:00', 'S', null, null),
  (30, 2, 'conversation', '-17d 14:00', 'S', null, null),
  (30, 3, 'qualified', '-13d 10:00', 'S', null, null),
  (30, 4, 'demo_booked', '-10d 11:00', 'S', null, null),
  (30, 5, 'demo_attended', '-6d 15:00', 'S', null, null),

  -- Skip: contacted → qualified.
  (31, 0, 'prospect', '-33d 10:00', 'S', null, null),
  (31, 1, 'contacted', '-31d 11:00', 'S', null, null),
  (31, 2, 'qualified', '-27d 14:00', 'S', null, null),
  (31, 3, 'demo_booked', '-24d 11:00', 'S', null, null),
  (31, 4, 'demo_attended', '-20d 15:00', 'S', null, null),
  (31, 5, 'follow_up', '-9d 10:00', 'S', null, null),

  (32, 0, 'prospect', '-26d 10:00', 'S', null, null),
  (32, 1, 'contacted', '-25d 11:00', 'S', null, null),
  (32, 2, 'conversation', '-22d 14:00', 'S', null, null),
  (32, 3, 'qualified', '-19d 10:00', 'S', null, null),
  (32, 4, 'demo_booked', '-17d 11:00', 'S', null, null),
  (32, 5, 'demo_attended', '-15d 15:00', 'S', null, null),
  (32, 6, 'closed_won', '-9d 14:00', 'S', 'urgent_need', null),

  (33, 0, 'prospect', '-48d 10:00', 'S', null, null),
  (33, 1, 'contacted', '-46d 11:00', 'S', null, null),
  (33, 2, 'conversation', '-40d 14:00', 'S', null, null),
  (33, 3, 'qualified', '-35d 10:00', 'S', null, null),
  (33, 4, 'demo_booked', '-32d 11:00', 'S', null, null),
  (33, 5, 'demo_attended', '-30d 15:00', 'S', null, null),
  (33, 6, 'closed_lost', '-25d 16:00', 'S', 'price', null),

  -- Skip: qualified → closed won.
  (34, 0, 'prospect', '-60d 10:00', 'S', null, null),
  (34, 1, 'contacted', '-58d 11:00', 'S', null, null),
  (34, 2, 'conversation', '-55d 14:00', 'S', null, null),
  (34, 3, 'qualified', '-52d 10:00', 'S', null, null),
  (34, 4, 'closed_won', '-45d 14:00', 'S', 'other', null),

  (35, 0, 'prospect', '-25d 10:00', 'S', null, null),

  -- Backward move: demo booked → qualified after a no-show.
  (36, 0, 'prospect', '-30d 10:00', 'S', null, null),
  (36, 1, 'contacted', '-28d 11:00', 'S', null, null),
  (36, 2, 'conversation', '-24d 14:00', 'S', null, null),
  (36, 3, 'qualified', '-20d 10:00', 'S', null, null),
  (36, 4, 'demo_booked', '-15d 11:00', 'S', null, null),
  (36, 5, 'qualified', '-11d 09:30', 'S', null, 'No-show at the demo; rebooking with the CTO'),

  -- Riley's deal, reassigned to Sam by Morgan (see seed_owner_changes).
  (37, 0, 'prospect', '-40d 10:00', 'R', null, null),
  (37, 1, 'contacted', '-38d 11:00', 'R', null, null),
  (37, 2, 'conversation', '-30d 14:00', 'R', null, null),

  (38, 0, 'prospect', '-22d 10:00', 'S', null, null),
  (38, 1, 'contacted', '-16d 11:00', 'S', null, null),

  (39, 0, 'prospect', '-15d 10:00', 'S', null, null),
  (39, 1, 'contacted', '-14d 11:00', 'S', null, null),
  (39, 2, 'conversation', '-10d 14:00', 'S', null, null),
  (39, 3, 'closed_lost', '-6d 16:00', 'S', 'not_a_fit', null),

  -- Lost → reopened → won.
  (40, 0, 'prospect', '-58d 10:00', 'S', null, null),
  (40, 1, 'contacted', '-56d 11:00', 'S', null, null),
  (40, 2, 'conversation', '-52d 14:00', 'S', null, null),
  (40, 3, 'closed_lost', '-45d 16:00', 'S', 'no_response', 'Went silent during a reorg'),
  (40, 4, 'conversation', '-20d 10:00', 'S', null, 'Reopened: Thomas reached out after the reorg'),
  (40, 5, 'qualified', '-15d 10:00', 'S', null, null),
  (40, 6, 'demo_booked', '-12d 11:00', 'S', null, null),
  (40, 7, 'demo_attended', '-9d 15:00', 'S', null, null),
  (40, 8, 'closed_won', '-3d 14:00', 'S', 'product_fit', null);

create temp table seed_owner_changes (n int, at text, by text, from_owner text, to_owner text);
insert into seed_owner_changes values (37, '-12d 09:00', 'M', 'R', 'S');

-- ---------------------------------------------------------------------------
-- Human activities (stage_change / follow_up / ai_insight / owner_change
-- activities are derived from the other tables).
-- ---------------------------------------------------------------------------
create temp table seed_activities (
  n int not null,
  type public.activity_type not null,
  at text not null,
  by text not null,
  content text not null
);

insert into seed_activities values
  (1, 'call', '-19d 10:00', 'R', 'Intro call. Northwind runs renewals for 25 reps out of spreadsheets; open to a demo of the pipeline.'),
  (1, 'conversation', '-14d 14:30', 'R', 'Discovery call with Jordan and their ops lead. Main pain: no visibility into upcoming renewals.'),
  (1, 'note', '-9d 11:05', 'R', 'Sent the annual-plan overview and pricing sheet.'),
  (1, 'call', '-2d 16:20', 'R', 'Jordan asked for a volume discount above 20 seats. Promised revised pricing by tomorrow.'),

  (2, 'call', '-14d 11:30', 'R', 'Left a voicemail, then reached Priya by email. She manages sales for four clinics.'),
  (2, 'conversation', '-10d 15:00', 'R', 'Priya is evaluating tools for 4 clinics; budget review happens next quarter.'),
  (2, 'note', '-6d 10:35', 'R', 'Priya will bring the clinic managers to the demo; unclear who signs off on the budget.'),

  (3, 'call', '-30d 11:00', 'R', 'Marcus likes it but needs sign-off from the COO; asked to reconnect later.'),

  (4, 'call', '-58d 11:00', 'R', 'Cold call. Elena runs sales ops for 40 reps.'),
  (4, 'conversation', '-52d 14:00', 'R', 'Elena needs pipeline reporting her team can trust before the board meeting.'),
  (4, 'demo', '-33d 16:00', 'R', 'Demo went well: Elena loved the Kanban and follow-up views. Legal review next.'),
  (4, 'note', '-12d 10:00', 'R', 'Legal approved the DPA; procurement is sending the order form.'),

  (6, 'call', '-33d 11:00', 'S', 'Intro call. Aisha is the decision maker for the regional sales team.'),
  (6, 'conversation', '-20d 15:00', 'S', 'They are evaluating a competitor; Aisha wants a side-by-side comparison.'),

  (7, 'call', '-24d 10:00', 'S', 'Liam replied to the outreach; small distributor in Dublin.'),
  (7, 'conversation', '-21d 14:00', 'S', 'Liam wants pricing in EUR and a shorter contract.'),
  (7, 'demo', '-11d 15:00', 'S', 'Demo with Liam and his business partner; price is the main concern.'),
  (7, 'note', '-4d 10:05', 'S', 'Sent a draft EUR proposal with a 6-month option; final version pending approval.'),

  (8, 'call', '-85d 11:00', 'S', 'First call with Sofia (IT procurement).'),
  (8, 'conversation', '-70d 14:00', 'S', 'Needs CFO approval; budget is tight this year.'),
  (8, 'note', '-45d 09:30', 'S', 'The CFO froze all new software spend until next fiscal year.'),

  (9, 'call', '-3d 10:15', 'R', 'Reached Hannah; she wants a short case study before booking a discovery call.'),

  (10, 'call', '-18d 11:00', 'R', 'Intro call. Diego leads the SMB banking sales team.'),
  (10, 'conversation', '-6d 14:00', 'R', 'Interested, but the team is busy with a core-banking migration. Revisit next month.'),

  (11, 'call', '-15d 10:00', 'R', 'Inbound lead from the webinar. Grace owns the CRM budget.'),
  (11, 'conversation', '-11d 13:00', 'R', 'Seasonal sales team of 30; needs simple follow-up tracking for the winter season.'),
  (11, 'note', '-4d 11:05', 'R', 'Qualified: budget approved, decision expected this month.'),

  (12, 'call', '-26d 11:00', 'R', 'Noah picked up on the second try; manages sales for two wineries.'),
  (12, 'conversation', '-20d 15:00', 'R', 'Wants one shared pipeline for both wineries and their distributor accounts.'),
  (12, 'demo', '-3d 16:00', 'R', 'Demo attended by Noah and the GM. They want one quote covering both wineries.'),

  (13, 'call', '-48d 11:00', 'R', 'Intro call with Olivia, head of sales at Lucerne.'),
  (13, 'conversation', '-44d 14:00', 'R', 'Olivia needs follow-up reminders for 18 reps handling bookstore accounts.'),
  (13, 'note', '-33d 09:30', 'R', 'Olivia cancelled the demo (out sick); rebooking for next week.'),
  (13, 'demo', '-27d 15:00', 'R', 'Demo went well; she wants to compare with another vendor after the book fair.'),
  (13, 'call', '-8d 10:00', 'R', 'Book fair is over; Olivia is reviewing both proposals with her CEO.'),

  (14, 'note', '-10d 09:05', 'R', 'Met Ethan at the SaaS Growth meetup; he asked to be contacted next month.'),

  (15, 'call', '-38d 11:00', 'R', 'Intro call with Mia (Fourth Coffee, 9 locations).'),
  (15, 'conversation', '-33d 14:00', 'R', 'Mia wants a CRM that ties into their POS data.'),
  (15, 'demo', '-19d 15:00', 'R', 'Demo was fine, but their POS vendor offers a bundled CRM.'),
  (15, 'call', '-12d 15:30', 'R', 'Mia confirmed they went with the bundle from their POS vendor.'),

  (16, 'call', '-53d 11:00', 'R', 'Lucas called back after the webinar; imports team of 35.'),
  (16, 'conversation', '-48d 14:00', 'R', 'Needs territory-based pipelines for three regions.'),
  (16, 'demo', '-35d 15:00', 'R', 'Strong demo; Lucas asked about prepay discounts.'),
  (16, 'note', '-30d 10:05', 'R', 'Sent the annual prepay offer (10% off).'),
  (16, 'call', '-21d 11:00', 'R', 'Lucas accepted the prepay offer; contract out for signature.'),

  (17, 'call', '-17d 11:00', 'R', 'Ava manages three regional teams; the VP Sales signs.'),
  (17, 'conversation', '-12d 14:00', 'R', 'Walked through reporting needs: weekly pipeline review per region.'),
  (17, 'note', '-7d 10:05', 'R', 'Qualified: 60 seats, needs the VP Sales in the demo.'),

  (18, 'call', '-30d 11:00', 'R', 'Intro call with James (Relecloud).'),
  (18, 'conversation', '-18d 14:00', 'R', 'James likes the product but the budget is not approved yet.'),

  (19, 'call', '-8d 11:00', 'R', 'Referral from Elena. Chloe has budget and a clear timeline.'),
  (19, 'conversation', '-5d 15:00', 'R', 'Full requirements call; ready for a demo with her team leads.'),

  (20, 'call', '-55d 11:00', 'R', 'Short call; Benjamin said "not now" but agreed to follow-ups.'),
  (20, 'note', '-45d 10:00', 'R', 'Two emails and a voicemail, no reply.'),

  (21, 'call', '-8d 11:30', 'R', 'Zoe asked whether reps can update deals from their phones.'),

  (23, 'call', '-29d 11:00', 'R', 'Emma is an old contact from a previous company; now VP Sales at City Power & Light.'),
  (23, 'conversation', '-25d 14:00', 'R', 'Needs to go live before the new fiscal year; wants a demo for the COO.'),
  (23, 'demo', '-16d 15:00', 'R', 'Demo for the COO and two team leads. Positive, asked for a PO-based contract.'),
  (23, 'call', '-2d 10:30', 'R', 'Emma confirmed the PO; kickoff next week.'),

  (24, 'call', '-23d 11:00', 'R', 'Owen runs a 10-person sales team at Southridge.'),
  (24, 'conversation', '-19d 14:00', 'R', 'Wants deal tracking for production contracts.'),
  (24, 'demo', '-10d 15:00', 'R', 'Good demo; Owen asked for a smaller starter package.'),
  (24, 'note', '-7d 10:05', 'R', 'Sent the starter package quote and the order form.'),

  (25, 'note', '-2d 09:05', 'S', 'Inbound: Fatima filled in the contact form asking for education pricing.'),

  (26, 'call', '-5d 11:00', 'S', 'Daniel runs admissions outreach; the dean signs contracts.'),

  (27, 'call', '-12d 11:00', 'S', 'Intro call with Sophie (Nod Publishers, Paris).'),
  (27, 'conversation', '-2d 14:00', 'S', 'Sophie has a cheaper quote but values the AI follow-up suggestions.'),

  (28, 'call', '-25d 11:00', 'S', 'Kenji reached out after a referral; 40-person sales team.'),
  (28, 'conversation', '-19d 14:00', 'S', 'Discovery: they need audit logs and SSO on the roadmap.'),
  (28, 'note', '-10d 10:05', 'S', 'Qualified; IT requires a security questionnaire before the demo.'),

  (29, 'call', '-12d 11:00', 'S', 'Laura runs the family business with 12 reps.'),
  (29, 'conversation', '-9d 14:00', 'S', 'Currently tracking everything in spreadsheets; misses follow-ups weekly.'),

  (30, 'call', '-21d 11:00', 'S', 'Ahmed is a partner at First Up; 8 consultants doing business development.'),
  (30, 'conversation', '-17d 14:00', 'S', 'Wants a simple pipeline and reminders; budget for next quarter.'),
  (30, 'demo', '-6d 15:00', 'S', 'Demo with Ahmed and two partners; they want to start next quarter.'),

  (31, 'call', '-31d 11:00', 'S', 'Rachel had budget approved before the first call.'),
  (31, 'conversation', '-27d 14:00', 'S', 'Requirements call: 25 reps, needs win-rate reporting.'),
  (31, 'demo', '-20d 15:00', 'S', 'Demo for Rachel and her sales managers; positive.'),
  (31, 'note', '-9d 10:05', 'S', 'Sent the multi-year proposal.'),

  (32, 'call', '-25d 11:00', 'S', 'Victor needs a CRM live before their sales kickoff.'),
  (32, 'conversation', '-22d 14:00', 'S', 'Urgent timeline; legal pre-approved our standard terms.'),
  (32, 'demo', '-15d 15:00', 'S', 'Demo with Victor and the sales directors.'),
  (32, 'call', '-9d 13:30', 'S', 'Victor signed; onboarding starts next week.'),

  (33, 'call', '-46d 11:00', 'S', 'Intro call with Nina (6-person architecture firm).'),
  (33, 'conversation', '-40d 14:00', 'S', 'Needs pipeline tracking for project bids.'),
  (33, 'demo', '-30d 15:00', 'S', 'Demo OK; per-seat price is a concern for a small team.'),
  (33, 'call', '-25d 15:30', 'S', 'Nina chose a cheaper tool; open to revisit next year.'),

  (34, 'call', '-58d 11:00', 'S', 'Carlos manages franchise development at Best For You Organics.'),
  (34, 'conversation', '-55d 14:00', 'S', 'Every new franchise needs its own pipeline.'),
  (34, 'note', '-46d 10:00', 'S', 'Franchise HQ approved; pricing per store to be agreed later.'),

  (36, 'call', '-28d 11:00', 'S', 'Megan is the sales lead at Kokoro Robotics.'),
  (36, 'conversation', '-24d 14:00', 'S', 'Needs a CRM for robot-leasing deals; the CTO approves all tooling.'),
  (36, 'note', '-11d 09:30', 'S', 'Megan missed the demo; wants the CTO in the rebooked session.'),

  (37, 'call', '-38d 11:00', 'R', 'Intro call with Paul (Brightline Analytics).'),
  (37, 'conversation', '-30d 14:00', 'R', 'Paul''s team analyses pipeline data in their BI tool.'),
  (37, 'note', '-9d 10:00', 'S', 'Introduced myself as the new account owner; Paul wants to see the data export.'),

  (38, 'call', '-16d 11:00', 'S', 'Leah isn''t convinced they need a CRM; agreed to a follow-up call.'),

  (39, 'call', '-14d 11:00', 'S', 'Intro call with Omar (outdoor retail).'),
  (39, 'conversation', '-10d 14:00', 'S', 'Omar needs inventory management in the same tool.'),

  (40, 'call', '-56d 11:00', 'S', 'Thomas manages a freight sales team of 15.'),
  (40, 'conversation', '-52d 14:00', 'S', 'Interested, but a reorg is coming.'),
  (40, 'conversation', '-20d 10:00', 'S', 'Thomas is back: reorg done, new budget available.'),
  (40, 'demo', '-9d 15:00', 'S', 'Demo with Thomas and the new sales director.');

-- ---------------------------------------------------------------------------
-- Follow-ups: due = days from org_today(); done = completion time (null =
-- pending); outcome = completion note (activity content). Owner = the
-- prospect's owner. Riley's overdue ones stay ≤ 4 days overdue.
-- ---------------------------------------------------------------------------
create temp table seed_follow_ups (
  id int primary key,
  n int not null,
  due int not null,
  note text not null,
  created text not null,
  done text,
  outcome text
);

insert into seed_follow_ups values
  (1, 1, -1, 'Send the volume pricing', '-2d 16:25', null, null),
  (2, 2, 0, 'Confirm demo attendees', '-1d 13:05', null, null),
  (3, 5, 5, 'Intro call', '2 hours', null, null),
  (4, 6, -3, 'Compare with the competitor offer', '-20d 15:05', null, null),
  (5, 7, 1, 'Send the EUR proposal', '-4d 10:10', null, null),
  (6, 1, -12, 'Book a discovery call', '-19d 10:05', '-14d 14:00', 'Discovery call booked for this afternoon.'),
  (7, 2, -7, 'Send the clinic case study', '-10d 15:10', '-7d 09:40', 'Sent the Lakeside Clinics case study.'),
  (8, 4, -24, 'Send proposal and order form', '-25d 10:05', '-24d 11:00', 'Proposal sent.'),
  (9, 4, -6, 'Chase the signed order form', '-12d 10:05', '-5d 15:20', 'Signed order form received.'),
  (10, 9, 3, 'Send case study and book a discovery call', '-3d 10:20', null, null),
  (11, 10, 12, 'Check in after their migration', '-6d 14:10', null, null),
  (12, 11, 0, 'Send the proposal draft', '-4d 11:10', null, null),
  (13, 12, 1, 'Send a quote for both wineries', '-3d 16:10', null, null),
  (14, 13, 2, 'Call Olivia for a decision', '-8d 10:10', null, null),
  (15, 13, -26, 'Send the proposal', '-27d 15:10', '-25d 10:00', 'Proposal sent.'),
  (16, 16, -22, 'Follow up on the prepay offer', '-30d 10:10', '-21d 11:05', 'Offer accepted.'),
  (17, 17, 6, 'Follow up after demo', '-2d 11:05', null, null),
  (18, 18, -3, 'Call back about budget approval', '-18d 14:10', null, null),
  (19, 19, 4, 'Book the demo', '-5d 15:10', null, null),
  (20, 20, -46, 'Second follow-up email', '-55d 11:05', '-45d 10:05', 'No reply.'),
  (21, 21, 7, 'Send the mobile walkthrough video', '-8d 11:35', null, null),
  (22, 22, 2, 'Intro call', '-1d 16:05', null, null),
  (23, 24, -2, 'Chase the signed order form', '-7d 10:10', null, null),
  (24, 25, 0, 'Intro call', '-2d 09:10', null, null),
  (25, 26, 3, 'Send an overview for the dean', '-5d 11:05', null, null),
  (26, 27, 1, 'Send the ROI comparison', '-2d 14:10', null, null),
  (27, 28, -6, 'Return the security questionnaire', '-10d 10:10', null, null),
  (28, 29, 2, 'Follow up after demo', '-3d 11:05', null, null),
  (29, 30, 0, 'Send the next-quarter start proposal', '-6d 15:10', null, null),
  (30, 31, 5, 'Negotiate multi-year terms', '-9d 10:10', null, null),
  (31, 31, -18, 'Send the proposal', '-20d 15:10', '-17d 10:00', 'Proposal sent to Rachel and procurement.'),
  (32, 36, 3, 'Rebook the demo with the CTO', '-11d 09:35', null, null),
  (33, 38, -1, 'Share the dental practice case study', '-16d 11:05', null, null),
  (34, 40, -4, 'Send the contract', '-9d 15:10', '-4d 10:00', 'Contract sent.'),
  (35, 32, -12, 'Send the order form', '-15d 15:10', '-11d 10:00', 'Order form sent.');

-- ---------------------------------------------------------------------------
-- AI insights (all older than 10 minutes: they count toward the rate limit).
-- ---------------------------------------------------------------------------
create temp table seed_insights (
  id int primary key,
  n int not null,
  at text not null,
  by text not null,
  summary text not null,
  dm public.decision_maker_status not null,
  main_objection text not null,
  next_step text not null,
  health public.deal_health not null
);

insert into seed_insights values
  (1, 1, '-2d 16:45', 'R',
   'Jordan (Northwind) is qualified with budget confirmed for Q4; the open question is pricing above 20 seats.',
   'yes', 'Price: wants a volume discount above 20 seats',
   'Send tiered volume pricing and propose a call with their finance lead.', 'medium'),
  (2, 2, '-6d 11:00', 'R',
   'Priya is interested, but timing depends on next quarter''s budget review and the decision maker is unclear.',
   'unknown', 'Timing: budget review next quarter',
   'Share the clinic case study and ask who owns the budget decision.', 'medium'),
  (3, 2, '-1d 13:30', 'R',
   'Demo booked with Priya and two clinic managers; engagement is strong since the case study. Priya appears to own the decision.',
   'yes', 'Timing: budget review next quarter',
   'Confirm attendees and ask who signs off on the budget during the demo.', 'high'),
  (4, 6, '-20d 16:00', 'S',
   'Aisha is comparing us with a competitor and has gone quiet for almost three weeks.',
   'yes', 'Competitor: evaluating their current vendor''s renewal offer',
   'Send the side-by-side comparison and ask for a 20-minute call this week.', 'low'),
  (5, 11, '-4d 11:30', 'R',
   'Grace has budget approval and a decision date this month; a strong fit for a seasonal team.',
   'yes', 'Price: per-seat vs. flat pricing',
   'Send a proposal with both pricing options before Friday.', 'high'),
  (6, 18, '-18d 15:00', 'R',
   'No budget approved and no reply for over two weeks; the deal is at risk.',
   'unknown', 'Budget: not approved for this year',
   'Ask James who owns the budget decision and offer a smaller starter plan.', 'low'),
  (7, 28, '-10d 11:00', 'S',
   'Qualified with budget; the security review is the gating step before a demo.',
   'yes', 'Other: security review before purchase',
   'Return the security questionnaire and propose two demo dates.', 'medium'),
  (8, 29, '-3d 11:30', 'S',
   'Engaged owner with a clear spreadsheet pain; demo booked for tomorrow.',
   'yes', 'None recorded',
   'Run the demo around their weekly sales meeting and send a proposal the same day.', 'high');

-- ---------------------------------------------------------------------------
-- Insert (user triggers off: explicit, backdated rows)
-- ---------------------------------------------------------------------------
set session_replication_role = replica;

insert into public.prospects (
  id, name, company, email, phone, stage, decision_maker_status, objections, objection_notes, notes,
  follow_up_date, demo_at, close_reason, close_notes, closed_at, deal_value, currency, owner_id, created_by,
  last_activity_at, created_at, updated_at
)
select
  pg_temp.prospect_id(p.n), p.name, p.company, p.email, p.phone, l.stage, p.dm, p.objections, p.objection_notes, p.notes,
  null, pg_temp.seed_at(p.demo),
  case when l.stage in ('closed_won', 'closed_lost') then l.reason end,
  case when l.stage in ('closed_won', 'closed_lost') then p.close_notes end,
  case when l.stage in ('closed_won', 'closed_lost') then pg_temp.seed_at(l.at) end,
  p.deal_value, p.currency, pg_temp.seed_user(p.owner), pg_temp.seed_user(f.by),
  pg_temp.seed_at(f.at), pg_temp.seed_at(f.at), pg_temp.seed_at(f.at)
from seed_prospects p
join seed_moves f on f.n = p.n and f.seq = 0
join lateral (
  select m.stage, m.reason, m.at from seed_moves m where m.n = p.n order by m.seq desc limit 1
) l on true
on conflict (id) do nothing;

-- stage_history: one row per move (first row = creation, from_stage null).
insert into public.stage_history (id, prospect_id, from_stage, to_stage, changed_by, changed_at, close_reason, note)
select
  pg_temp.seed_uuid('stage_history:' || m.n || ':' || m.seq), pg_temp.prospect_id(m.n),
  lag(m.stage) over (partition by m.n order by m.seq), m.stage,
  pg_temp.seed_user(m.by), pg_temp.seed_at(m.at), m.reason, m.note
from seed_moves m
on conflict (id) do nothing;

-- stage_change activity per move (what the prospects trigger writes).
insert into public.activities (id, prospect_id, user_id, type, content, metadata, occurred_at, created_at)
select
  pg_temp.seed_uuid('stage_change:' || m.n || ':' || m.seq), pg_temp.prospect_id(m.n), pg_temp.seed_user(m.by),
  'stage_change', m.note,
  jsonb_build_object('from', m.prev, 'to', m.stage, 'close_reason', m.reason),
  pg_temp.seed_at(m.at), pg_temp.seed_at(m.at)
from (
  select s.*, lag(s.stage) over (partition by s.n order by s.seq) as prev from seed_moves s
) m
where m.seq > 0
on conflict (id) do nothing;

-- owner_change activities (manager reassignment).
insert into public.activities (id, prospect_id, user_id, type, content, metadata, occurred_at, created_at)
select
  pg_temp.seed_uuid('owner_change:' || o.n || ':' || o.at), pg_temp.prospect_id(o.n), pg_temp.seed_user(o.by),
  'owner_change', null,
  jsonb_build_object('from_owner', pg_temp.seed_user(o.from_owner), 'to_owner', pg_temp.seed_user(o.to_owner)),
  pg_temp.seed_at(o.at), pg_temp.seed_at(o.at)
from seed_owner_changes o
on conflict (id) do nothing;

-- Human activities.
insert into public.activities (id, prospect_id, user_id, type, content, metadata, occurred_at, created_at)
select
  pg_temp.seed_uuid('activity:' || a.n || ':' || a.type || ':' || a.at), pg_temp.prospect_id(a.n), pg_temp.seed_user(a.by),
  a.type, a.content,
  case when a.type = 'demo' then '{"demo_attended": true}'::jsonb else '{}'::jsonb end,
  pg_temp.seed_at(a.at), pg_temp.seed_at(a.at)
from seed_activities a
on conflict (id) do nothing;

-- Follow-ups (owner + creator = the prospect's current owner).
insert into public.follow_ups (
  id, prospect_id, owner_id, due_date, note, status, completed_at, completed_by, created_by, created_at, updated_at
)
select
  pg_temp.seed_id('33333333-3333-4333-8333-', f.id), pg_temp.prospect_id(f.n), pg_temp.seed_user(p.owner),
  public.org_today() + f.due, f.note,
  case when f.done is null then 'pending' else 'completed' end::public.follow_up_status,
  pg_temp.seed_at(f.done),
  case when f.done is not null then pg_temp.seed_user(p.owner) end,
  pg_temp.seed_user(p.owner),
  pg_temp.seed_at(f.created), coalesce(pg_temp.seed_at(f.done), pg_temp.seed_at(f.created))
from seed_follow_ups f
join seed_prospects p on p.n = f.n
on conflict (id) do nothing;

-- follow_up activity per completed follow-up (what completeFollowUp logs).
insert into public.activities (id, prospect_id, user_id, type, content, metadata, occurred_at, created_at)
select
  pg_temp.seed_uuid('follow_up:' || f.id), f.prospect_id, f.completed_by, 'follow_up',
  coalesce(s.outcome, f.note),
  jsonb_build_object('follow_up_id', f.id, 'due_date', f.due_date, 'task', f.note),
  f.completed_at, f.completed_at
from public.follow_ups f
join seed_follow_ups s on pg_temp.seed_id('33333333-3333-4333-8333-', s.id) = f.id
where f.status = 'completed'
on conflict (id) do nothing;

-- AI insights + their ai_insight activities (what record_ai_insight writes).
insert into public.ai_insights (
  id, prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model,
  created_by, created_at
)
select
  pg_temp.seed_id('44444444-4444-4444-8444-', i.id), pg_temp.prospect_id(i.n), i.summary, i.dm, i.main_objection,
  i.next_step, i.health, 'seed-data', pg_temp.seed_user(i.by), pg_temp.seed_at(i.at)
from seed_insights i
on conflict (id) do nothing;

insert into public.activities (id, prospect_id, user_id, type, content, metadata, occurred_at, created_at)
select
  pg_temp.seed_uuid('ai_insight:' || i.id), i.prospect_id, i.created_by, 'ai_insight', i.summary,
  jsonb_build_object('insight_id', i.id, 'deal_health', i.deal_health),
  i.created_at, i.created_at
from public.ai_insights i
join seed_insights s on pg_temp.seed_id('44444444-4444-4444-8444-', s.id) = i.id
on conflict (id) do nothing;

-- Derived columns (normally maintained by triggers).
update public.prospects p
   set follow_up_date = (
         select min(f.due_date) from public.follow_ups f
         where f.prospect_id = p.id and f.status = 'pending'
       ),
       last_activity_at = greatest(p.created_at, coalesce((
         select max(a.occurred_at) from public.activities a
         where a.prospect_id = p.id
           and a.type in ('call', 'conversation', 'note', 'demo', 'follow_up', 'stage_change')
       ), p.created_at))
 where p.id in (select pg_temp.prospect_id(n) from seed_prospects);

update public.prospects p
   set updated_at = greatest(p.last_activity_at, coalesce((
         select max(a.occurred_at) from public.activities a where a.prospect_id = p.id
       ), p.created_at))
 where p.id in (select pg_temp.prospect_id(n) from seed_prospects);

set session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- Consistency checks: any failure aborts `npm run db:reset`.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids uuid[] := array(select pg_temp.prospect_id(n) from seed_prospects);
  v_bad text;
begin
  if (select count(*) from public.prospects where id = any (v_ids)) <> 40 then
    raise exception 'seed: expected 40 prospects';
  end if;

  -- History chain: first row from null at created_at; each from = previous to; last to = current stage.
  select string_agg(distinct p.name, ', ') into v_bad
  from public.prospects p
  join lateral (
    select h.*, lag(h.to_stage) over (order by h.changed_at, h.id) as prev_to,
           row_number() over (order by h.changed_at, h.id) as rn,
           count(*) over () as total
    from public.stage_history h where h.prospect_id = p.id
  ) h on true
  where p.id = any (v_ids)
    and (
      (h.rn = 1 and (h.from_stage is not null or h.changed_at <> p.created_at or h.changed_by is distinct from p.created_by))
      or (h.rn > 1 and h.from_stage is distinct from h.prev_to)
      or (h.rn = h.total and h.to_stage <> p.stage)
      or h.changed_at > now()
      or (h.to_stage in ('closed_won', 'closed_lost')) <> (h.close_reason is not null)
    );
  if v_bad is not null then raise exception 'seed: inconsistent stage history: %', v_bad; end if;

  -- Exactly one stage_change activity per non-initial history row (same time, user, from/to).
  select string_agg(distinct p.name, ', ') into v_bad
  from public.prospects p
  where p.id = any (v_ids)
    and (
      (select count(*) from public.stage_history h where h.prospect_id = p.id and h.from_stage is not null)
      <> (select count(*) from public.activities a where a.prospect_id = p.id and a.type = 'stage_change')
      or exists (
        select 1 from public.stage_history h
        where h.prospect_id = p.id and h.from_stage is not null
          and (select count(*) from public.activities a
               where a.prospect_id = p.id and a.type = 'stage_change' and a.occurred_at = h.changed_at
                 and a.user_id is not distinct from h.changed_by
                 and a.metadata ->> 'from' = h.from_stage::text and a.metadata ->> 'to' = h.to_stage::text
                 and a.metadata ->> 'close_reason' is not distinct from h.close_reason) <> 1
      )
    );
  if v_bad is not null then raise exception 'seed: stage_change activities do not match history: %', v_bad; end if;

  -- Outcome: closed ⇔ reason + closed_at = time of the last move (with that reason); open ⇒ none.
  select string_agg(p.name, ', ') into v_bad
  from public.prospects p
  join lateral (
    select h.changed_at, h.close_reason from public.stage_history h
    where h.prospect_id = p.id order by h.changed_at desc, h.id desc limit 1
  ) last_move on true
  where p.id = any (v_ids)
    and case when p.stage in ('closed_won', 'closed_lost')
          then p.closed_at is distinct from last_move.changed_at
               or p.close_reason is distinct from last_move.close_reason
          else p.closed_at is not null or p.close_reason is not null or p.close_notes is not null
        end;
  if v_bad is not null then raise exception 'seed: inconsistent close fields: %', v_bad; end if;

  -- Derived columns.
  select string_agg(p.name, ', ') into v_bad
  from public.prospects p
  where p.id = any (v_ids)
    and (
      p.follow_up_date is distinct from (
        select min(f.due_date) from public.follow_ups f where f.prospect_id = p.id and f.status = 'pending')
      or p.last_activity_at <> greatest(p.created_at, coalesce((
        select max(a.occurred_at) from public.activities a
        where a.prospect_id = p.id
          and a.type in ('call', 'conversation', 'note', 'demo', 'follow_up', 'stage_change')), p.created_at))
      or p.last_activity_at > now()
      or p.created_at > now()
    );
  if v_bad is not null then raise exception 'seed: derived columns out of date: %', v_bad; end if;

  -- Activities between creation and now; every completion / insight logged.
  select string_agg(distinct p.name, ', ') into v_bad
  from public.prospects p
  join public.activities a on a.prospect_id = p.id
  where p.id = any (v_ids) and (a.occurred_at < p.created_at or a.occurred_at > now());
  if v_bad is not null then raise exception 'seed: activity outside the prospect lifetime: %', v_bad; end if;

  if exists (
    select 1 from public.follow_ups f
    where f.prospect_id = any (v_ids) and f.status = 'completed'
      and not exists (
        select 1 from public.activities a
        where a.prospect_id = f.prospect_id and a.type = 'follow_up'
          and a.metadata ->> 'follow_up_id' = f.id::text and a.occurred_at = f.completed_at)
  ) then
    raise exception 'seed: completed follow-up without a follow_up activity';
  end if;

  if exists (
    select 1 from public.ai_insights i
    where i.prospect_id = any (v_ids)
      and (i.created_at > now() - interval '10 minutes'
           or not exists (
             select 1 from public.activities a
             where a.prospect_id = i.prospect_id and a.type = 'ai_insight'
               and a.metadata ->> 'insight_id' = i.id::text and a.occurred_at = i.created_at))
  ) then
    raise exception 'seed: AI insight without an ai_insight activity (or too recent)';
  end if;

  -- Pending follow-ups belong to open deals and their owner; completed ones are in the past.
  if exists (
    select 1 from public.follow_ups f join public.prospects p on p.id = f.prospect_id
    where p.id = any (v_ids)
      and ((f.status = 'pending' and (p.stage in ('closed_won', 'closed_lost') or f.owner_id <> p.owner_id))
           or f.completed_at > now() or f.created_at > now())
  ) then
    raise exception 'seed: invalid follow-up (closed deal, wrong owner or future timestamp)';
  end if;

  -- Booked demos are in the future; every rep has every stage; no manager-owned deals.
  if exists (select 1 from public.prospects p where p.id = any (v_ids) and p.stage = 'demo_booked'
             and (p.demo_at is null or p.demo_at <= now())) then
    raise exception 'seed: demo_booked prospect without a future demo';
  end if;
  if (select count(distinct (p.owner_id, p.stage)) from public.prospects p where p.id = any (v_ids)) <> 18
     or exists (select 1 from public.prospects p join public.users u on u.id = p.owner_id
                where p.id = any (v_ids) and u.role <> 'sales_rep') then
    raise exception 'seed: each rep must own prospects in all 9 stages (and only reps own prospects)';
  end if;
end;
$$;

drop table seed_prospects, seed_moves, seed_owner_changes, seed_activities, seed_follow_ups, seed_insights;
