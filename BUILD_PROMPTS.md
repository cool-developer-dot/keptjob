# AI Sales CRM V1: Build Prompts

**How to run**
- Run in order, **one prompt per session** (start a new session in this folder for each prompt).
- `SPEC.md` is the source of truth. Prompt 0 turns it into `CLAUDE.md`, which every later session loads automatically.
- Don't start the next prompt until the "Done when" checks pass. Commit after each prompt.
- Local development uses Supabase in Docker. Cloud Supabase, Vercel and GitHub are only needed at Prompt 15. An OpenAI key is needed at Prompt 11.

---

## Prompt 0: Project bootstrap + CLAUDE.md

```
Read SPEC.md fully. Set up the project in this folder:
- Next.js (latest stable, App Router, src/ dir, TypeScript strict, ESLint), Tailwind CSS, shadcn/ui (init + button, input, label, card, dialog, alert-dialog, dropdown-menu, select, table, tabs, badge, textarea, calendar, popover, sonner, form, sheet, skeleton, avatar, separator, checkbox, command, tooltip).
- Install: @supabase/supabase-js, @supabase/ssr, zod, react-hook-form, @hookform/resolvers, recharts, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, date-fns, @date-fns/tz, openai, server-only. Dev: vitest, @vitejs/plugin-react, @testing-library/react, jsdom, @playwright/test, supabase (CLI as devDependency, used via npx).
- `npx supabase init`; set enable_signup = false for auth in supabase/config.toml.
- Folders: src/app, src/components, src/lib/supabase (server.ts, client.ts, admin.ts [server-only, service role], middleware.ts using @supabase/ssr), src/lib/validation, src/lib/constants.ts, src/lib/time.ts, src/lib/ai, src/server/actions, supabase/migrations, supabase/tests, e2e/.
- .env.example: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, OPENAI_MODEL, NEXT_PUBLIC_SITE_URL.
- package.json scripts: dev, build, lint, typecheck (tsc --noEmit), test (vitest run), e2e (playwright test), db:reset (supabase db reset), db:types (supabase gen types typescript --local > src/lib/supabase/database.types.ts), verify (typecheck && lint && test && build).
- src/lib/constants.ts: stage order + labels, objection categories, won reasons, lost reasons, activity types, roles, allowed US timezones, exactly as in SPEC.md.
- git init with a .gitignore that excludes .env*, except .env.example.
- Create CLAUDE.md: a short project summary, "SPEC.md is the source of truth, read the relevant section before every task", the out-of-scope list, and these conventions:
  * mutations go through server actions in src/server/actions and return { ok: true, data } | { ok: false, error }
  * Zod validates every input, on the client and again on the server
  * RLS is the security boundary; user-facing code uses the user-scoped Supabase client; the service-role client (src/lib/supabase/admin.ts) is only for manager-verified admin actions (invites)
  * all dates/times go through src/lib/time.ts using the org timezone; store UTC
  * AI never writes prospect fields without a user click
  * after every task run `npm run verify` and fix everything until it passes
Done when: `npm run verify` passes on the empty app.
```

---

## Prompt 1: Database schema + triggers

```
Read CLAUDE.md and SPEC.md §2–§9. Create the Supabase migration(s):

Enums: pipeline_stage, decision_maker_status, objection_category, activity_type (call, conversation, note, demo, follow_up, stage_change, owner_change, ai_insight), follow_up_status, deal_health, user_role (manager, sales_rep). Values exactly as in SPEC.md.

Tables (uuid PKs, timestamptz in UTC, updated_at trigger where there is an updated_at):
- org_settings: single row (id boolean PK default true, CHECK id), default_currency char(3) default 'USD' CHECK ~ '^[A-Z]{3}$', timezone text default 'America/New_York' CHECK in the allowed US list, stale_days int default 14 CHECK 1–365, updated_at, updated_by. Insert the default row.
- users: id = auth.users.id (FK, cascade), full_name, email, role user_role default 'sales_rep', created_at, updated_at.
- prospects: name (not null), company, email, phone, stage default 'prospect', decision_maker_status default 'unknown', objections objection_category[] default '{}', objection_notes, notes, follow_up_date date (derived), demo_at timestamptz, close_reason text, close_notes text, closed_at timestamptz, deal_value numeric(12,2) CHECK >= 0 null, currency char(3) not null, owner_id → users, created_by → users, last_activity_at timestamptz default now(), created_at, updated_at.
  CHECK: stage = closed_won ⇒ close_reason in the won list; stage = closed_lost ⇒ close_reason in the lost list; stage not closed ⇒ close_reason is null.
- activities: prospect_id (cascade), user_id null, type, content, metadata jsonb default '{}', occurred_at default now(), created_at.
- follow_ups: prospect_id (cascade), owner_id, due_date date not null, note text not null, status default 'pending', completed_at, completed_by, created_by, created_at, updated_at. CHECK (status='completed') = (completed_at is not null).
- stage_history: prospect_id (cascade), from_stage null, to_stage, changed_by null (null only for seed/system), changed_at default now(), close_reason null, note null.
- ai_insights: prospect_id (cascade), summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model, created_by, created_at.

Functions/triggers:
- org_today() returns date: now() at time zone (org_settings.timezone).
- is_stale(prospects row) or a view prospects_with_flags adding is_stale (open stage AND last_activity_at < now() - stale_days) and has_overdue_follow_up.
- handle_new_user (after insert on auth.users, security definer): insert public.users with full_name from raw_user_meta_data, role from raw_app_meta_data->>'role' (default sales_rep). Never read the role from raw_user_meta_data.
- prospects BEFORE INSERT: currency := org default when null; owner_id := auth.uid() when null; created_by := auth.uid().
- prospects BEFORE UPDATE: owner_id change only if is_manager() (else raise); stage moving into closed ⇒ closed_at := now(); stage moving out of closed ⇒ clear close_reason, close_notes, closed_at.
- prospects AFTER INSERT: stage_history (from null → stage).
- prospects AFTER UPDATE: stage changed ⇒ stage_history (changed_by auth.uid(), close_reason, note) + activity stage_change with metadata {from, to, close_reason}. Owner changed ⇒ activity owner_change {from_owner, to_owner} + set owner_id of that prospect's pending follow_ups to the new owner.
- activities AFTER INSERT: for types call/conversation/note/demo/follow_up/stage_change set prospects.last_activity_at = greatest(last_activity_at, least(occurred_at, now())).
- follow_ups AFTER INSERT/UPDATE/DELETE: recompute prospects.follow_up_date = min(due_date) of pending follow-ups (null if none).
- users BEFORE UPDATE/DELETE: block removing or demoting the last manager.
- Indexes: prospects(owner_id), (stage), (follow_up_date), (last_activity_at); follow_ups(status, due_date), (owner_id); every FK column.

Run `npm run db:reset` and `npm run db:types`. Add supabase/tests/schema.test (pgTAP via `supabase test db`, or vitest against local Supabase) covering: the close_reason CHECK, auto stage_history on insert/update, reopen clears close fields, follow_up_date derivation, last_activity_at ignores ai_insight.
Done when: the migration applies cleanly, the tests pass, and `npm run verify` passes.
```

---

## Prompt 2: Row Level Security

```
Read CLAUDE.md and SPEC.md §4. New migration: enable RLS on every public table.
- is_manager(): security definer, stable, search_path set; reads users.role for auth.uid().
- can_access_prospect(prospect_id): security definer; owner = auth.uid() OR is_manager().
- org_settings: select for authenticated; update only managers.
- users: select for authenticated; update own full_name (a trigger blocks role changes unless is_manager()); managers can update role. No insert/delete via the API.
- prospects: select/update where owner_id = auth.uid() OR is_manager(); insert with check owner_id = auth.uid() OR is_manager(); delete only is_manager().
- activities: select/insert where can_access_prospect, insert requires user_id = auth.uid(); no update/delete (append-only).
- follow_ups: select/insert/update/delete where can_access_prospect.
- stage_history: select where can_access_prospect; no insert/update/delete policies (written only by the security-definer trigger).
- ai_insights: select/insert where can_access_prospect, insert requires created_by = auth.uid(); no update/delete.
Tests (pgTAP or vitest against local Supabase), with manager M, rep A and rep B:
A cannot select/update B's prospects or their child rows · A cannot change owner_id · A cannot delete a prospect · M sees all and can reassign A→B (pending follow-ups move to B, an owner_change activity exists) · nobody can update/delete stage_history or activities · A cannot change their own role · the last manager cannot be demoted.
Done when: all RLS tests pass and `npm run verify` passes.
```

---

## Prompt 3: Auth + app shell

```
Read CLAUDE.md and SPEC.md §4, §11. Implement:
- /login: email + password (react-hook-form + Zod), error toast, "Forgot password?" link.
- /forgot-password: resetPasswordForEmail with redirect to /auth/confirm.
- /auth/confirm route handler: verifyOtp({ token_hash, type }) for invite and recovery → redirect to /set-password.
- /set-password: set a new password (min 8 chars, confirm field) → /dashboard.
- middleware.ts: refresh the session; unauthenticated → /login (except the auth routes); authenticated users on /login → /dashboard; /settings is managers only (also enforced server-side).
- Authenticated layout: sidebar (Dashboard, Pipeline, Prospects, Follow-ups, Reports, and Settings for managers only), header with user name, role badge, logout. Mobile: collapsible sheet.
- src/lib/auth.ts: getCurrentUser() → { id, full_name, email, role } (server-only, cached per request); requireManager().
- Placeholder pages for every route.
- supabase/seed.sql: 1 manager + 2 sales reps created in auth.users with passwords and raw_app_meta_data role. Document the dev credentials in README only.
Use the in-app browser to check login, logout, redirects, invalid password, and that the manager-only nav is hidden for reps.
Done when: those flows work locally and `npm run verify` passes.
```

---

## Prompt 4: Org settings, time helpers, Team page

```
Read CLAUDE.md and SPEC.md §4–§6, §11.
- src/lib/time.ts (pure, unit-tested, using @date-fns/tz): orgToday(tz, now?), toOrgDate(utc, tz), formatOrgDateTime(utc, tz), orgLocalToUtc(dateStr, timeStr, tz) for demo entry, followUpBucket(dueDate, tz, now?) → 'overdue' | 'today' | 'upcoming' | 'later'. Tests must include a DST transition date and a UTC-midnight edge case (e.g. 11pm New York = next day UTC).
- src/lib/org.ts: getOrgSettings() server helper (cached per request), plus an OrgSettingsProvider so client components can read timezone/currency/stale_days.
- src/lib/money.ts: formatMoney(value, currency) via Intl.NumberFormat.
- /settings (managers only), two tabs:
  * Organization: default currency (ISO code select, common list), timezone (select from the allowed US list), stale days (1–365). Server action updateOrgSettings (Zod + requireManager). Note under currency: "Applies to new prospects; existing prospects keep their currency."
  * Team: list users (name, email, role, joined). "Invite user" dialog (full name, email, role) → server action inviteUser: requireManager(), then the admin client auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo: NEXT_PUBLIC_SITE_URL + '/auth/confirm' }) and set app_metadata.role via auth.admin.updateUserById. Change-role select (the last-manager rule is enforced by the DB; show the error nicely).
- Check the invite email arrives in local Mailpit/Inbucket (http://127.0.0.1:54324) and that accepting it → set password → login works.
Done when: the time.ts tests pass, the invite flow works end to end locally, and `npm run verify` passes.
```

---

## Prompt 5: Validation + server actions (data layer)

```
Read CLAUDE.md and SPEC.md §2–§9.
- src/lib/validation/*.ts (Zod; enums sourced from src/lib/constants.ts):
  prospectCreate/Update (objections: array of categories, deal_value optional ≥ 0, email optional valid email, phone optional), stageChange (to_stage; close_reason required and from the correct list when the target is closed_won/closed_lost; optional close_notes, note), reassignProspect, activityCreate (type ∈ call/conversation/note/demo; content required; occurred_at optional and not in the future), followUpCreate/Reschedule/Complete, orgSettings, invite, aiInsightOutput.
- src/server/actions/prospects.ts: createProspect, updateProspect (cannot change stage/owner/close fields; those have dedicated actions), deleteProspect (manager), moveProspectStage({ prospectId, toStage, closeReason?, closeNotes?, note? }), reassignProspect (manager), completeAllPendingFollowUps(prospectId).
- src/server/actions/activities.ts: addActivity.
- src/server/actions/followUps.ts: createFollowUp (owner = the prospect's owner), completeFollowUp (status, completed_at = now(), completed_by, plus a follow_up activity), rescheduleFollowUp, deleteFollowUp.
- src/server/actions/demo.ts: setDemoDetails({ prospectId, demoDate, demoTime, followUp?: { dueDate, note } }) converting org-local → UTC; logDemoAttended({ prospectId, notes, followUp?: {...} }) creating a demo activity.
- Every action: Zod parse → user-scoped client → typed result → revalidatePath for the affected pages. No service-role usage.
- Vitest: every schema (valid + invalid, esp. the close-reason rules and future occurred_at).
Done when: the tests pass and `npm run verify` passes.
```

---

## Prompt 6: Stage-change workflow (automation rules)

```
Read CLAUDE.md and SPEC.md §2 and §9. Build ONE reusable client flow used by both the detail page and the Kanban board:
- src/components/stage-change/useStageChange.ts + StageChangeDialog.tsx: given a prospect and a target stage, decide which dialog to show (if any), then call moveProspectStage and the related actions.
  * → demo_booked: dialog with demo date + time (org timezone, shown in the label, e.g. "ET"), and an optional follow-up (checkbox on by default; due date defaults to the day after the demo; note defaults to "Follow up after demo"). Buttons: Save (move + setDemoDetails), Skip (move only), Cancel (no move).
  * → demo_attended: dialog with demo notes (textarea) and next follow-up (date + note, prefilled +2 days in org tz). Save / Skip / Cancel.
  * → closed_won / closed_lost: close reason select (won or lost list), optional notes, and a checkbox "Mark N pending follow-ups as completed" (shown only if N > 0). Save / Cancel only; there is no Skip, because the reason is required.
  * any other target, including backward moves and skips: move immediately, no dialog.
- Pure function decideStageFlow(from, to, pendingFollowUps) in src/lib/workflow.ts, with unit tests for every case, including backward, skipped, reopened-from-closed and same-stage (no-op).
- Never send messages, never auto-change stages.
Done when: the decideStageFlow tests pass, the dialogs render in isolation (a temporary /dev page is fine; delete it afterwards), and `npm run verify` passes.
```

---

## Prompt 7: Prospects list page

```
Read CLAUDE.md and SPEC.md §3, §6, §11. Build /prospects:
- Server-rendered table: name, company, stage badge, decision-maker status, objection chips, next follow-up (red "Overdue"/amber "Today" via followUpBucket in the org tz), owner (column for managers only), last activity (relative), deal value (formatMoney), stale badge.
- Search (name/company/email), filters: stage, owner (managers), decision-maker status, objection category, "overdue follow-up", "stale". Sortable columns, pagination (25/page). All state in URL search params.
- "New prospect" dialog (react-hook-form + Zod; objections as a multi-select; owner select visible to managers only, default = current user) → createProspect.
- Row click → /prospects/[id]. Empty, loading (skeleton) and error states.
Check in the browser as both a rep and a manager.
Done when: create/search/filter/sort work, a rep only sees their own rows, and `npm run verify` passes.
```

---

## Prompt 8: Prospect detail page + timeline

```
Read CLAUDE.md and SPEC.md §3, §7, §8, §10, §11. Build /prospects/[id]:
- Header: name, company, stage select (uses the Prompt 6 StageChange flow), owner (managers: reassign select → reassignProspect), deal value + currency, stale badge, close reason/notes if closed, demo date/time if set (org tz).
- Info card, inline editable via updateProspect: email, phone, decision-maker status, objections (multi-select chips) + objection notes, conversation notes, deal value. "Next follow-up" is read-only (derived) with a link to the follow-ups panel.
- Activity timeline, newest first: icon per type, author, timestamp in the org tz + relative time, content; stage_change shows "From → To" (+ close reason); owner_change shows old → new owner.
- "Log activity" form: type (call/conversation/note/demo), content, occurred_at (org tz, default now).
- Follow-ups panel: pending (with due/overdue badges) + completed; add / complete / reschedule / delete.
- A clearly marked slot for <AiInsightsCard prospectId=... /> (implemented in Prompt 11).
- Manager-only "Delete prospect" in an overflow menu with an alert-dialog confirm.
- notFound() if the prospect is missing or not visible under RLS.
Check in the browser.
Done when: every field saves, every stage change (incl. backward/skip/close/reopen) appears in the timeline, a rep gets a 404 on another rep's prospect URL, and `npm run verify` passes.
```

---

## Prompt 9: Kanban pipeline

```
Read CLAUDE.md and SPEC.md §2, §9, §11. Build /pipeline:
- 9 columns in SPEC order; each header shows the count + total deal value of rows with a value (formatMoney; per currency if mixed).
- Card: name, company, owner initials (managers), next follow-up badge (overdue/today), decision-maker badge, stale badge, latest AI deal_health badge if any.
- @dnd-kit drag and drop (pointer + keyboard sensors) between ANY columns. On drop, run the Prompt 6 useStageChange flow: dialog stages wait for Save/Skip; Cancel snaps the card back. Optimistic update with rollback + error toast on failure.
- Filters: owner (managers), search. Horizontal scroll on narrow screens.
- Supabase Realtime on prospects (respecting RLS) so moves by others appear live without a reload.
Check in the browser: forward, backward, skip, close, reopen.
Done when: moves persist after reload, each creates a stage_history row + a timeline entry with the correct user, and `npm run verify` passes.
```

---

## Prompt 10: Follow-ups page + stale deals

```
Read CLAUDE.md and SPEC.md §6, §8, §9. Build /follow-ups:
- Tabs with counts: Overdue, Today, Upcoming (next 7 days), Completed (last 30 days). Bucketing uses org_today() in SQL / followUpBucket in TS, never the browser timezone.
- Row: prospect (link), company, due date, note, owner (managers), Complete, Reschedule (date picker), last conversation snippet.
- Complete → completeFollowUp, then a toast with "Schedule next follow-up" opening a quick form.
- "Needs attention" tab: open-stage prospects that are stale (no activity for stale_days) OR have no pending follow-up, sorted by last_activity_at ascending, with the reason shown.
- Sidebar badge = overdue + today count for the current user (managers: their own).
Done when: the bucketing tests (incl. org-tz edge cases) pass, the data matches the seed, and `npm run verify` passes.
```

---

## Prompt 11: AI insights (OpenAI Responses API)

```
Read CLAUDE.md and SPEC.md §10. Implement:
- src/lib/ai/insights.ts (server-only): build context from the prospect fields, objections + objection notes, conversation notes, demo date, close info, the last 30 activities, stage history, and org today/timezone. Call the OpenAI Responses API with structured output: client.responses.parse({ model: process.env.OPENAI_MODEL, instructions, input, text: { format: zodTextFormat(InsightSchema, "prospect_insight") } }) and use output_parsed.
- InsightSchema: summary (string, ≤ 600 chars), decision_maker_status (yes|no|unknown), main_objection (string), recommended_next_step (string, concrete and actionable), deal_health (high|medium|low).
- The system instructions say: only use the provided facts; say "unknown" when the evidence is missing; never invent dates, names or commitments; this is advice for the salesperson, not a decision.
- Server action generateInsight(prospectId): read the prospect through RLS (no access → error); rate limit with a DB count (≤ 10 insights per user per 10 minutes); call the AI; insert ai_insights (model recorded); insert an ai_insight activity. Errors (no key, timeout 30s, refusal, invalid output) → a friendly { ok:false } and nothing stored.
- <AiInsightsCard />: empty state with a "Generate AI Insights" button; otherwise the latest insight (summary, DM status, main objection, next step, health badge, "generated X ago by Y"), a "Regenerate" button, loading/error states, and a collapsible list of previous insights.
- Human-in-the-loop: if the AI DM status ≠ the prospect's, show "Apply" (updateProspect) and "Dismiss". "Create follow-up from next step" opens the follow-up form prefilled with the note. Nothing is written to the prospect without a click.
- Vitest with a mocked OpenAI client: schema parsing, error paths, no prospect write on generate, rate limit.
Done when: the tests pass, generating on a seeded prospect works locally with a real key, and `npm run verify` passes.
```

---

## Prompt 12: Dashboard

```
Read CLAUDE.md and SPEC.md §1, §6, §12. Build /dashboard around the 6 questions in SPEC §1:
- KPI tiles: total open prospects, open pipeline value (+ "N without value"), due today, overdue, stale deals, win rate (last 90 days).
- "Contact today": today + overdue follow-ups → prospect, note, last conversation snippet, main objections, latest AI next step.
- "Deals needing attention": open prospects ranked by: overdue follow-up > stale > AI health low > no pending follow-up; show the reasons.
- "Latest AI recommendations": the latest recommended_next_step per open prospect (top 5).
- Recent activity feed (last 15, org-tz timestamps).
- Reps see their own data; managers get an owner filter (All / each rep).
- Greeting shows today's date in the org timezone.
Done when: the numbers match manual SQL on the seed data (write that check as a test) and `npm run verify` passes.
```

---

## Prompt 13: Reports

```
Read CLAUDE.md and SPEC.md §12 (follow the metric definitions exactly). Implement:
- SQL functions (SECURITY INVOKER so RLS applies), params (p_from date, p_to date, p_owner uuid null), dates interpreted in the org tz:
  * report_stage_counts(): current count per stage
  * report_funnel(): highest-stage-ever-reached funnel per SPEC §12 for prospects created in the period, with step and overall conversion %
  * report_outcomes(): won, lost, win rate, won value by currency, lost-reason breakdown, for prospects closed in the period
  * report_pipeline_value(): open value by currency + count of open prospects without a value
  * report_follow_ups(): overdue now, due today, completed in the period
- /reports UI: date range picker (presets: this month, last 30/90 days, this quarter, custom), owner filter (managers), KPI tiles, funnel chart, bar chart by stage, lost reasons chart, conversion table. Recharts; empty states.
- A test on a fixed fixture (including skipped stages, a backward move, and a reopened deal) asserting exact funnel counts, conversion %, win rate and pipeline value (nulls ignored).
Done when: the fixture test passes and `npm run verify` passes.
```

---

## Prompt 14: Seed data + end-to-end tests

```
Read CLAUDE.md. Expand supabase/seed.sql: ~40 realistic prospects across all stages for both reps, varied objections, deal values (some null), activities spread over the past 60 days (some stale > 14 days), follow-ups (overdue, today, upcoming, completed), demo dates, consistent stage_history (incl. a skip and a backward move), closed deals with reasons, and a few AI insights. Dates are relative to now() so the seed stays fresh.
Playwright e2e (AI mocked via an env flag that swaps in a fake client, used only in tests):
login as rep → create prospect → log a call → drag to Demo Booked (fill the demo dialog) → Demo Attended (notes + follow-up) → Closed Won (reason required: verify Save is blocked without one) → complete a follow-up → dashboard numbers update · rep B gets a 404 on rep A's prospect · manager reassigns a prospect and sees the owner_change entry · manager changes the org timezone and the "today" bucket changes · invite flow page renders.
Done when: `npm run e2e` passes locally and `npm run verify` passes.
```

---

## Prompt 15: Deploy

```
Read CLAUDE.md. Prepare and deploy production:
- README: overview, local setup (Docker, supabase start, env, seed credentials), scripts, how to create the first manager in production (scripts/create-manager.ts using the service role, run once locally against prod), deploying, changing the org timezone/currency.
- GitHub: create a private repo <name> with gh and push.
- Supabase cloud: link the project, `supabase db push`, Auth → disable signups, set Site URL + redirect URLs (https://<vercel-domain>/auth/confirm), check the invite/reset email templates.
- Vercel: import the repo, set env vars (SUPABASE_SERVICE_ROLE_KEY and OPENAI_API_KEY server-only, never NEXT_PUBLIC), deploy.
- Production smoke test: create the first manager → login → invite a rep → rep sets their password → create prospect → generate an AI insight.
Done when: the production URL passes the smoke test.
```
