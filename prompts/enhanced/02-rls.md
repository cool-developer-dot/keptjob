# Prompt 2 (enhanced): Row Level Security

Source: `BUILD_PROMPTS.md` → "Prompt 2: Row Level Security". `SPEC.md` §4 (users, roles, permissions) is the source of truth; if this plan conflicts with it, SPEC.md wins. Nothing from SPEC §14 may be added.

Goal: RLS is the security boundary for every API request (`anon` / `authenticated` via PostgREST, GraphQL and Realtime). Reps see and manage only their own prospects and the child rows; managers see everything and can reassign; append-only tables really are append-only; `anon` gets nothing. Covered by pgTAP tests with manager **M**, rep **A**, rep **B**; Prompt 1 tests stay green; `npm run verify` green.

---

## 0. What Prompt 1 already built (do not rebuild)

- `public.is_manager()` — already `language sql stable security definer set search_path = ''`, reads `public.users.role` for `auth.uid()` (false when null). Reused as-is (signature unchanged).
- Trigger functions that write other tables are `security definer` and owned by `postgres` (table owner + `BYPASSRLS`), so they keep working under RLS: stage_history + `stage_change`/`owner_change` activities, `last_activity_at`, `follow_up_date`, pending follow-ups moved on reassignment, auth ⇄ public role/email sync.
- `prospects_before_update` already raises `42501 'Only managers can reassign prospects'` when `owner_id` changes, `auth.uid()` is not null and the caller is not a manager.
- `protect_last_manager` raises `P0001 'At least one manager must remain'`.
- RPC `move_prospect_stage(...)` is `security invoker` (RLS applies; an invisible prospect → `P0002 'Prospect not found'`).
- View `prospects_with_flags` is `security_invoker = true` (RLS of prospects applies).

## 1. Pitfalls and design decisions (read first)

1. **New migration** `supabase/migrations/20261006120000_rls.sql` (Prompt 1 files are not edited).
2. **No RLS recursion.** Policies never query an RLS-protected table directly: `users` policies call `is_manager()` (security definer → reads `users` as owner, bypassing RLS); child-table policies call `can_access_prospect()` (security definer). Both `set search_path = ''`, `stable`.
3. **`can_access_prospect(p_prospect_id uuid) returns boolean`** — `language sql stable security definer set search_path = ''`: `exists(select 1 from public.prospects p where p.id = p_prospect_id and (p.owner_id = auth.uid() or public.is_manager()))`. Returns false for unknown ids, so it leaks nothing.
4. **Performance:** in `prospects` policies wrap per-statement calls as `(select auth.uid())` / `(select public.is_manager())` so they are evaluated once (initPlan), not per row.
5. **Grants are part of the boundary (defense in depth).** Supabase grants `ALL` on public tables/views and `EXECUTE` on functions to `anon` and `authenticated` by default. This migration:
   - `revoke all` on all public tables/views/sequences from `anon` **and** `authenticated`, then grants back exactly what the policies need (below). "No insert/delete/update via API" is therefore enforced twice: no grant **and** no policy (permission denied `42501` instead of a silent 0-row no-op).
   - `revoke execute` on all public functions from `public, anon, authenticated`; grant `execute` back to `authenticated` only for `is_manager()`, `can_access_prospect(uuid)`, `org_today()`, `move_prospect_stage(...)`. Trigger functions need no `EXECUTE` at fire time; `refresh_prospect_follow_up_date` stays internal. `service_role` keeps its explicit grants.
   - `alter default privileges for role postgres in schema public revoke all on tables / sequences / functions from anon` so future objects don't leak to `anon`. (Functions still get `EXECUTE` via `PUBLIC` by default → every new function must `revoke execute ... from public, anon` explicitly; documented in CLAUDE.md.)
6. **Column-level grants protect derived/system columns** (CLAUDE.md: "never write from the app"). Writing a non-granted column fails with `42501`:
   - `users`: `update (full_name, role)` only (email/id/timestamps are system-managed).
   - `org_settings`: `update (default_currency, timezone, stale_days)` (`updated_by/updated_at` by trigger).
   - `prospects`: `insert` (plus `id`; the other insert grants below include `id` too) and `update` on `name, company, email, phone, stage, decision_maker_status, objections, objection_notes, notes, demo_at, close_reason, close_notes, deal_value, currency, owner_id` — **not** `follow_up_date, last_activity_at, closed_at, created_by, created_at, updated_at` (stale flag, win-rate periods and funnel periods depend on them).
   - `follow_ups`: `insert (id, prospect_id, owner_id, due_date, note, status, completed_at, completed_by)`, `update (due_date, note, status, completed_at, completed_by)` (owner moves only via reassignment trigger; `prospect_id` immutable).
   - `activities`: `insert (id, prospect_id, user_id, type, content, metadata, occurred_at)`.
   - `ai_insights`: `insert (id, prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model, created_by)` — `created_at` not writable, so Prompt 11's rate limit (`created_by, created_at`) can't be bypassed.
   - `select` is granted on all columns of every table and the view.
7. **Role-change block trigger** (`users_before_update_guard`, BEFORE UPDATE on `public.users`, security definer): when `auth.uid()` is **not null** — role changed and not `is_manager()` → `42501 'Only managers can change roles'`; `full_name` changed on another user's row → `42501 'Users can only change their own name'`. When `auth.uid()` is null (service role, GoTrue `auth.admin.updateUserById` → `handle_auth_user_updated` sync, seed/migrations) everything is allowed, so the Prompt 4 admin path and the auth→public role sync keep working. A manager may change their own role; the last-manager guard still applies.
8. **Prospects owner check** stays in `prospects_before_update` (allows managers + system). RLS adds `with check (owner_id = auth.uid() or is_manager())`, so a rep can neither insert a prospect for someone else nor hand one away. BEFORE triggers run before `WITH CHECK`, so an omitted `owner_id` on insert is filled from `auth.uid()` first.
9. **Activities type restriction:** the insert policy also requires `type not in ('stage_change', 'owner_change')` — those are only written by the security-definer triggers (CLAUDE.md: "never insert those from the app"), so a rep can't fake timeline events. `call/conversation/note/demo/follow_up/ai_insight` remain insertable.
10. **Cascades still work:** a manager deleting a prospect cascades to activities/stage_history/ai_insights/follow_ups via FK actions, which run as the table owner (no delete grant/policy needed on child tables).
11. **RPC review:** `move_prospect_stage` is security invoker → its `select ... for update` and `update` obey RLS (needs the column `update` grant, which `stage/close_reason/close_notes` have). `org_today()`, `is_manager()`, `can_access_prospect()` are security definer but only return a date/boolean about the caller. No other callable functions exist.
12. **Silent vs. error:** USING-clause mismatches (select/update/delete someone else's row) are silent (0 rows) — tests assert row counts/unchanged data. Missing grants and failed `WITH CHECK` raise `42501` — tests use `throws_ok(..., '42501')`.
13. **Realtime (Prompt 9):** add `public.prospects` to the `supabase_realtime` publication (guarded: only if the publication exists and the table isn't already a member). Harmless now; Realtime applies RLS select policies per subscriber.
14. **Tests run as the real API role:** `set local role authenticated` + `request.jwt.claims` (`{"sub": <id>, "role": "authenticated"}`); setup rows are inserted as `postgres` (BYPASSRLS). Prompt 1 tests run as `postgres` and are unaffected (assertions must not be weakened).

## 2. Policies (all `to authenticated`; `anon` has none)

| Table | select | insert | update | delete |
|---|---|---|---|---|
| `org_settings` | `true` | — (no grant) | `is_manager()` (using + check) | — |
| `users` | `true` | — (no grant) | `id = auth.uid() or is_manager()` + guard trigger (§1.7) | — |
| `prospects` | `owner_id = auth.uid() or is_manager()` | check `owner_id = auth.uid() or is_manager()` | using + check `owner_id = auth.uid() or is_manager()` | `is_manager()` |
| `activities` | `can_access_prospect(prospect_id)` | check `can_access_prospect(prospect_id) and user_id = auth.uid() and type not in ('stage_change','owner_change')` | — (no grant) | — |
| `follow_ups` | `can_access_prospect(prospect_id)` | check `can_access_prospect(prospect_id)` | using + check `can_access_prospect(prospect_id)` | `can_access_prospect(prospect_id)` |
| `stage_history` | `can_access_prospect(prospect_id)` | — | — | — |
| `ai_insights` | `can_access_prospect(prospect_id)` | check `can_access_prospect(prospect_id) and created_by = auth.uid()` | — | — |
| view `prospects_with_flags` | select grant only (security_invoker → prospects RLS) | | | |

RLS is enabled on **every** table in `public`.

## 3. Tests — `supabase/tests/rls.test.sql` (pgTAP)

Setup (as postgres): users M (manager), A, B (reps) via `auth.users`; prospects PA (owner A) and PB (owner B) with an activity, a pending follow-up and an ai_insight each.

1. RLS enabled on all 7 public tables; `anon` has no table privilege on any table/view and cannot `select` from prospects / execute `is_manager()` (42501).
2. **A cannot see/update B's data:** A sees only PA in `prospects` and `prospects_with_flags`; A sees no PB rows in activities, follow_ups, stage_history, ai_insights; `can_access_prospect(PB)` false for A, true for M; update of PB / PB's follow-up affects 0 rows; delete of PB's follow-up affects 0 rows; insert of activity / follow-up / ai_insight on PB → 42501; `move_prospect_stage(PB, …)` as A → P0002.
3. **A's own data works:** insert prospect (owner defaults to A); insert activity, follow-up, ai_insight on PA; update/complete own follow-up; insert prospect with `owner_id = B` → 42501; activity with `user_id = B` → 42501; activity of type `stage_change` → 42501; ai_insight with `created_by = B` → 42501.
4. **A cannot change owner_id** (42501) and **cannot delete a prospect** (0 rows, PA still exists). Writing a derived column (`last_activity_at`) → 42501.
5. **M sees all** prospects/child rows and **reassigns PA A→B**: pending follow-up owner becomes B, completed one stays A, an `owner_change` activity by M exists; afterwards A no longer sees PA, B does. M can delete a prospect (cascade).
6. **Nobody can update/delete stage_history or activities** (as M and A → 42501), nor insert into stage_history (42501); ai_insights update/delete → 42501.
7. **Users:** A can update own `full_name`; A cannot update B's name (0 rows); **A cannot change their own role** (42501); A cannot insert/delete users (42501); M can change A's role (and it syncs to `auth.users.raw_app_meta_data`); **the last manager cannot be demoted** (M demotes self → P0001); system path (no `auth.uid()`, auth app_metadata update) still syncs roles.
8. **org_settings:** A can select; A's update is a no-op (0 rows); M's update succeeds; insert → 42501.
9. `prospects` is in the `supabase_realtime` publication.

Also: `npm run test:db` runs both `schema.test.sql` (113 Prompt 1 tests, unchanged) and `rls.test.sql`.

## 4. Steps

1. Write the migration. 2. `npm run db:reset` (clean). 3. Write `rls.test.sql`; `npm run test:db` until green (both files). 4. `npm run db:types` (adds `can_access_prospect`). 5. Smoke-check that a GoTrue admin-created user still gets a `public.users` row (trigger functions without EXECUTE grants still fire). 6. `npm run verify`. 7. Update CLAUDE.md (grants/column conventions, new-function rule), BUILD_PROGRESS.md row 2. 8. Commit.

## 5. Verification checklist ("Done when")

- [ ] `npm run db:reset` applies all 3 migrations with no errors.
- [ ] `npm run test:db` passes: A cannot select/update B's prospects or their child rows · A cannot change owner_id · A cannot delete a prospect · M sees all and can reassign A→B (pending follow-ups move to B, an owner_change activity exists) · nobody can update/delete stage_history or activities · A cannot change their own role · the last manager cannot be demoted — plus the extra cases in §3; Prompt 1 schema tests still pass unchanged.
- [ ] `npm run db:types` regenerated.
- [ ] `npm run verify` passes.
- [ ] Committed locally; local Supabase left running.
