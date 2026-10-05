# Prompt 10 (enhanced): Follow-ups page + stale deals

Source: `BUILD_PROMPTS.md` → "Prompt 10: Follow-ups page + stale deals". `SPEC.md` §6 (org timezone; "today" = `org_today()` / `time.ts`), §8 (follow-up views: due today, overdue = pending and due before today, upcoming, completed; completing logs a `follow_up` activity), §9.4 (flag due today / overdue in the org tz), §9.6 (stale = open deal with no human activity for `stale_days`; warning only), §4 (reps: own rows; managers: everything), §11 (Follow-ups page) are the source of truth; SPEC wins any conflict. Nothing from §14 (no reminders/emails/automatic messages, no automatic stage changes).

Goal: `/follow-ups` tells the salesperson who to contact (overdue / today / upcoming), what was done (completed), and which deals need attention (stale or no next step), with one-click complete → "schedule next" and reschedule. A sidebar badge shows how many of the user's own follow-ups are due today or overdue.

---

## 0. What already exists (reuse, do not rebuild)

- Actions (`src/server/actions/followUps.ts`): `completeFollowUp({ followUpId, note? })`, `rescheduleFollowUp({ followUpId, dueDate })`, `createFollowUp({ prospectId, dueDate, note })` — all call `revalidateProspect()` (/prospects, /pipeline, /follow-ups, /dashboard, /reports, /prospects/[id]).
- Reusable UI (`src/components/follow-ups/`): `FollowUpForm({ prospectId, defaultDueDate?, defaultNote?, submitLabel?, onDone?, onCancel? })` (default due org today + 1), `CompleteFollowUpButton` (popover + optional outcome note; toasts "Follow-up completed."), `RescheduleFollowUpButton` (date popover).
- SQL: `org_today()` (org-tz date), view `prospects_with_flags` (`is_stale`, `has_overdue_follow_up`; `follow_up_date` = earliest pending due date, null ⇔ no pending follow-up), `follow_ups (status, due_date)` index, `activities (prospect_id, occurred_at desc)` index, RLS via `can_access_prospect()`.
- TS: `orgToday`, `followUpBucket(due, tz, now)` (`overdue`/`today`/`upcoming` = today+1…today+`UPCOMING_DAYS` 7/`later`), `formatDateString` (due dates, no tz shift), `formatOrgDateTime`, `formatRelativeTime`, `addDaysToDateString`; `getOrgSettings()` (server) / `useOrgSettings()` (client); badges `StageBadge`, `StaleBadge`, `FollowUpBadge`; `listTeamData` (owner names); `PageHeader`; nav `NAV_ITEMS` / `NavLinks` / `MobileNav`.
- Seed (fixed ids, dates relative to `org_today()`): Riley — Jordan Lee overdue (−1), Priya Shah today, Tom Becker upcoming (+5), Marcus Chen stale (30 d) with no follow-up, Elena closed won. Sam — Aisha Khan overdue (−3) + stale (20 d), Liam O'Brien upcoming (+1), Sofia closed lost. No completed follow-ups, no activities.

## 1. Design decisions + pitfalls (read first)

### One bucketing definition (SQL), mirrored + parity-tested in TS
1. **The database is the single source of truth for tabs and counts.** Migration `20261008120000_follow_ups.sql`:
   - `public.follow_up_bucket(p_status follow_up_status, p_due_date date, p_completed_at timestamptz, p_now timestamptz, p_timezone text) returns text` — `immutable`, pure (today = `(p_now at time zone p_timezone)::date`):
     - pending: `due < today` → `overdue`; `= today` → `today`; `≤ today + 7` → `upcoming`; else `later`;
     - completed: org-tz date of `completed_at` ≥ today − 29 (**the 30 org calendar days ending today**) → `completed`; else null.
     Pure + explicit `now`/tz → the org-tz edge cases are testable in pgTAP without faking the clock.
   - View `public.follow_up_buckets` (`security_invoker = true` → follow_ups RLS): `f.*` + `bucket = follow_up_bucket(f.status, f.due_date, f.completed_at, now(), s.timezone)` (org timezone from `org_settings`, never hardcoded), pre-filtered to `pending or completed_at ≥ now() − 32 days` (old completed rows are never scanned/returned; the function decides exactly). `f.*` → recreate the view when follow_ups gains columns.
   - RPC `public.follow_up_bucket_counts(p_owner_id uuid default null)` (security invoker, stable) → one row `{ overdue, today, upcoming, completed }` (integers) from the **same view** (`p_owner_id` null → every row the caller can see).
   - Tab contents = `follow_up_buckets.bucket = <tab>`; counts = the RPC over the same view → counts and lists can't disagree.
   - View `public.latest_conversation_activities` (security_invoker): `distinct on (prospect_id)` newest `call`/`conversation`/`note` activity with non-blank content (`occurred_at desc, id desc`), columns `prospect_id, id, type, occurred_at, snippet = left(content, 280), content_length`. Partial index `activities (prospect_id, occurred_at desc, id desc) where type in ('call','conversation','note')`. Embedded (no N+1, no `.in(ids)` URL).
   - Grants: revoke from `public, anon`; views → `select` to `authenticated`; functions → `execute` to `authenticated`.
2. **TS mirror** `followUpViewBucket({ status, dueDate, completedAt }, tz, now)` + `COMPLETED_WINDOW_DAYS = 30` in `time.ts` (extends `followUpBucket`; used by the parity integration test and available to the Dashboard). Never use the browser timezone: the server passes `now` / tz.
3. **Pitfalls:** never `new Date().toLocaleDateString()` or `getDate()`; `due_date` is already an org-local calendar date → `formatDateString` (no tz shift); `completed_at` is an instant → `formatOrgDateTime(…, tz)`. A follow-up due at 11 pm New York time is still "today" in NY although UTC is already tomorrow; Honolulu is 5–6 h behind NY.

### Data functions (`src/server/data/follow-up-views.ts`, ctx pattern, reusable by the Dashboard)
4. `getFollowUpCountsData(ctx, { ownerId? })` → `{ overdue, today, upcoming, completed }` (RPC).
5. `getFollowUpBadgeCountData(ctx)` → overdue + today for `owner_id = ctx.user.id` (managers too: their own).
6. `listFollowUpsData(ctx, { tab: overdue|today|upcoming|completed, ownerId?, limit? })` → `{ rows, truncated }`; rows embed `prospect:prospects(id, name, company, stage, latest_conversation_activities(type, snippet, content_length, occurred_at))`. Order: pending tabs `due_date asc, created_at asc, id`; completed `completed_at desc, id`. Limit `FOLLOW_UPS_LIMIT` = 200 (+1 → `truncated`). "Contact today" for the Dashboard = `tab: "overdue" | "today"`.
7. `listNeedsAttentionData(ctx, { ownerId?, limit? })` → `{ rows, total }`: `prospects_with_flags`, `stage not in (closed_won, closed_lost)` and (`is_stale` or `follow_up_date is null`), `last_activity_at asc, id`, `count: "exact"`, embedded last conversation. `countNeedsAttentionData(ctx, { ownerId? })` (head count) for the tab label. Pure `needsAttentionReasons(row)` → `["stale", "no_follow_up"]` subset (labels "No activity for N days" / "No follow-up scheduled").
8. Owner filter (`ownerId`) is applied only for managers; reps are scoped by RLS (and a rep's `owner` URL param is ignored).

### Page `/follow-ups` (`src/app/(app)/follow-ups/`)
9. URL params (`parseFollowUpsParams` / `followUpsHref` in `src/lib/validation/follow-ups-page.ts`, pure, invalid → default): `tab` ∈ `overdue | today | upcoming | completed | attention` (default `overdue`, the first tab), `owner` (uuid, managers only).
10. Server page: `requireUser()`, settings, counts + attention count + team (managers) in parallel. Header + (managers) owner select (+ "All owners") + tab nav: links with counts (`Overdue 1`, `Today 1`, `Upcoming 1`, `Completed 0`, `Needs attention 1`), `aria-current="page"` on the active one, overdue count red when > 0. The list streams in `<Suspense key={tab+owner}>` with a skeleton (tab switches show the skeleton; header and counts stay). `loading.tsx` for the first load, `error.tsx` boundary.
11. Follow-up row: prospect name (link to `/prospects/[id]`), company, stage badge, due date (`formatDateString`) + relative ("3 days overdue" / "Today" / "in 2 days"), note, owner (managers), last conversation snippet (type label + truncated text + relative time, `title` = org-tz time; "No conversation logged yet" muted), actions Complete + Reschedule (pending tabs). Completed tab: completed at (org-tz) + "by" name instead of actions.
12. **Complete → schedule next:** `CompleteFollowUpButton` gets an optional `nextAction` prop → the success toast carries the action button "Schedule next follow-up" (longer duration, 10 s). Clicking it opens a page-level dialog (`useScheduleFollowUp()` hook in `src/components/follow-ups/schedule-follow-up-dialog.tsx`: `{ open({ prospectId, prospectName }), dialog }`, reusable by the Dashboard) with `FollowUpForm` prefilled for that prospect (due org today + 1). The dialog lives above the list, so it survives the completed row disappearing on refresh.
13. Reschedule: existing `RescheduleFollowUpButton` (date picker popover); the row moves to its new tab after the action's revalidation.
14. Needs attention rows: name link, company, stage, owner (managers), last activity (relative + org-tz title), reason badges (Stale "No activity for N days", "No follow-up scheduled"), next follow-up (`FollowUpBadge`), last conversation snippet, and an "Add follow-up" button (same dialog) for rows without a follow-up.
15. Empty states per tab ("No overdue follow-ups. Nice work." etc.). 375 px: rows stack (no page-level horizontal scroll).

### Sidebar badge
16. `(app)/layout.tsx` calls `getFollowUpBadgeCountData` (one cheap RPC over the user's own rows; failure → no badge, logged, never breaks the shell) and passes `badges={{ "/follow-ups": n }}` to `NavLinks` (desktop + mobile sheet). Count > 0 → small red pill with `aria-label="N follow-ups due today or overdue"`, `data-nav-badge`. The follow-up actions already revalidate; verify the badge updates after complete/reschedule (server-action responses re-render the layout). If not, revalidate the layout.

### Out of scope
Reminders/notifications/emails, bulk complete, editing notes inline, calendar views, recurring follow-ups, automatic stage changes.

## 2. Files

| File | Purpose |
|---|---|
| `supabase/migrations/20261008120000_follow_ups.sql` | bucket function, `follow_up_buckets` view, counts RPC, `latest_conversation_activities` view + partial index, grants |
| `supabase/tests/follow_ups.test.sql` | pgTAP: function edge cases (11 pm NY, DST, Honolulu, windows), view/RPC RLS (A/B/M), grants, latest conversation |
| `src/lib/supabase/database.types.ts` | regenerated |
| `src/lib/time.ts` + test | `followUpViewBucket`, `COMPLETED_WINDOW_DAYS`, `daysBetweenDateStrings` + edge-case tests |
| `src/lib/follow-ups.ts` + test | tabs, labels, `needsAttentionReasons`, `dueLabel`, `truncateSnippet` (pure) |
| `src/lib/validation/follow-ups-page.ts` + test | `parseFollowUpsParams`, `followUpsHref` |
| `src/server/data/follow-up-views.ts` | counts, badge, lists, needs attention |
| `src/components/follow-ups/schedule-follow-up-dialog.tsx` | `useScheduleFollowUp()` dialog |
| `src/components/follow-ups/follow-up-actions.tsx` | `nextAction` toast option |
| `src/components/app-shell/{nav-links,mobile-nav}.tsx`, `(app)/layout.tsx` | badge |
| `src/app/(app)/follow-ups/*` | page, tabs, owner filter, lists, skeleton, loading, error |
| `tests/integration/follow-ups.test.ts` | seed data per user (A/B/M), counts = list lengths, SQL ↔ TS parity, needs attention, badge |
| `e2e/follow-ups.spec.ts` | tabs/counts, complete + schedule next, reschedule, needs attention, badge |
| `CLAUDE.md`, `BUILD_PROGRESS.md` | notes, row 10 |

## 3. Steps
1. This plan. 2. Migration + pgTAP + `db:reset` + `db:types` + `test:db`. 3. Pure helpers + unit tests. 4. Data functions + integration tests. 5. UI (page, rows, dialog, badge). 6. Browser check (Riley + Morgan, desktop + 375 px). 7. e2e. 8. `verify`, `test:db`, `test:integration`, e2e; clean test data. 9. Docs + commit.

## 4. Verification checklist ("Done when")
- [x] Bucketing tests pass: pgTAP (SQL function) and vitest (TS mirror) incl. 11 pm New York (= next day UTC), DST spring-forward / fall-back nights, Honolulu, upcoming boundary (+7 in, +8 out), completed window (30 org days) edges.
- [x] Integration: data matches the seed — Riley overdue 1 / today 1 / upcoming 1 / completed 0, needs attention = Marcus (stale + no follow-up); Sam overdue 1 / upcoming 1, needs attention = Aisha (stale); Morgan sees both (overdue 2, today 1, upcoming 2), owner filter works, own badge 0; reps' badges 2 / 1; counts = list lengths; SQL bucket = TS mirror for every row.
- [x] Tabs with counts, tab in the URL (`?tab=`), owner column + filter for managers only, empty states, skeleton while switching.
- [x] Complete → toast "Schedule next follow-up" → dialog → new follow-up created (DB checked), counts/badge update.
- [x] Reschedule moves the row to the right tab.
- [x] Needs attention lists open stale / no-follow-up prospects, oldest activity first, with reasons.
- [x] Sidebar badge = own overdue + today, updates after actions; manager's badge counts only their own.
- [x] `npm run verify` passes; `test:db`, `test:integration`, e2e green; test data cleaned.
