# Prompt 13 (enhanced): Reports

Source: `BUILD_PROMPTS.md` → "Prompt 13: Reports". `SPEC.md` §12 (metric definitions — followed **exactly**), §2 (stage order; `closed_lost` unranked in the funnel), §4 (RLS: reps own rows, managers everything), §6 (org timezone), §14 (no multi-currency conversion) are the source of truth; SPEC wins any conflict.

Goal: `/reports` shows, for a selected period (org timezone) and — for managers — one rep or the whole team: total prospects, prospects by current stage, the SPEC §12 counts, pipeline value, conversion rates (funnel), win rate (+ won value, lost reasons) and follow-up counts. Every number comes from SQL functions that run as the caller (RLS).

---

## 0. Reuse (do not redefine)

- `open_pipeline_value(p_owner_id)` (Prompt 12) — SPEC §12 pipeline value, currency-null row = open prospects without a value. `report_pipeline_value()` **wraps it**.
- `closed_outcome_counts(p_from, p_to, p_owner_id)` (Prompt 12) — won/lost of prospects currently closed whose org-tz `closed_at` date is in `[from, to]`. `report_outcomes()` **reuses it** for won/lost; the period filter is factored into one helper (below) that both use, so they cannot drift.
- `follow_up_bucket_counts(p_owner_id)` (Prompt 10) — overdue / today; `report_follow_ups()` reuses it for the "now" counts.
- TS: `effectiveOwner()` (owner honoured for managers only), `summarizePipelineValue()`, `winRate()`/`formatWinRate()`, `formatMoney`, `orgToday`, `addDaysToDateString`, `formatDateString`, `listTeamData`, `PageHeader`, dashboard `SectionCard`/`SectionEmpty` patterns, `STAGE_LABELS`, `LOST_REASON_LABELS`.

## 1. SQL (migration `supabase/migrations/20261011120000_reports.sql`)

Every function: `language sql stable security invoker set search_path = ''` (RLS applies: a rep passing another owner's id gets zeros / no rows), schema-qualified names, `revoke execute … from public, anon` + `grant execute … to authenticated`. Parameter naming follows the Prompt 12 metric functions: `p_from date, p_to date, p_owner_id uuid default null` (the prompt's `p_owner`; same meaning).

**Period** = the org calendar days `p_from … p_to` inclusive = instants `[p_from 00:00 org tz, (p_to + 1) 00:00 org tz)`. `p_from > p_to` → error `22023`.

1. `org_period_bounds(p_from, p_to)` → `(start_at, end_at)` timestamptz half-open bounds in the org tz (raises 22023 when reversed). Internal helper (granted to `authenticated` because invoker functions call it).
2. `prospects_created_in_period(p_from, p_to, p_owner_id)` → `setof prospects` (`created_at` in bounds, optional current owner) — the funnel cohort.
3. `prospects_closed_in_period(p_from, p_to, p_owner_id)` → `setof prospects` currently `closed_won`/`closed_lost` with `closed_at` in bounds. `closed_outcome_counts()` is **re-created on top of it** (same signature + results; Prompt 12 pgTAP must stay green).
4. `stage_funnel_rank(stage)` → `prospect 1 … follow_up 7, closed_won 8, closed_lost null` (immutable; SPEC §2 order, `closed_lost` unranked).
5. `report_stage_counts(p_owner_id)` → 9 rows `(stage, prospect_count)` in SPEC order, zero-filled. **Not period-filtered** — SPEC "prospects by current stage" is a "now" snapshot (like pipeline value); total prospects = sum.
6. `report_stage_reached(p_from, p_to, p_owner_id)` → 8 rows `(stage, stage_rank, prospect_count)` for every ranked stage: number of cohort prospects whose **highest stage ever reached** (max `stage_funnel_rank` over all `stage_history.from_stage`/`to_stage` rows of the prospect plus its current stage; a cohort member with no ranked stage — e.g. created directly as `closed_lost` — counts as `prospect`) is ≥ that stage. The single definition behind the funnel and the SPEC §12 stage counts.
7. `report_funnel(p_from, p_to, p_owner_id)` → 7 rows `(step, stage, prospect_count, step_conversion_pct, overall_conversion_pct)` for Prospects → Contacted → Conversation → Qualified → Demo Booked → Demo Attended → Closed Won (= `report_stage_reached` without `follow_up`). `step_conversion_pct` = 100 × count ÷ previous step count (`null` for step 1 and when the previous count is 0); `overall_conversion_pct` = 100 × count ÷ Prospects (null when 0) — on the Closed Won row it is the SPEC "overall = Closed Won ÷ Prospects". Rounded to 1 decimal.
   - Consequences (documented): skipping counts the skipped steps (prospect → qualified counts as contacted + conversation); a backward move never lowers the reached stage; a reopened deal that ends won counts in every step; `prospect → contacted → closed_lost` counts up to Contacted; reaching `follow_up` (rank 7) implies ≥ Demo Attended; `closed_won` counts in every step.
8. `report_outcomes(p_from, p_to, p_owner_id)` → one row `(won, lost, win_rate_pct, won_value jsonb, won_without_value, lost_reasons jsonb)` for prospects closed in the period: won/lost from `closed_outcome_counts()`, `win_rate_pct` = 100 × won ÷ (won + lost) rounded to 1 decimal (null when 0), `won_value` = `[{currency, total, count}]` sum of `deal_value` of won deals per currency (nulls ignored, never summed across currencies), `won_without_value` = won deals without a value, `lost_reasons` = `[{reason, count}]` of current `close_reason` of lost deals (count desc, reason). A deal lost then reopened and won counts only as won (current state).
9. `report_pipeline_value(p_owner_id)` → `select * from open_pipeline_value(p_owner_id)` — always "now".
10. `report_follow_ups(p_from, p_to, p_owner_id)` → one row `(overdue, due_today, completed)`: overdue/due today **now** from `follow_up_bucket_counts()`; completed = follow-ups completed with `completed_at` in the period. Owner = `follow_ups.owner_id` (same as the Follow-ups page).

**SPEC §12 counts — basis (documented in the UI):** contacted, conversations, qualified, demos booked, demos attended, follow-ups = `report_stage_reached` (prospects **created in the period** that reached at least that stage; "follow-ups" = reached the Follow-up stage — follow-up *tasks* are shown separately); closed won / closed lost = `report_outcomes` (prospects **closed in the period**, same basis as the win rate). Total prospects + by stage = now. Pipeline value + overdue = now (SPEC).

## 2. TypeScript

- `src/lib/reports.ts` (pure, client-safe): `REPORT_PRESETS` (`this_month`, `last_30`, `last_90`, `this_quarter`, `custom`) + labels; `resolveReportRange(params, today)` → `{ from, to }` (this month = 1st … today, last 30/90 = today − 29/89 … today, this quarter = quarter start … today; custom = URL from/to); `formatPct(pct)` ("37.5%" / "—"); `FUNNEL_STAGES`; `STAGE_COUNT_KEYS`; mappers from RPC rows (`toFunnelSteps`, `toOutcomes` with Zod-parsed jsonb, `zeroFillLostReasons`).
- `src/lib/validation/reports.ts`: URL `range`, `from`, `to`, `owner` → `parseReportsParams` (each key independent; invalid → default `last_30`; custom needs valid `from ≤ to`, span ≤ 731 days, otherwise falls back to `last_30`); `reportsHref(params, overrides)` (non-default values only); `reportQuerySchema` (`from`, `to`, `ownerId?`, from ≤ to).
- `src/server/data/reports.ts` (`server-only`, ctx pattern): `getReportData(ctx, { from, to, ownerId })` → `{ stageCounts, totalProspects, reached, funnel, outcomes, pipelineValue, followUps }` — 6 RPCs in parallel through the user-scoped client; owner honoured for managers only (`effectiveOwner`); reuses `getPipelineValueData` for the pipeline summary.

## 3. UI `/reports` (`src/app/(app)/reports/`)

- Server page: `requireUser()`, org settings, team (owner validated against it; reps' `owner` ignored), range resolved in the org tz on the server; header shows the period ("Sep 1 – Sep 30, 2026 · ET") and scope.
- Filters (client, URL state, `router.push` in a transition with a spinner): range preset select; Custom → two `<input type="date">` + Apply (validated from ≤ to); manager owner select (All owners / each user). One row above the charts, wraps on mobile.
- KPI tiles (`data-kpi`): Total prospects (now) · New prospects (created in period) · Pipeline value (now; per currency + "N without value") · Win rate (period; "W won · L lost") · Won value (period; per currency + "N without value") · Overdue follow-ups (now) · Due today (now) · Follow-ups completed (period).
- "Stage counts" strip: Contacted, Conversations, Qualified, Demos booked, Demos attended, Follow-ups (stage reached, created in period) + Closed won / Closed lost (closed in period), with a one-line basis note.
- Charts (Recharts, client components, `ResponsiveContainer`): **Funnel** (horizontal bars, 7 steps, value at the tip), **Prospects by stage** (current, 9 stages), **Lost reasons** (period, horizontal bars, zero-filled 7 reasons, hidden when no lost deals → empty state). Single series each → one blue (`--viz-series-1`: light `#2a78d6`, dark `#3987e5`, validated with the dataviz validator), no legend (title names it), hairline grid, ≤ 24 px bars with 4 px rounded data-end, axis/labels in text tokens, hover tooltip, each chart in a `figure` with an accessible name + an `sr-only` data table.
- **Conversion table**: step, count, conversion from previous step, % of prospects; "—" when undefined; overall row (Closed Won ÷ Prospects) + win rate.
- Empty states: no prospects created in the period → funnel/conversion empty state; nothing at all → stage chart empty state; no lost deals → lost reasons empty state.
- `loading.tsx` + Suspense skeleton keyed by the params (filter change shows a skeleton); `error.tsx`. 375 px: no page-level horizontal scroll.

## 4. Tests

- **pgTAP `supabase/tests/reports.test.sql`** (deterministic; clean slate inside the rolled-back tx; history built by **real stage moves** through `move_prospect_stage`; `created_at`/`closed_at`/`completed_at` set by privileged updates): period 2025-09-01…30 (NY), two reps + manager. Fixture: full path won; skip forward then backward then lost; reopened (lost → reopen → skip → won, no deal value); lost-only path (prospect → contacted → lost, EUR, closed 11:30 pm NY on the last day); open skip to demo booked (EUR); open untouched without value; created 1 minute before the period (closed won in the period: outcomes yes, funnel no); created at 00:00 NY on day 1 (skip to follow-up); closed won 00:00 NY the day after the period (funnel yes, outcomes no); rep B: lost via conversation, won in GBP, open without value. Asserts exact: funnel counts + step/overall %, reached follow-up count, stage counts (zero-filled), win rate, won value per currency + without value, lost reasons, pipeline value (nulls ignored + count), follow-up counts (overdue/today/completed edges), owner filter, RLS (A sees only own; A passing B's id → zeros/no rows; B; M all), `closed_outcome_counts` unchanged, 22023 on reversed dates, security invoker + grants.
- **Unit**: presets in the org tz (month/quarter starts, 11 pm NY), URL parsing, `formatPct`, mappers.
- **Integration `tests/integration/reports.test.ts`**: prospects created and moved through the data layer as Riley/Sam, timestamps shifted with psql into a far-past period; `getReportData` as A, B, A with B's owner id (ignored), M all + filtered → exact numbers.
- **e2e `e2e/reports.spec.ts`**: rep + manager render (tiles, charts, table), preset change updates the URL, custom range, manager owner filter, rep `?owner=` ignored.

## 5. Pitfalls

- `stage_history.changed_at` is `now()` = transaction start inside pgTAP — the funnel uses the max rank, never ordering, so that is fine.
- Never use `closed_at::date` (UTC) or `created_at::date`; always org-tz bounds.
- `setof public.prospects` invoker functions keep RLS; don't make them definer.
- Recharts renders nothing on the server: give the chart container a fixed height so there is no layout shift; tooltips via the default `Tooltip` with token colors.
- Radix `SelectValue` needs explicit children; `searchParams` is a Promise; dates via `formatDateString` (no tz shift).
- Don't sum currencies. Don't add currency conversion.

## 6. Verification checklist ("Done when")

- [x] Migration applies (`db:reset`), types regenerated, `test:db` green incl. the new reports fixture (exact funnel counts, step/overall %, win rate, won value, lost reasons, pipeline value with nulls ignored + count, follow-ups, owner filter, RLS).
- [x] Prompt 12 tests for `closed_outcome_counts` still pass after the refactor.
- [x] Unit + integration tests pass; e2e green.
- [x] `/reports` browser-checked as rep and manager, desktop + 375 px (presets, custom range, owner filter, empty states, dark/light chart colors).
- [x] `npm run verify` passes.
