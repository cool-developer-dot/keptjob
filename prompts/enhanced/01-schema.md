# Prompt 1 (enhanced): Database schema + triggers

Source: `BUILD_PROMPTS.md` → "Prompt 1: Database schema + triggers". `SPEC.md` (§2–§9) is the source of truth; if this plan conflicts with it, SPEC.md wins. Nothing from SPEC §14 may be added.

Goal: one clean, reproducible Postgres schema for the CRM (enums, tables, constraints, functions, triggers, indexes, flags view) that later prompts build on **without rework**, covered by pgTAP tests, with generated TypeScript types, and `npm run verify` green.

---

## 0. Pitfalls and design decisions (read first)

1. **File layout.** Two migrations, applied in order by `npm run db:reset`:
   - `supabase/migrations/20261005120000_schema.sql` — enums, tables, constraints, indexes, default `org_settings` row.
   - `supabase/migrations/20261005120100_functions_triggers.sql` — helper functions, trigger functions, triggers, the flags view, the `move_prospect_stage` RPC.
   RLS is **not** enabled here (Prompt 2), but every function is written so Prompt 2 only has to add policies.
2. **`is_manager()` is defined here** (the prospects BEFORE UPDATE trigger needs it): `language sql stable security definer set search_path = ''`, returns `exists(select 1 from public.users where id = auth.uid() and role = 'manager')` (false when `auth.uid()` is null). Prompt 2 reuses it as-is (`create or replace` allowed, signature must not change). `can_access_prospect()` is left to Prompt 2.
3. **Every function** is `set search_path = ''` and fully schema-qualifies objects (`public.`, `auth.`, `pg_catalog` builtins are implicit). Trigger functions that write to *other* tables (stage_history, activities, follow_ups, prospects, users, auth.users) are `security definer`, so they keep working once RLS denies direct writes (stage_history has no insert policy in Prompt 2; activities insert requires `user_id = auth.uid()`).
4. **`auth.uid()` can be null** (seed SQL, migrations, service-role scripts, pgTAP). Rules:
   - prospects `created_by := coalesce(auth.uid(), new.created_by)`; `owner_id := coalesce(new.owner_id, auth.uid())` → `owner_id` is NOT NULL, so a system insert must pass an owner explicitly (clear not-null error otherwise).
   - Owner change is allowed when `auth.uid() is null` (system/service role — the API's `anon`/`authenticated` roles are always constrained by RLS from Prompt 2) **or** `is_manager()`; otherwise `raise exception 'Only managers can reassign prospects' using errcode = '42501'`.
   - stage_history `changed_by`: on UPDATE `auth.uid()`; on INSERT `coalesce(auth.uid(), new.created_by)`. Null only for seed/system writes.
5. **Close-reason CHECK vs reopen.** Constraints are evaluated *after* BEFORE triggers, so the BEFORE UPDATE trigger clears `close_reason`, `close_notes`, `closed_at` when the stage leaves `closed_won/closed_lost`; an `UPDATE prospects SET stage = 'contacted'` on a closed deal therefore passes the CHECK. History keeps the old values (stage_history rows are never touched).
   - Moving into a closed stage (from any *different* stage, incl. `closed_won` ↔ `closed_lost`) sets `closed_at := now()`. The caller must supply a valid `close_reason` in the same update; the CHECK rejects a missing/wrong-list reason.
   - INSERT directly into a closed stage (seed): `closed_at := coalesce(new.closed_at, now())`.
   - Extra consistency CHECK `prospects_closed_fields_check`: `closed_at is not null` ⇔ stage closed, and `close_notes is null` when open.
6. **`close_reason` is `text`** (won reasons are "proposed defaults the client can change" → changing them later is a one-line CHECK change, not an enum migration). CHECK `prospects_close_reason_check`:
   - `stage = 'closed_won'` ⇒ `close_reason in ('product_fit','price_value','relationship','urgent_need','other')`
   - `stage = 'closed_lost'` ⇒ `close_reason in ('price','timing','competitor','no_budget','no_response','not_a_fit','other')`
   - otherwise ⇒ `close_reason is null`.
7. **Stage-change `note`.** `stage_history.note` is not a prospect column. The AFTER UPDATE trigger reads it from the transaction-local setting `app.stage_change_note` (`nullif(current_setting('app.stage_change_note', true), '')`). The RPC `public.move_prospect_stage(p_prospect_id uuid, p_to_stage pipeline_stage, p_close_reason text default null, p_close_notes text default null, p_note text default null) returns public.prospects` (**security invoker**, so RLS applies) sets that setting, performs the update and resets the setting. Prompt 5's `moveProspectStage` action calls this RPC. Same-stage call = no-op returning the row (no history). Not found / not visible → `raise exception 'Prospect not found' using errcode = 'P0002'`. When `p_to_stage` is not closed, `close_reason/close_notes` are forced to null. The note is also used as the `stage_change` activity `content`.
8. **No trigger recursion.** Chains are bounded and every derived write is guarded with `IS DISTINCT FROM`:
   - activities AFTER INSERT → `UPDATE prospects SET last_activity_at` (only when it increases) → prospects AFTER UPDATE sees no stage/owner change → stops.
   - follow_ups AFTER I/U/D → `UPDATE prospects SET follow_up_date` (only when different) → stops.
   - prospects AFTER UPDATE (owner change) → `UPDATE follow_ups SET owner_id` (pending only) → follow_ups trigger recomputes the same date → no prospects write → stops.
   - prospects AFTER UPDATE (stage change) → INSERT activity `stage_change` → bumps `last_activity_at` → stops.
   - public.users role ↔ auth.users `raw_app_meta_data.role` sync: each side only writes when the value differs.
9. **`last_activity_at`** = `greatest(last_activity_at, least(occurred_at, now()))` only for `call, conversation, note, demo, follow_up, stage_change` (not `ai_insight`, `owner_change`). Future `occurred_at` is clamped to `now()`; back-dated activities never move it backwards.
10. **`org_today()`** = `(now() at time zone (select timezone from public.org_settings where id))::date`, `language sql stable security definer set search_path = ''`. `now() at time zone '<tz>'` yields the local wall-clock timestamp, so `::date` is the org-local date (correct across DST and UTC midnight). The default timezone exists only in the column default.
11. **Flags view** `public.prospects_with_flags` (`with (security_invoker = true)` — mandatory, otherwise the view would bypass Prompt 2's RLS): `select p.*, is_stale, has_overdue_follow_up` where
    - `is_stale = p.stage not in ('closed_won','closed_lost') and p.last_activity_at < now() - make_interval(days => stale_days)`
    - `has_overdue_follow_up = p.follow_up_date is not null and p.follow_up_date < public.org_today()` (equivalent to "exists a pending follow-up due before today" because `follow_up_date` = min pending due date; uses the index).
12. **Role source.** `handle_new_user` reads the role only from `raw_app_meta_data->>'role'`; any value other than `manager`/`sales_rep` (or missing) → `sales_rep`. `raw_user_meta_data` is used only for `full_name` (fallback: email local part). Prompt 4 invites with `inviteUserByEmail` (row created as `sales_rep`) and then sets `app_metadata.role` with `updateUserById` → an **auth.users AFTER UPDATE OF email, raw_app_meta_data** trigger syncs `email` and a valid `role` into `public.users`. The reverse sync (public.users role change → `auth.users.raw_app_meta_data.role`) keeps both places consistent when a manager changes a role in Settings (Prompt 4).
13. **Last manager.** `users` BEFORE UPDATE (role `manager` → other) and BEFORE DELETE (of a manager; this also fires when `auth.users` deletion cascades) take `pg_advisory_xact_lock(hashtext('public.users.last_manager'))` (serialises concurrent demotions) and raise `'At least one manager must remain'` (errcode `P0001`) if no *other* manager exists. Inserts are not restricted (bootstrapping).
14. **Role-change authorisation** (only managers may change roles) is Prompt 2's trigger; not added here.
15. **Defaults for authorship columns**: `prospects.created_by`, `activities.user_id`, `follow_ups.created_by`, `ai_insights.created_by` default to `auth.uid()` (Prompt 2's `with check` still enforces equality where required). `follow_ups.owner_id` defaults (BEFORE INSERT) to the prospect's owner when null; `follow_ups.created_by := coalesce(auth.uid(), new.created_by)`.
16. **User FKs on delete**: `prospects.owner_id`, `follow_ups.owner_id` → `restrict` (reassign first); all other user references (`created_by`, `completed_by`, `changed_by`, `user_id`, `updated_by`) → `set null`. All `prospect_id` FKs → `cascade`. `users.id → auth.users.id on delete cascade`.
17. **`updated_at`**: one generic `public.set_updated_at()` BEFORE UPDATE trigger on `org_settings`, `users`, `prospects`, `follow_ups`. `org_settings.updated_by := coalesce(auth.uid(), new.updated_by)` on update.
18. Note: `now()` is constant inside a transaction — tests that check "changed" timestamps must first back-date the value.
19. Realtime publication for prospects is Prompt 9's job (not added here). `seed.sql` is Prompt 3/14's job (config already lists it; `db reset` must still succeed without it).
20. Generated types: `npm run db:types` overwrites `src/lib/supabase/database.types.ts`; it must stay excluded from ESLint and pass `tsc`.

## 1. Enums (exact SPEC values and order)

| Enum | Values |
|---|---|
| `pipeline_stage` | prospect, contacted, conversation, qualified, demo_booked, demo_attended, follow_up, closed_won, closed_lost |
| `decision_maker_status` | yes, no, unknown |
| `objection_category` | price, timing, competitor, budget, no_authority, not_interested, other |
| `activity_type` | call, conversation, note, demo, follow_up, stage_change, owner_change, ai_insight |
| `follow_up_status` | pending, completed |
| `deal_health` | high, medium, low |
| `user_role` | manager, sales_rep |

## 2. Tables (all PKs `uuid default gen_random_uuid()` unless noted; all timestamps `timestamptz`, UTC)

**users** — `id uuid pk references auth.users(id) on delete cascade`, `full_name text not null default ''`, `email text not null`, `role user_role not null default 'sales_rep'`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.

**org_settings** (single row) — `id boolean primary key default true check (id)`, `default_currency char(3) not null default 'USD' check (default_currency ~ '^[A-Z]{3}$')`, `timezone text not null default 'America/New_York' check (timezone in (<7 allowed zones from SPEC §5>))`, `stale_days int not null default 14 check (stale_days between 1 and 365)`, `updated_at timestamptz not null default now()`, `updated_by uuid null references users on delete set null`. Migration inserts the default row (`insert ... default values on conflict do nothing`).

**prospects** — `name text not null check (btrim(name) <> '')`, `company`, `email`, `phone` (text, null), `stage pipeline_stage not null default 'prospect'`, `decision_maker_status decision_maker_status not null default 'unknown'`, `objections objection_category[] not null default '{}'`, `objection_notes text`, `notes text`, `follow_up_date date` (derived, see triggers), `demo_at timestamptz`, `close_reason text`, `close_notes text`, `closed_at timestamptz`, `deal_value numeric(12,2) null check (deal_value >= 0)`, `currency char(3) not null check (currency ~ '^[A-Z]{3}$')`, `owner_id uuid not null references users on delete restrict`, `created_by uuid null default auth.uid() references users on delete set null`, `last_activity_at timestamptz not null default now()`, `created_at`, `updated_at` (not null default now()). CHECKs from §0.5–0.6.

**activities** — `prospect_id uuid not null references prospects on delete cascade`, `user_id uuid null default auth.uid() references users on delete set null`, `type activity_type not null`, `content text null`, `metadata jsonb not null default '{}'`, `occurred_at timestamptz not null default now()`, `created_at timestamptz not null default now()`.

**follow_ups** — `prospect_id ... cascade`, `owner_id uuid not null references users on delete restrict`, `due_date date not null`, `note text not null`, `status follow_up_status not null default 'pending'`, `completed_at timestamptz`, `completed_by uuid references users on delete set null`, `created_by uuid default auth.uid() references users on delete set null`, `created_at`, `updated_at`. CHECK `follow_ups_completed_check: (status = 'completed') = (completed_at is not null)`.

**stage_history** — `prospect_id ... cascade`, `from_stage pipeline_stage null`, `to_stage pipeline_stage not null`, `changed_by uuid null references users on delete set null`, `changed_at timestamptz not null default now()`, `close_reason text null`, `note text null`.

**ai_insights** — `prospect_id ... cascade`, `summary text not null`, `decision_maker_status decision_maker_status not null`, `main_objection text not null`, `recommended_next_step text not null`, `deal_health deal_health not null`, `model text not null`, `created_by uuid default auth.uid() references users on delete set null`, `created_at timestamptz not null default now()`.

## 3. Indexes (every FK column covered as the leading column)

- prospects: `(owner_id)`, `(stage)`, `(follow_up_date)`, `(last_activity_at)`, `(created_by)`
- follow_ups: `(status, due_date)`, `(owner_id)`, `(prospect_id)`, `(completed_by)`, `(created_by)`
- activities: `(prospect_id, occurred_at desc)`, `(user_id)`
- stage_history: `(prospect_id, changed_at)`, `(changed_by)`
- ai_insights: `(prospect_id, created_at desc)`, `(created_by, created_at)` (also serves Prompt 11's rate limit)
- org_settings: `(updated_by)`

## 4. Functions and triggers (migration 2)

| Object | Kind | Behaviour |
|---|---|---|
| `set_updated_at()` | BEFORE UPDATE on org_settings, users, prospects, follow_ups | `new.updated_at := now()`; for org_settings also `updated_by := coalesce(auth.uid(), new.updated_by)` (separate small function `org_settings_before_update`) |
| `is_manager()` | sql, stable, security definer | §0.2 |
| `org_today()` | sql, stable, security definer | §0.10 |
| `handle_new_user()` | AFTER INSERT on auth.users, security definer | insert `public.users(id, email, full_name, role)` per §0.12; `on conflict (id) do nothing` |
| `handle_auth_user_updated()` | AFTER UPDATE OF email, raw_app_meta_data on auth.users, security definer | sync email; sync role when `raw_app_meta_data->>'role'` is a valid role and differs |
| `sync_user_role_to_auth()` | AFTER UPDATE OF role on public.users, security definer | write `role` into `auth.users.raw_app_meta_data` when it differs |
| `protect_last_manager()` | BEFORE UPDATE OF role / BEFORE DELETE on users | §0.13 |
| `prospects_before_insert()` | BEFORE INSERT on prospects | currency := org `default_currency` when null; `owner_id := coalesce(new.owner_id, auth.uid())`; `created_by := coalesce(auth.uid(), new.created_by)`; closed stage ⇒ `closed_at := coalesce(new.closed_at, now())` |
| `prospects_before_update()` | BEFORE UPDATE on prospects | owner change guard (§0.4); stage into closed (from a different stage) ⇒ `closed_at := now()`; stage out of closed ⇒ clear `close_reason`, `close_notes`, `closed_at` |
| `prospects_after_insert()` | AFTER INSERT, security definer | stage_history `(null → new.stage, changed_by = coalesce(auth.uid(), new.created_by), close_reason = new.close_reason)` |
| `prospects_after_update()` | AFTER UPDATE, security definer | stage changed ⇒ stage_history `(old.stage → new.stage, auth.uid(), new.close_reason, note)` + activity `stage_change` (`user_id = auth.uid()`, `content = note`, `metadata = {from, to, close_reason}`); owner changed ⇒ activity `owner_change` (`metadata = {from_owner, to_owner}`) + `update follow_ups set owner_id = new.owner_id where prospect_id = new.id and status = 'pending'` |
| `activities_after_insert()` | AFTER INSERT on activities, security definer | §0.9 |
| `follow_ups_before_insert()` | BEFORE INSERT on follow_ups | owner default + created_by (§0.15) |
| `follow_ups_after_change()` | AFTER INSERT/UPDATE/DELETE on follow_ups, security definer | recompute `prospects.follow_up_date = min(due_date) where status = 'pending'` (null if none) for the new and (on update/delete) old `prospect_id`, guarded by `is distinct from` |
| `move_prospect_stage(...)` | RPC, plpgsql, security invoker | §0.7 |
| `prospects_with_flags` | view, security_invoker | §0.11 |

## 5. Tests — `supabase/tests/schema.test.sql` (pgTAP, `npx supabase test db`, script `npm run test:db`)

Runs in one transaction (`begin; create extension if not exists pgtap with schema extensions; select plan(N); … select * from finish(); rollback;`). Creates test users by inserting into `auth.users` (exercises `handle_new_user`), simulates `auth.uid()` with `select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true)` and resets it to `''` for system writes. Cases:

1. All 7 enums have exactly the SPEC labels in order (`enum_has_labels`); 7 tables exist; the flags view exists.
2. org_settings: default row (USD, America/New_York, 14); rejects lowercase currency, a non-allowed timezone, stale_days 0 and 366, a second row.
3. `org_today()` = `(now() at time zone tz)::date` for the default tz and after switching to `Pacific/Honolulu`.
4. handle_new_user: role from `raw_app_meta_data`; `raw_user_meta_data.role = 'manager'` ignored; invalid app role → `sales_rep`; full_name from user metadata. auth app_metadata role update syncs to public.users; public.users role change syncs to auth app_metadata.
5. Last manager: demoting / deleting the only manager raises; with a second manager the demotion succeeds.
6. prospects BEFORE INSERT: currency taken from org default (switch org to `EUR`); owner_id and created_by from `auth.uid()`; insert creates one stage_history row `null → prospect` with `changed_by`.
7. **close_reason CHECK**: closed_won with a lost-only reason / with no reason fails; open stage with a reason fails; closed_won + `product_fit` and closed_lost + `no_budget` succeed; `closed_at` set on close.
8. **Auto stage_history on update**: `from/to/changed_by/close_reason` correct; a `stage_change` activity with metadata `{from,to,close_reason}`; backward + skipped moves are recorded; a non-stage update adds no history.
9. **Reopen clears close fields**: closed → `contacted` with only `stage` set succeeds, `close_reason/close_notes/closed_at` null, history still holds the old reason.
10. move_prospect_stage records `note` in stage_history and as activity content; same-stage call adds nothing.
11. Owner change: rep → raises (42501); manager → succeeds, `owner_change` activity with metadata, pending follow-ups moved, completed ones untouched.
12. **follow_up_date derivation**: insert later then earlier pending → min; complete the earliest → next; reschedule; delete all → null; follow_up owner defaults to prospect owner. `follow_ups_completed_check` rejects completed without `completed_at` and pending with `completed_at`.
13. **last_activity_at ignores ai_insight** (and owner_change); a `call` moves it forward; a back-dated call never moves it backwards; a future call is clamped to `now()`; stage_change bumps it.
14. Flags view: back-dated `last_activity_at` ⇒ `is_stale`; closed ⇒ not stale; pending follow-up due yesterday (org tz) ⇒ `has_overdue_follow_up`.
15. `updated_at` trigger bumps a back-dated `updated_at`.

Also a Vitest test `src/lib/supabase/database.types.test.ts` (runs without a DB) asserting the generated `Constants.public.Enums` equal the arrays in `src/lib/constants.ts` — catches drift between SQL enums and TS constants.

## 6. Steps

1. Write both migrations. 2. `npm run db:reset` (must apply cleanly, no errors). 3. Write the pgTAP file; add `"test:db": "supabase test db"` to package.json; run until green. 4. `npm run db:types`; add the Vitest enum-drift test. 5. `npm run verify`. 6. Update CLAUDE.md (DB test command, `move_prospect_stage`, `prospects_with_flags`, `app.stage_change_note`), BUILD_PROGRESS.md row 1. 7. Commit.

## 7. Verification checklist ("Done when")

- [ ] `npm run db:reset` applies both migrations with no errors.
- [ ] `npm run test:db` (pgTAP) passes — covers close_reason CHECK, stage_history on insert/update, reopen clears close fields, follow_up_date derivation, last_activity_at ignores ai_insight (+ the extra cases above).
- [ ] `npm run db:types` regenerated `src/lib/supabase/database.types.ts` with all tables, enums, the view and functions.
- [ ] `npm run verify` passes (typecheck, lint, vitest incl. enum-drift test, build) — and does not need the DB.
- [ ] Committed locally; no `.env*` files committed; local Supabase left running.
