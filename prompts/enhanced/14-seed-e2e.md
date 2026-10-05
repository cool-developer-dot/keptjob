# Prompt 14 (enhanced): Seed data + end-to-end tests

Source: `BUILD_PROMPTS.md` → "Prompt 14: Seed data + end-to-end tests". `SPEC.md` is the source of truth (§2 pipeline + `stage_history`, §3 fields/reasons/objections, §4 roles, §5 org settings, §6 time, §7 activities + `last_activity_at`, §8 follow-ups, §9 workflow, §10 AI insights, §12 reports). No new product features, no schema change unless a test reveals a bug.

Goal: `npm run db:reset` produces a realistic, internally consistent demo team (dates always relative to "now" so it never goes stale), and a Playwright suite covers the core journeys end to end with the AI mocked.

---

## 1. Seed (`supabase/seed.sql`)

**Keep** (existing tests rely on them): the 3 users + credentials (`11111111-…-00000000000{1,2,3}` Morgan manager / Riley rep / Sam rep, `Password123!`), prospects `22222222-2222-4222-8222-0000000000{01..08}` with the same name, company, owner, stage, objections, deal value/currency, close reason and `last_activity_at` age (Jordan 2 d, Priya 1 d, Marcus 30 d stale, Elena 5 d, Tom 3 h, Aisha 20 d stale, Liam 4 d, Sofia 40 d), and follow-ups `33333333-…-0000000000{01..05}` (same prospect, due offset, note).

**Add** prospects `…000000000009 … …000000000040` → **40 prospects**, ~half per rep (Riley 21, Sam 19). None owned by the manager (SPEC §3 "owner (sales rep)"; existing tests assert Morgan owns no follow-ups). Requirements:

- All **9 stages** for **each** rep. Realistic names/companies (fictional, `.example` emails, `+1 … 555 …` phones; some missing email/phone).
- Varied objections (all 7 categories used, some none, some 2+) with objection notes; decision-maker yes/no/unknown mix; conversation notes.
- Deal values: mostly USD (org default), a couple of EUR, **some null** (open and won).
- `created_at` 3 h … 90 d ago; human activities (call / conversation / note / demo / follow_up completions / stage changes) spread over the **past 60 days**; several open deals **stale** (> `stale_days` = 14 d without human activity) — for Riley, Marcus stays the least recently active open deal (e2e asserts it first in "Needs attention").
- Follow-ups: pending **overdue** (Riley ≤ 4 days overdue, so the dashboard e2e's −5 d fixture stays first), **due today**, **upcoming** (incl. the +7 d edge), **later** (> 7 d) and **completed** (some within the last 30 days, some older), each completion with its `follow_up` activity (metadata `follow_up_id`, `due_date`, `task`). Pending follow-ups only on open deals; owner = prospect owner.
- Demo dates: `demo_booked` → future `demo_at` (business hours in the org tz), `demo_attended`/`follow_up`/won-after-demo → past `demo_at` + a `demo` activity.
- **Consistent `stage_history`**: first row `from null → initial stage` at `created_at` by the creator; then every move in order (`from` = previous `to`), by the owner at that time, each with its `stage_change` activity (same instant, user, metadata `{from,to,close_reason}`, note → content). Includes **a skip** (e.g. contacted → qualified), **a backward move** (e.g. demo_booked → qualified after a no-show) and **a reopen** (closed_lost → conversation → … → closed_won).
- Closed deals (≥ 5 won / ≥ 5 lost across reps, all within 90 d so the win rate is meaningful): valid structured reasons (won: product_fit/price_value/relationship/urgent_need/other; lost: price/timing/competitor/no_budget/no_response/not_a_fit/other), optional close notes, `closed_at` = time of the last move into the closed stage.
- One **reassignment** (Riley → Sam by Morgan): `owner_change` activity by the manager, later activity by the new owner.
- A few **AI insights** (7–8, one prospect with 2 → history), deal health high/medium/low mix (one low → "AI health low" in deals needing attention), DM suggestion differing from the prospect's status at least once, each with its `ai_insight` activity (`content` = summary, metadata `{insight_id, deal_health}`), `created_by` = owner, all **older than 10 minutes** (they count toward the AI rate limit otherwise), model `seed-data`.

**Strategy** (triggers would overwrite timestamps/derived fields): users are inserted normally (the `on_auth_user_created` trigger creates `public.users`). For the CRM data, declare compact temp tables (prospects, moves, activities, follow-ups, insights) and insert explicit, backdated rows with `session_replication_role = replica` (user triggers off; seed runs as `postgres`). Then, still in the seed: derive `stage_history` + `stage_change` activities from the moves, set `follow_up_date` = min pending `due_date`, `last_activity_at` = greatest(`created_at`, newest human activity), `closed_at`, `updated_at`; switch back to `origin`. A final `do $$ … $$` block **asserts consistency and raises** (so a broken seed fails `db:reset`):
  - current stage = latest `stage_history.to_stage`; each row's `from_stage` = previous `to_stage`; first row `from_stage is null` at `created_at`;
  - every non-initial history row has exactly one matching `stage_change` activity;
  - closed ⇔ valid `close_reason` + `closed_at` = time of the last move into it; open ⇒ no close fields;
  - `follow_up_date` = min pending due; `last_activity_at` = greatest(created_at, max human activity); nothing in the future; activities ≥ `created_at`;
  - every AI insight has its `ai_insight` activity; every completed follow-up has its `follow_up` activity; pending follow-up owner = prospect owner;
  - 40 prospects, 9 stages per rep.
Dates use `org_today()` + an org-local time (business hours) for day offsets ≥ 1, `now() - interval` for "today" items. Re-runnable on a fresh DB (`db:reset`).

## 2. Tests that depend on the seed (update deliberately, never weaken)

- Literal seed numbers in `tests/integration/follow-ups.test.ts` (tab counts/lists, badge, needs attention, lifecycle counts) and `tests/integration/dashboard.test.ts` ("documented seed numbers", fixture expectations) → recompute by hand from the new seed and update; the hand-written-SQL comparisons stay as they are.
- `tests/integration/pipeline.test.ts` (manager sees exactly Riley + Sam owners), `prospect-list` (≥ 1 overdue/stale), `reports` (far-past period), `ai-insights` (rate limit: seed insights are old) — must pass unchanged.
- e2e: `prospects.spec.ts` manager test relied on all prospects fitting one page (25 rows) → assert both owners on page 1, Jordan visible, then the Sam filter shows Aisha (same intent). Other specs are seed-relative and must pass unchanged.
- pgTAP suites build their own fixtures (must stay green).

## 3. Playwright e2e (`e2e/journey.spec.ts`, AI mocked with `AI_FAKE=1` in the webServer env only)

Specs are independent (own fixtures, unique `e2e-journey-<timestamp>` names), idempotent and clean up (service-role delete in `afterAll`; settings restored in `finally`/`afterAll`).

1. **Rep journey** (Riley): note dashboard KPIs (open, due today, win-rate "W won · L lost") → `/prospects` New prospect → detail page → Log activity (call) → timeline shows it → `/pipeline?q=<name>` keyboard-drag Prospect → **Demo Booked** (dialog: date/time + follow-up; Save) → **Demo Attended** (notes + follow-up due **today**; Save) → **Closed Won** (dialog: Save **disabled** until a reason is picked; uncheck "Mark N pending follow-ups as completed"; pick reason; Save) → DB: stage history `prospect → demo_booked → demo_attended → closed_won`, demo_at in the org tz, demo activity, close reason → `/follow-ups?tab=today` complete the follow-up → dashboard: open unchanged vs start, won + 1, due today unchanged vs start (the today follow-up was created and completed). Also **Generate AI Insights** on the prospect (fake client: `[Fake AI] …`, timeline entry).
2. **Rep B gets 404** (HTTP status + "Prospect not found") on a rep-A prospect created in the spec.
3. **Manager reassigns** a Riley prospect to Sam on the detail page → toast + `owner_change` timeline entry (Riley → Sam, by Morgan); Riley now gets 404, Sam sees it.
4. **Org timezone changes "today"**: server time cannot be frozen (Postgres `now()` drives `org_today()`), so the spec computes both org "todays" for the current instant (`orgToday("America/New_York")`, `orgToday("Pacific/Honolulu")`) and builds fixtures so a bucket flip is guaranteed at any hour: pending follow-ups due NY-today and HNL-today, and a follow-up completed at 02:00 NY on NY-today − 29 (inside the 30-day completed window in NY, outside in Honolulu when the dates agree). As manager: Settings → Timezone = Honolulu → Save; the Follow-ups Today / Completed tabs (filtered to the fixture) match `followUpViewBucket()` for each timezone, and at least one fixture changes bucket (when NY and HNL dates differ, the NY-today item moves from Today to Upcoming). Restore the original timezone afterwards (UI + service-role safety net).
5. **Invite flow page renders**: manager → Settings → Team → Invite user dialog (name, email, role fields) renders; `/set-password` without a session redirects to login / shows the form as designed (no email sent). Full invite → Mailpit → set password is already covered by `settings.spec.ts`.

## 4. Pitfalls

- `session_replication_role = replica` also skips FK triggers → the consistency block must check references implicitly (joins) and the seed only references fixed ids.
- `stage_history.changed_at` for the initial row must equal `created_at` (the timeline "Prospect created" entry and reports' cohorts use it).
- Keep insight timestamps > 10 min old (AI rate limit counts own rows in the last 10 min).
- Don't create pending follow-ups for closed deals (dashboard/needs-attention semantics), and keep Riley's overdue ≤ 4 days.
- e2e: Radix selects need click + option; keyboard drag needs ~150 ms gaps; the dev server must run with `AI_FAKE=1` (a reused server must be started that way); restore the org timezone even when a step fails.
- Integration tests run in parallel files against the same seed; never mutate seed rows in tests (create `itest-*` rows).

## 5. Verification checklist ("Done when")

- [x] `npm run db:reset` succeeds (consistency block passes); extra SQL spot checks (stage per rep, stale count, buckets) look right; no schema change → `db:types` unchanged.
- [x] `PLAYWRIGHT_CHANNEL=chrome npm run e2e` passes fully, **twice in a row**.
- [x] `npm run verify`, `npm run test:db`, `npm run test:integration` pass.
- [x] Seeded app eyeballed as rep and manager (dashboard, pipeline, reports, follow-ups).
- [x] BUILD_PROGRESS row 14, README seed/test sections, CLAUDE.md notes updated; committed locally.
