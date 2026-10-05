# Prompt 12 (enhanced): Dashboard

Source: `BUILD_PROMPTS.md` → "Prompt 12: Dashboard". `SPEC.md` §1 (the 6 questions), §6 (org timezone: "today", dashboard dates, activity timestamps), §12 (pipeline value, win rate definitions; managers filter by rep, reps only their own numbers), §4 (RLS: reps own rows, managers everything), §9.6 (stale = warning only) are the source of truth; SPEC wins any conflict. Nothing from §14 (no automatic messages/emails/stage changes, no currency conversion, no charts beyond what is asked).

Goal: `/dashboard` answers the six SPEC §1 questions at a glance for the signed-in user (rep: own data; manager: team or one rep):

| SPEC §1 question | Dashboard section |
|---|---|
| 1. Who to contact | KPI tiles Due today / Overdue + **Contact today** list |
| 2. What happened in the last conversation | last conversation snippet in Contact today (+ **Recent activity** feed) |
| 3. What the main objection is | objection chips in Contact today |
| 4. What the next follow-up is | follow-up note + due date in Contact today; follow-up date in Deals needing attention |
| 5. What the AI recommends next | latest AI next step in Contact today + **Latest AI recommendations** |
| 6. Which deals need attention | KPI Stale deals + **Deals needing attention** (ranked, with reasons) |

---

## 0. What already exists (reuse, do not rebuild)

- `src/server/data/follow-up-views.ts`: `getFollowUpCountsData(ctx, { ownerId })` (RPC `follow_up_bucket_counts` → overdue/today, the **same definition** as the Follow-ups page + sidebar badge), `effectiveOwner` pattern (owner honoured for managers only), `toSnippet`, `ConversationSnippet`.
- SQL: `org_today()`, view `prospects_with_flags` (`is_stale`, `has_overdue_follow_up`, `follow_up_date` = earliest pending due date, null ⇔ no pending follow-up), view `follow_up_buckets` (bucket per follow-up in the org tz), view `latest_conversation_activities` (embeddable snippet), view `latest_ai_insights` (newest insight per prospect; currently `prospect_id, id, deal_health, created_at`).
- UI: `PageHeader`, `StageBadge`, `ObjectionChips`, `DealHealthBadge`, `StaleBadge`, `OverdueBadge`, `FollowUpBadge`, `ConversationSnippetText` (follow-ups route), follow-ups `OwnerFilter` pattern, timeline `ICONS`/`TITLES`/`EntryDetail` + pure `buildTimeline()`, `listTeamData`, `getOrgSettings()`, `formatMoney`, `orgToday`, `formatOrgDate`, `formatOrgDateTime`, `formatRelativeTime`, `timeZoneAbbreviation`, `addDaysToDateString`, `daysBetweenDateStrings`.
- Seed: Riley — Jordan (qualified, $12,000, overdue −1), Priya (demo booked, $8,500, today), Marcus (contacted, no value, stale 30 d, no follow-up), Elena (closed won, $24,000), Tom (prospect, $3,000, upcoming +5). Sam — Aisha (conversation, $15,000, overdue −3, stale 20 d), Liam (follow-up, €4,200, upcoming +1), Sofia (closed lost, $9,000). Closed rows get `closed_at = now()` at seed time. No activities, no AI insights.

## 1. Design decisions + pitfalls

### Shared metric definitions in SQL (reused by Prompt 13)
Migration `supabase/migrations/20261010120000_dashboard.sql` (security invoker everywhere → RLS; `set search_path = ''`; revoke from `public, anon`, grant `authenticated`):

1. **`public.open_pipeline_value(p_owner_id uuid default null)`** → `table (currency text, total_value numeric, prospect_count integer)`: open (non-closed) prospects grouped by currency; prospects **without a deal value form one row with `currency = null`, `total_value = null`** (SPEC §12: ignored in the totals, counted next to them). Sum of `prospect_count` over all rows = total open prospects. Never sums across currencies. Prompt 13's `report_pipeline_value()` must wrap this (pipeline value is always "now").
2. **`public.closed_outcome_counts(p_from date, p_to date, p_owner_id uuid default null)`** → one row `(won integer, lost integer)`: prospects currently `closed_won`/`closed_lost` whose **org-tz date of `closed_at`** is in `[p_from, p_to]` (org timezone from `org_settings`). Win rate = won ÷ (won + lost); denominator 0 → "—". Dashboard: `p_from = today − 89`, `p_to = today` (the 90 org calendar days ending today). Prompt 13's `report_outcomes()` reuses it for won/lost/win rate.
3. **`latest_ai_insights`** (`create or replace view`, columns appended): + `recommended_next_step`, `main_objection`. Existing Kanban embed keeps working.
4. **View `public.deals_needing_attention`** (security_invoker): open prospects from `prospects_with_flags` left-joined with `latest_ai_insights`, flags `has_overdue_follow_up`, `is_stale`, `low_health` (latest insight `deal_health = 'low'`), `no_follow_up` (`follow_up_date is null`), and **`attention_rank`** = 1 overdue follow-up > 2 stale > 3 AI health low > 4 no pending follow-up (the highest-priority reason); only rows with ≥ 1 reason. Exposes `id` (= prospects.id) so `latest_conversation_activities`/`latest_ai_insights` embed.
   - Order (the ranking): `attention_rank asc, follow_up_date asc nulls last, last_activity_at asc, id asc` (most overdue first within tier 1; least recently active first otherwise).
5. **TS mirror (pure, unit-tested)** `src/lib/dashboard.ts`: `attentionReasons(flags)` → ordered reasons, `attentionRank(flags)` → 1–4 | null, `compareAttention(a, b)` + `rankDealsNeedingAttention(rows, limit)` (filter → sort → slice). Integration test: SQL order of the view = `rankDealsNeedingAttention()` on the same rows. The page displays the SQL order (scales: limit 10 + exact total in SQL; never fetch every open prospect).

### Data functions (`src/server/data/dashboard.ts`, ctx pattern, `server-only`, Zod-validated input `{ ownerId?, today }`)
6. `getDashboardKpisData(ctx, { ownerId, today })` → `{ openProspects, pipelineValue: { totals: [{ currency, total, count }], withoutValueCount }, dueToday, overdue, stale, winRate: { won, lost, rate | null, from, to } }` — 4 queries in parallel (pipeline RPC, follow-up counts RPC via `getFollowUpCountsData`, stale head count on `prospects_with_flags`, outcomes RPC).
   Also exported separately for Prompt 13: `getPipelineValueData(ctx, { ownerId })`, `getClosedOutcomeCountsData(ctx, { from, to, ownerId })`, pure `winRate(won, lost)` in `src/lib/dashboard.ts`.
7. `listContactTodayData(ctx, { ownerId, limit = 20 })` → `{ rows, total }`: `follow_up_buckets` with `bucket in (overdue, today)`, order `due_date asc, created_at, id`, embedded prospect `(id, name, company, stage, objections, latest_conversation_activities(...), latest_ai_insights(recommended_next_step, deal_health, created_at))` — one query, no N+1; `count: "exact"`.
8. `listDealsNeedingAttentionData(ctx, { ownerId, limit = 10 })` → `{ rows (with reasons), total }`.
9. `listLatestAiRecommendationsData(ctx, { ownerId, limit = 5 })`: `latest_ai_insights` + `prospect:prospects!inner(id, name, company, stage, owner_id)`, open stages only, `created_at desc` → latest next step per open prospect, top 5 by insight recency.
10. `listRecentActivityData(ctx, { ownerId, limit = 15 })`: `activities` + `prospect:prospects!inner(id, name, owner_id)`, `occurred_at desc, created_at desc, id desc`, limit 15; owner filter = activities on that rep's prospects. Rendered with the timeline's icons/titles/detail (`buildTimeline` + shared `ActivityIcon`/`EntryDetail`) plus the prospect link; author names from `listTeamData`.
11. `ownerId` honoured only for managers (reps: ignored → RLS scopes to their own rows). Invalid input → `validationFailure`.

### Page `/dashboard` (`src/app/(app)/dashboard/`)
12. URL state: `owner` (uuid, managers only; parsed with Zod, invalid → All) via `parseDashboardParams` / `dashboardHref` (`src/lib/validation/dashboard.ts`, pure). A rep's `?owner=` is ignored.
13. Header: greeting "Good morning|afternoon|evening, {first name}" (org-tz hour) + today's date in the org tz ("Tuesday, October 6, 2026 · ET"); managers get the owner select (All owners / each rep) in the header actions.
14. KPI tiles (6, responsive grid 1 → 2 → 3/6 cols): Open prospects; Pipeline value (one line per currency, compact, + "N without value"; "—" when none valued); Due today; Overdue (red when > 0); Stale deals (amber when > 0); Win rate (last 90 days) "50%" + "1 won · 1 lost", "—" when no closed deals. Tiles link to the filtered pages (`/prospects`, `/follow-ups?tab=today|overdue`, `/prospects?stale=1`, `/reports`) keeping the owner for managers.
15. Sections stream independently in `<Suspense>` with skeletons (KPIs, Contact today, Deals needing attention, AI recommendations, Recent activity) — queries start in parallel; `loading.tsx` for the first load; `error.tsx` boundary. Empty states for every list. Owner column/name shown to managers.
16. Contact today row: prospect link, company, stage, due label (Overdue N days / Today), follow-up note, objection chips, last conversation snippet, latest AI next step ("AI: …" or nothing). "View all N on Follow-ups" when more than the limit.
17. Deals needing attention row: link, company, stage, owner (managers), reason badges in priority order ("Overdue follow-up" / "Stale — no activity for N+ days" / "AI health: Low" / "No follow-up scheduled"), last activity relative (org-tz title). "Showing 10 of N".
18. Latest AI recommendations: prospect link, next step text, deal health badge, "x ago" (org-tz title).
19. Recent activity: icon by type, title, prospect link, author ("System" for null), org-tz timestamp + relative, content snippet (line-clamped), stage change from → to badges.
20. 375 px: everything stacks; no page-level horizontal scroll. Pitfalls: Radix `SelectValue` needs explicit children; never `toLocaleDateString()`; due dates via `formatDateString`; instants via `formatOrgDateTime`; `now` computed once on the server and passed down.

### Out of scope
Charts (Prompt 13 Reports), editing from the dashboard, notifications, automatic AI calls, currency conversion.

## 2. Files

| File | Purpose |
|---|---|
| `supabase/migrations/20261010120000_dashboard.sql` | `open_pipeline_value`, `closed_outcome_counts`, `latest_ai_insights` + next step, `deals_needing_attention` view |
| `supabase/tests/dashboard.test.sql` | pgTAP: shapes/grants, pipeline value nulls/currencies, outcome window (org-tz edges), attention ranks, RLS A/B/M |
| `src/lib/dashboard.ts` + test | ranking mirror, reasons + labels, `winRate`, `greeting` |
| `src/lib/validation/dashboard.ts` + test | URL params + data-function input schemas |
| `src/server/data/dashboard.ts` | KPIs + lists |
| `src/components/timeline/activity-entry.tsx` | icons/titles/detail shared by the prospect timeline and the feed |
| `src/app/(app)/dashboard/*` | page, sections, skeletons, owner filter, loading, error |
| `tests/integration/dashboard.test.ts` | KPIs/lists vs hand-written SQL (psql, superuser) as A, B, M (All + filtered) on seed + fixture |
| `e2e/dashboard.spec.ts` | rep + manager render, owner filter, rep owner param ignored |
| `CLAUDE.md`, `BUILD_PROGRESS.md` | notes for Prompt 13, row 12 |

## 3. Steps
1. This plan. 2. Migration + pgTAP + `db:reset` + `db:types` + `test:db`. 3. Pure helpers + unit tests. 4. Data functions + integration test (manual SQL). 5. UI. 6. Browser check (Riley + Morgan, desktop + 375 px). 7. e2e. 8. `verify`, `test:db`, `test:integration`, e2e; clean test data. 9. Docs + commit.

## 4. Verification checklist ("Done when")
- [x] Integration: every KPI (open, pipeline value per currency + without value, due today, overdue, stale, won/lost 90 d) and every list (contact today, attention order + total, AI recommendations, recent activity) equals independent hand-written SQL on the seed + fixture, as Riley, Sam, Morgan (All) and Morgan filtered to each rep; a rep's owner param is ignored.
- [x] Ranking unit tests: tier order, tiebreaks, multi-reason rows, no-reason rows dropped, limit; SQL order = TS mirror.
- [x] pgTAP: pipeline value nulls ignored + per currency, outcome window edges in the org tz, attention ranks, RLS.
- [x] UI: greeting + org-tz date, 6 tiles, 4 sections with empty states, skeletons, owner filter (managers only, in the URL); browser-checked as rep + manager, desktop + 375 px.
- [x] `npm run verify` passes; `test:db`, `test:integration`, e2e green; test data cleaned.
