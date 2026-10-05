# AI Sales CRM — project guide for Claude

## Project summary

A simple, AI-assisted sales CRM for an **internal** sales team. Only sales reps (`sales_rep`) and managers (`manager`) use it; leads/customers have no access. The salesperson should always know: who to contact, what happened in the last conversation, the main objection, the next follow-up, what the AI recommends next, and which deals need attention.

Core pieces: a flexible pipeline (forward/backward/skip, every change in `stage_history`), prospects with objections and close reasons, an activity timeline, follow-ups (due today/overdue in the org timezone), rule-based workflow prompts (never automatic), manual AI insights (OpenAI Responses API, structured output), dashboard, Kanban, reports, and a minimal manager-only Settings page (org settings + team invites).

## Source of truth

**SPEC.md is the source of truth. Read the relevant section before every task.** If a prompt, this file or existing code conflicts with SPEC.md, SPEC.md wins.

## Out of scope for V1 (do NOT add)

Customer portal · invoicing · payments · inventory · support ticketing · marketing automation · WhatsApp automation · complex email automation (only Supabase auth emails exist) · multiple AI agents · large admin systems · automatic messages/emails · automatic stage changes · multi-currency conversion.

## Conventions

- **Mutations** go through server actions in `src/server/actions` and return `{ ok: true, data } | { ok: false, error }` (type `ActionResult<T>` in `src/server/actions/types.ts`). Expected failures are returned, not thrown.
- **Zod validates every input**, on the client (react-hook-form + `@hookform/resolvers/zod`) and again on the server inside the action. Schemas live in `src/lib/validation/`.
- **RLS is the security boundary.** User-facing code uses the user-scoped Supabase client (`src/lib/supabase/server.ts` on the server, `src/lib/supabase/client.ts` in the browser). The service-role client (`src/lib/supabase/admin.ts`, `server-only`) is **only** for manager-verified admin actions (invites); call `requireManager()` first.
- **All dates/times go through `src/lib/time.ts`** using the org timezone from `org_settings`; store UTC (`timestamptz`). Never hardcode a timezone or currency outside the settings default.
- **AI never writes prospect fields without a user click** ("Apply", "Create follow-up from next step"). No automatic AI calls.
- **After every task run `npm run verify`** (typecheck → lint → test → build) and fix everything until it passes.

More rules:
- Enum values and labels come from `src/lib/constants.ts` (exact SPEC values: stages and their order, objection categories, won/lost reasons, activity types, roles, allowed US timezones, decision-maker status, follow-up status, deal health). Don't redeclare them elsewhere.
- The role comes from `raw_app_meta_data` / `public.users.role`, never from user-editable metadata.
- Activities, stage history and AI insights are append-only. Only managers delete prospects.
- Never send messages/emails or change stages automatically; workflow rules only prompt the user.
- Keep UI on shadcn/ui components (`src/components/ui/`); add new ones with `npx shadcn@latest add <name>`. Note: `form.tsx` was written by hand (the current registry no longer ships it for this style).

## Stack

TypeScript (strict) · Next.js 16 App Router (`src/`) + React 19 · Tailwind CSS v4 · shadcn/ui (radix) · server actions / route handlers · Supabase (Postgres, Auth, RLS, Realtime) via `@supabase/ssr` · Zod v4 · react-hook-form · Recharts · @dnd-kit · date-fns + @date-fns/tz · OpenAI Responses API (`OPENAI_MODEL` env) · Vitest · Playwright · Vercel · GitHub.

Next.js 16 notes: the root middleware file is `src/proxy.ts` (renamed from `middleware.ts`); it should call `updateSession()` from `src/lib/supabase/middleware.ts`. `next lint` no longer exists (`npm run lint` runs `eslint`), and `next build` does not lint. When unsure about a Next API, read `node_modules/next/dist/docs/` (see `AGENTS.md`).

## Layout

```
src/app/                    routes (App Router)
src/components/ui/          shadcn/ui components
src/components/             app components
src/lib/constants.ts        SPEC enums + labels
src/lib/time.ts             org-timezone date helpers (Prompt 4)
src/lib/validation/         Zod schemas
src/lib/ai/                 OpenAI insight generation
src/lib/supabase/           client.ts, server.ts, admin.ts (service role), middleware.ts (updateSession), database.types.ts (generated)
src/server/data/            data functions (ctx, input) used by actions + integration tests
src/server/actions/         server actions (ActionResult)
tests/integration/          data layer vs local Supabase (npm run test:integration)
supabase/config.toml        local Supabase config ([auth] enable_signup = false)
supabase/migrations/        SQL migrations
supabase/tests/             database tests
e2e/                        Playwright tests
```

## Database (Prompt 1)

- Migrations: `supabase/migrations/20261005120000_schema.sql` (enums, tables, indexes) and `..._functions_triggers.sql` (functions, triggers, view, RPC). After any schema change: `npm run db:reset && npm run db:types && npm run test:db`.
- Functions use `set search_path = ''` and schema-qualified names; trigger functions writing other tables are `security definer`. `auth.uid()` is null for seed/system writes (owner change then allowed; `changed_by`/`user_id` null).
- Derived/automatic columns (never write from the app): `prospects.follow_up_date` (min pending follow-up due date; direct edits are ignored), `last_activity_at` (activities trigger), `closed_at`, `created_by`, `updated_at`. Reopening (stage leaves closed) clears `close_reason/close_notes/closed_at` automatically.
- Stage changes from the app go through the RPC `move_prospect_stage(p_prospect_id, p_to_stage, p_close_reason?, p_close_notes?, p_note?)` (security invoker); the note reaches `stage_history.note` and the `stage_change` activity via the tx-local setting `app.stage_change_note`. Triggers write `stage_history` + `stage_change`/`owner_change` activities; never insert those from the app.
- Helpers: `is_manager()`, `org_today()`. View `prospects_with_flags` (security_invoker) adds `is_stale`, `has_overdue_follow_up`; it selects `p.*`, so recreate it when adding prospect columns.
- Role sync: `auth.users.raw_app_meta_data.role` ⇄ `public.users.role` (triggers both ways). Last-manager guard raises `At least one manager must remain` (P0001). Non-manager reassignment raises 42501.

## Row Level Security (Prompt 2)

- Migration `supabase/migrations/20261006120000_rls.sql`; tests `supabase/tests/rls.test.sql` (pgTAP, run as `authenticated` with `request.jwt.claims`).
- RLS on every public table. Reps: own prospects + child rows; managers: everything. Policies only call security-definer helpers `is_manager()` / `can_access_prospect(prospect_id)` (no recursion).
- Grants are tight: `anon` has nothing; `authenticated` gets only what policies need, with **column-level** insert/update grants. Writing a non-granted column fails with 42501. Not writable from the app: `prospects.follow_up_date/last_activity_at/closed_at/created_by/created_at/updated_at`, `follow_ups.owner_id/prospect_id` on update, `created_at` on activities/ai_insights, `users.email`, `org_settings.updated_by`. Don't send these in `.update()/.insert()` payloads.
- Append-only: no update/delete grants on `activities`, `stage_history`, `ai_insights`; no insert on `stage_history`, `users`, `org_settings`. Activity inserts need `user_id = auth.uid()` (default) and `type` not `stage_change`/`owner_change`; ai_insights need `created_by = auth.uid()` (default).
- `users_before_update_guard`: with a signed-in caller, only managers change roles (42501 `Only managers can change roles`) and users only rename themselves. `auth.uid()` null (service role / GoTrue admin) bypasses it.
- USING mismatches are silent (0 rows); check affected rows (`.select()` after update/delete) where it matters.
- New public functions: `revoke execute ... from public, anon` and grant to `authenticated` only if callable from the app; new tables: enable RLS + explicit grants.
- `prospects` is in the `supabase_realtime` publication (for Prompt 9).

## Auth + app shell (Prompt 3)

- `src/proxy.ts` → `updateSession()` + guards: signed out → `/login?next=…` (public: `/login`, `/forgot-password`, `/auth/confirm`); signed in on `/login`/`/forgot-password` → `/dashboard`; non-manager on `/settings*` → `/dashboard`. Path helpers + `safeNextPath()` (open-redirect guard; use it for any `next`/redirect param) live in `src/lib/safe-redirect.ts`.
- `src/lib/auth.ts` (server-only): `getCurrentUser()` → `{ id, full_name, email, role } | null` (React `cache`, `getClaims()` + `public.users`; never `getSession()`), `requireUser()` (→ `/login`), `requireManager()` (rep → `/dashboard`). Every manager-only page/action calls `requireManager()` first; the proxy check is not enough.
- Routes: `src/app/(auth)/` (centered card layout: login, forgot-password, set-password) and `src/app/(app)/` (shell layout: `requireUser()`, sidebar + header, mobile `Sheet`). New app pages go under `(app)/` and start with `<PageHeader title description />` (`src/components/app-shell/page-header.tsx`). Nav items: `src/components/app-shell/nav-items.ts` (`managerOnly` items are filtered out for reps, not hidden by CSS).
- Auth actions in `src/server/actions/auth.ts` (`signIn`, `requestPasswordReset`, `setPassword`, `signOut`); they `redirect()` on success. Zod schemas in `src/lib/validation/auth.ts` (password min 8 = `minimum_password_length` in config.toml).
- Email links: templates `supabase/templates/{invite,recovery}.html` use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite|recovery`; `src/app/auth/confirm/route.ts` accepts only `invite`/`recovery`, `verifyOtp` → `/set-password`, failures → `/login?error=invalid_link`. `getSiteUrl()` (`src/lib/site-url.ts`) builds redirect URLs (`NEXT_PUBLIC_SITE_URL`, fallback request origin).
- Seed users (`supabase/seed.sql`, fixed UUIDs `11111111-1111-4111-8111-00000000000{1,2,3}` = manager, rep Riley, rep Sam) — when seeding `auth.users` directly, also insert `auth.identities`, bcrypt passwords and `''` token columns. pgTAP tests must not assume they create the only manager (demote others in setup). Credentials are in README only.
- E2E: `e2e/auth.spec.ts` (needs local Supabase + seed; reads `.env.local`; Mailpit API for emails). `PLAYWRIGHT_CHANNEL=chrome npm run e2e` uses installed Chrome.

## Org settings, time, money, Team (Prompt 4)

- **Time (`src/lib/time.ts`, pure, @date-fns/tz):** calendar dates are `"YYYY-MM-DD"` strings (`DateString`, = Postgres `date` / `org_today()`); instants are `Date | ISO string`. `orgToday(tz, now?)`, `toOrgDate(utc, tz)`, `formatOrgDateTime(utc, tz, pattern?)`, `formatOrgDate(utc, tz)`, `formatDateString(date)` (no tz shift — use for `due_date`), `orgLocalToUtc(date, "HH:mm", tz)` (demo entry; DST gap → shifted forward, ambiguous → earlier), `utcToOrgLocal(utc, tz)` (prefill inputs), `addDaysToDateString`, `isDateString/isTimeString`, `followUpBucket(dueDate, tz, now?)` → `overdue` (< today) / `today` / `upcoming` (today+1…today+`UPCOMING_DAYS`=7) / `later` — pending follow-ups only. Invalid input throws `RangeError`. Never use `new Date().getDate()`/`toLocaleDateString()` for app dates.
- **Org settings:** server `getOrgSettings()` (`src/lib/org.ts`, React `cache`, user-scoped) → `{ defaultCurrency, timezone, staleDays }`; client `useOrgSettings()` (`src/components/org-settings-provider.tsx`, provided by the `(app)` layout). Type + `DEFAULT_ORG_SETTINGS` in `src/lib/org-settings.ts` (client-safe). New prospects take `defaultCurrency`.
- **Money:** `formatMoney(value, currency, { compact? })` (`src/lib/money.ts`; accepts numeric strings, null → "—"); never sum across currencies. `COMMON_CURRENCIES`, `isSupportedCurrency()`.
- Settings actions (`src/server/actions/settings.ts`): `updateOrgSettings`, `inviteUser` (requireManager → admin `inviteUserByEmail` + `updateUserById({ app_metadata: { role } })`, trigger syncs `public.users.role`; deletes the user if the role update fails), `changeUserRole` (user-scoped; P0001 → friendly last-manager message). Schemas in `src/lib/validation/settings.ts`.
- Local `[auth.rate_limit] email_sent = 100` (invites + resets count). E2E `e2e/settings.spec.ts` creates `e2e-invite-*@example.com` users and deletes them; Playwright runs `workers: 1` (shared DB).

## Data layer + server actions (Prompt 5)

- **Layers:** schemas `src/lib/validation/{prospects,activities,follow-ups,demo,ai,common}.ts` (camelCase inputs; types `XInput = z.input`) → data functions `src/server/data/*.ts` (`server-only`, `fn(ctx, input)` with `ctx = { supabase (user-scoped), user: { id, role } }`; Zod-parse, map errors, return `ActionResult`; no `revalidatePath`/cookies → testable) → `"use server"` wrappers `src/server/actions/{prospects,activities,followUps,demo}.ts` (build ctx via `getActionContext()`/`getManagerActionContext()` in `helpers.ts`, then `revalidateProspect(id)` = /prospects, /prospects/[id], /pipeline, /follow-ups, /dashboard, /reports). "use server" files export only async functions; import schemas from `src/lib/validation`, never from action files. Errors: `dbErrorMessage()`/`dbFailure()`/`MESSAGES` in `src/server/data/errors.ts`.
- **Action API** (all return `ActionResult<T>`; T is the row type from `database.types` unless noted):
  - `createProspect({ name, company?, email?, phone?, decisionMakerStatus?, objections?, objectionNotes?, notes?, dealValue?, currency?, ownerId? })` — owner defaults to the current user (reps may only pass their own id), currency omitted → org default (DB trigger). Starts at stage `prospect`.
  - `updateProspect({ prospectId, ...same editable fields })` — `strictObject`: stage/owner/close/demo/derived keys are rejected; `""`/null clears, omitted = unchanged.
  - `moveProspectStage({ prospectId, toStage, closeReason?, closeNotes?, note? })` → `{ prospect, changed }` via RPC `move_prospect_stage` (note → stage_history + stage_change activity); same stage → `changed: false`; won/lost reason must match the target; open targets reject close fields (reopen clears them in the DB).
  - `reassignProspect({ prospectId, ownerId })`, `deleteProspect({ prospectId })` — manager-only (`requireManager()` redirects reps; DB enforces too).
  - `completeAllPendingFollowUps({ prospectId })` → `{ completed }` (close flow; one `follow_up` activity each).
  - `addActivity({ prospectId, type: call|conversation|note|demo, content, occurredAt? })` — `occurredAt` ISO with offset (or Date), ≤ now + 5 min (`CLOCK_SKEW_MS`); client converts org-local input with `orgLocalToUtc`.
  - `createFollowUp({ prospectId, dueDate, note })` (owner = prospect owner), `rescheduleFollowUp({ followUpId, dueDate })` (pending only), `completeFollowUp({ followUpId, note? })` (completed_by = user; activity content = note ?? task), `deleteFollowUp({ followUpId })` → `{ id, prospectId }`. `dueDate` = org-local `"YYYY-MM-DD"`.
  - `setDemoDetails({ prospectId, demoDate, demoTime: "HH:mm", followUp?: { dueDate, note } })` → `{ prospect, followUp }` (org-local → UTC with the org timezone); `logDemoAttended({ prospectId, notes?, followUp? })` → `{ activity, followUp }` (demo activity; "Demo attended" if no notes). Neither changes the stage — call `moveProspectStage` first.
  - `aiInsightOutputSchema` (`src/lib/validation/ai.ts`) for Prompt 11; org settings/invite schemas live in `validation/settings.ts`.
- **Integration tests:** `npm run test:integration` (`tests/integration/*.test.ts`, `vitest.integration.config.mts`, node env) calls the data functions against local Supabase signed in as Riley (A), Sam (B) and Morgan (M); needs the stack + seed; **not** part of `verify`. Add a case there for every new data function. Tests clean up their `itest-*` prospects.

## Stage-change workflow (Prompt 6)

- **Every UI stage change goes through `useStageChange()`** (`src/components/stage-change/useStageChange.tsx`); never call `moveProspectStage` directly from a stage control. Usage:
  ```tsx
  const { requestStageChange, dialog, isBusy } = useStageChange();
  const result = await requestStageChange(prospect /* { id, name, stage, demo_at? } */, toStage, { pendingFollowUps? });
  // "moved" | "unchanged" (same stage / already there) | "cancelled" (dialog dismissed, nothing written) | "failed" (immediate move failed, toast shown)
  return <>{/* … */}{dialog}</>; // render {dialog} once
  ```
  Kanban: apply the move optimistically, then roll back unless the result is `"moved"`/`"unchanged"`. Needs `OrgSettingsProvider` (the `(app)` layout). Toasts are shown by the hook.
- Rules live in the pure `decideStageFlow(from, to, pendingFollowUps)` (`src/lib/workflow.ts`): same stage → noop; → `demo_booked` / `demo_attended` → dialog (Save / Skip / Cancel) from any direction; → `closed_won`/`closed_lost` (incl. won ↔ lost) → close dialog (reason required, Save disabled until chosen; "Mark N pending follow-ups as completed" only when N > 0, checked by default; no Skip); everything else (forward/backward/skip/reopen) → immediate. For close targets the hook fetches N with `getPendingFollowUpCount` unless passed.
- Save order: `moveProspectStage` first, then `setDemoDetails` / `logDemoAttended` / `completeAllPendingFollowUps`. Move fails → error toast, dialog stays open. Extra fails → error toast but the result is still `"moved"`.
- Defaults: demo follow-up due = demo date + 1 (follows the demo date until edited), demo-attended follow-up = org today + 2, note "Follow up after demo"; existing `demo_at` is prefilled. Time labels use `timeZoneAbbreviation(tz)` (Intl, e.g. "ET"). `StageChangeDialog` is presentational (props `request/timezone/saving/onSubmit/onCancel`); form schemas + mappers to action inputs are in `src/lib/validation/stage-change.ts`.

## Prospects list (Prompt 7)

- `/prospects` (`src/app/(app)/prospects/(list)/` — a route group since Prompt 8, URL unchanged) is server-rendered from URL params: `parseProspectListParams()` (`src/lib/validation/prospect-list.ts`, every key parsed independently, invalid → default, never throws), `prospectListHref(params, overrides)` (non-default values only; any change but `page` resets to page 1), `sortHref`, `clearFiltersHref`, `hasActiveFilters`. Params: `q, stage, owner (managers only), dm, objection, overdue=1, stale=1, sort (name|company|stage|follow_up|last_activity|deal_value), dir, page`; 25/page.
- Data: `listProspectsData(ctx, params)` (`src/server/data/prospect-list.ts`) queries the `prospects_with_flags` view (security_invoker → RLS) with the user-scoped client, `count: "exact"`, sort whitelist + `id` tiebreaker, nulls last, page past the end → last page; ignores `owner` for reps. Returns `ProspectListRow` (non-null view row).
- **Free-text search in PostgREST `.or()`: always use `searchOrFilter(term, columns)`** (escapes `\ % _` for ILIKE, maps `*` → `_` because PostgREST turns `*` into `%`, double-quotes the value so `, ( ) .` can't add clauses). Never interpolate user input into `.or()` directly.
- Reusable UI in `src/components/prospects/` (use these in Prompts 8–10): `StageBadge`, `FollowUpBadge({ dueDate, timezone, now? })` (red Overdue / amber Today via `followUpBucket`), `OverdueBadge`, `StaleBadge`, `ObjectionChips({ objections, max? })`, `DecisionMakerLabel` (server-safe, no hooks) · `ObjectionMultiSelect({ value, onChange })` (Popover + Command; wrap in `<FormControl>`) · `NewProspectDialog({ currentUserId, owners? })` (owners = managers only → owner select, default current user; deal value labelled with the org currency; toast with "View" action + `router.refresh()`).
- `formatRelativeTime(utc, now?)` in `time.ts` ("just now", "3 days ago"); show the absolute org-tz time in a `title`. `PageHeader` has an `actions` slot.
- Radix `SelectValue` renders empty on the server — pass the selected label as children (`<SelectValue>{label}</SelectValue>`) for URL-driven selects. Row click: `ProspectRowLink` (`<tr onClick>`; keyboard via the real link in the name cell).
- Seed (`supabase/seed.sql`): 8 demo prospects (`22222222-2222-4222-8222-0000000000NN`; Riley 01–05, Sam 06–08) + 5 pending follow-ups (`33333333-…`), dates relative to `now()`/`org_today()` (Riley: overdue Jordan Lee, stale Marcus Chen; Sam: overdue+stale Aisha Khan). Integration (`tests/integration/prospect-list.test.ts`) and e2e (`e2e/prospects.spec.ts`) rely on these; keep them when Prompt 14 expands the seed.

## Prospect detail page (Prompt 8)

- `/prospects/[id]` (`src/app/(app)/prospects/[id]/`): `params` is a Promise; non-uuid ids → `notFound()`; the prospect is read through RLS (`getProspectDetailData` → `prospects_with_flags`, null when missing **or** hidden) → `notFound()` → real HTTP 404 (`not-found.tsx`). **No `loading.tsx` above `[id]`** (that's why the list lives in the `(list)` route group): a loading boundary would commit a 200 before `notFound()`. Heavy sections stream in `<Suspense>` (`detail-skeletons.tsx`); `error.tsx` boundary.
- Data (`src/server/data/prospect-detail.ts`): `getProspectDetailData`, `listProspectActivitiesData` (newest first, cap `ACTIVITY_LIMIT` 500 + `truncated`), `listProspectStageHistoryData`, `listProspectFollowUpsData` → `{ pending (due asc), completed (completed_at desc) }`, `listTeamData` (all users; author/owner names + reassign options). Types `ProspectDetail`, `TeamMember`.
- **Timeline:** pure `buildTimeline({ activities, stageHistory, users })` (`src/lib/timeline.ts`) → entries newest first with `authorName` (`"System"` for null `user_id`), defensive metadata parsing (`stage_change` from/to + close reason label via `closeReasonLabel(stage, reason)` in constants, `owner_change` names, `follow_up` task/due, `ai_insight` `metadata.deal_health` + content = summary) and a synthetic "Prospect created" entry from the first `stage_history` row. Rendered by `[id]/timeline.tsx` (server-safe; `data-activity-type` per item). **Prompt 11:** write `ai_insight` activities with `content` = summary and `metadata { insight_id, deal_health }` to get the badge.
- Log activity (`[id]/log-activity-form.tsx`): `makeActivityFormSchema(tz)` + `toActivityCreateInput` (`validation/activities.ts`); org-local date/time; unchanged prefilled "now" → `occurredAt` omitted (server `now()`).
- **Reusable follow-up UI** (`src/components/follow-ups/`): `FollowUpForm({ prospectId, defaultDueDate?, defaultNote?, submitLabel?, onDone?, onCancel? })` (default due = org today + 1; Prompt 11 "Create follow-up from next step" passes `defaultNote`; Prompt 10 "Schedule next follow-up") and `CompleteFollowUpButton` / `RescheduleFollowUpButton` / `DeleteFollowUpButton({ followUp, onDone? })`.
- **AI slot:** `<AiInsightsCard prospectId />` (`src/components/ai/ai-insights-card.tsx`) in the page's right column — implemented in Prompt 11 (see below).
- Header (`[id]/prospect-header.tsx`): stage select via `useStageChange()` with an optimistic value that reverts unless `"moved"` (`useOptimisticValue` pattern: dropped when the server value changes); managers get the owner select (`reassignProspect`) and the "More actions" menu → Delete (alert dialog → `deleteProspect` → `router.replace("/prospects")`). Info card edit mode uses `prospectDetailsFormSchema` + `changedProspectFields()` (only changed fields go to `updateProspect`).
- Tests: `tests/integration/prospect-detail.test.ts`, `e2e/prospect-detail.spec.ts` (`e2e-detail-*` prospects created with the service role, deleted in `afterAll`).

## Kanban pipeline (Prompt 9)

- `/pipeline` (`src/app/(app)/pipeline/`): server page filtered from URL params `q` + `owner` (managers only) via `parsePipelineParams` / `pipelineHref` (`src/lib/validation/pipeline.ts`); data `listPipelineData(ctx, params)` (`src/server/data/pipeline.ts`, `prospects_with_flags` + `searchOrFilter`, newest activity first, `PIPELINE_LIMIT` 500 → `truncated` note; limit + 1 must stay ≤ PostgREST `max_rows` 1000). Filtering is server-side so a Realtime `router.refresh()` re-runs the same RLS query.
- **Latest AI insight per prospect:** view `public.latest_ai_insights` (security_invoker, `distinct on (prospect_id)` newest first; migration `20261007120000_pipeline.sql`). Embed it: `.from("prospects_with_flags").select("…, latest_ai_insights(deal_health)")` (array of 0/1 rows) — reuse for Prompts 11/12.
- Pure helpers `src/lib/pipeline.ts`: `PipelineCard`, `summarizeColumn` (count + per-currency totals in cents, nulls ignored), `groupByStage`, `initials`, optimistic `applyOverrides` / `reconcileOverrides` (`{ from, to, settled }`: unsettled = in flight, always wins over snapshots; settled = dropped once the server shows a stage ≠ `from`; overrides of vanished cards dropped).
- Board (`pipeline-board.tsx`): @dnd-kit/core `DndContext id="pipeline-board"` (stable SSR ids); sensors = mouse/pen `PointerSensor` subclass (6 px; touch excluded) + `TouchSensor` (250 ms long-press) + `KeyboardSensor` (start **Space** only, Enter opens the card; custom coordinate getter jumps one column per ←/→; `scrollBehavior: "auto"`); collision `pointerWithin` → `rectIntersection`; `DragOverlay`; announcements with names/stage labels. Drop → override → `requestStageChange` → snap back on cancelled/failed. The scroll container is `relative` (otherwise absolutely positioned `sr-only` spans inside it widen the page).
- **Realtime:** `useProspectsRealtime({ userId, onChange })` (`src/components/realtime/use-prospects-realtime.ts`; mount once per page) → `realtime.setAuth()` then `postgres_changes` on `prospects` + private broadcast topic `user:<userId>` (event `prospect_owner_changed`), debounced 400 ms; re-subscribe also fires. RLS: INSERT/UPDATE only reach subscribers who can see the new row; DELETE carries only the PK to everyone. A reassigned-away rep gets no UPDATE, hence the trigger `prospects_broadcast_owner_change` → `realtime.send(…, 'user:' || old.owner_id, private)` + policy on `realtime.messages` (a user may only read topic `user:<own id>`). The first `postgres_changes` subscription after `db:reset` needs a few seconds before events flow (integration test warms up).
- Tests: `src/lib/{pipeline,validation/pipeline}.test.ts`, `supabase/tests/pipeline.test.sql` (16), `tests/integration/pipeline.test.ts` (board RLS/filters/latest insight + Realtime RLS: rep B gets none of rep A's events and can't join `user:<A>`), `e2e/pipeline.spec.ts` (keyboard + mouse drags, dialogs, history rows, two-context Realtime). Playwright keyboard drag: `focus()`, `Space`, arrows with ~150 ms gaps, `Space`.

## Follow-ups page (Prompt 10)

- **One bucketing definition, in SQL** (migration `20261008120000_follow_ups.sql`): pure `follow_up_bucket(status, due_date, completed_at, now, tz)` → `overdue` (< today) / `today` / `upcoming` (≤ today+7) / `later` for pending, `completed` (org-tz date of `completed_at` ≥ today−29, i.e. the 30 org days ending today) or null. View `follow_up_buckets` (security_invoker, `f.*` + `bucket` with `now()` + org tz; recreate when follow_ups gains columns) feeds **both** the tab lists and the RPC `follow_up_bucket_counts(p_owner_id?)` → `{ overdue, today, upcoming, completed }`. TS mirror `followUpViewBucket()` + `COMPLETED_WINDOW_DAYS` in `time.ts` (same edge cases in vitest + pgTAP; integration test checks SQL = TS for every row). Don't re-implement bucketing elsewhere.
- View `latest_conversation_activities` (newest call/conversation/note with content per prospect; `snippet` = first 280 chars, `content_length`; partial index) — embed it: `prospects(…, latest_conversation_activities(type, snippet, content_length, occurred_at))`; display with `truncateSnippet()` (`src/lib/follow-ups.ts`).
- **Reusable reads for the Dashboard** (`src/server/data/follow-up-views.ts`, ctx pattern, owner filter honoured for managers only): `getFollowUpCountsData(ctx, { ownerId? })`, `getFollowUpBadgeCountData(ctx)` (own overdue + today), `listFollowUpsData(ctx, { tab: overdue|today|upcoming|completed, ownerId?, limit? })` → `{ rows: FollowUpListRow[], truncated }` ("contact today" = `overdue` + `today`), `listNeedsAttentionData(ctx, { ownerId?, limit? })` → `{ rows: NeedsAttentionRow[] (reasons stale/no_follow_up), total }` (open stages, `is_stale` or `follow_up_date is null`, `last_activity_at` asc), `countNeedsAttentionData`. Schemas in `validation/follow-ups-page.ts` (+ URL `parseFollowUpsParams`/`followUpsHref`: `tab` default `overdue`, `owner`).
- `/follow-ups`: server page, tab links with counts (`nav[aria-label="Follow-up views"]`), list in `<Suspense key={tab+owner}>` (skeleton on tab switch). Rows via `FollowUpList` / `NeedsAttentionList` (client; they render the schedule dialog **above** the rows so it survives the completed row disappearing).
- `CompleteFollowUpButton` takes `nextAction={{ label, onClick(completed) }}` → button on the success toast (10 s). `useScheduleFollowUp()` (`src/components/follow-ups/schedule-follow-up-dialog.tsx`) → `{ openScheduleFollowUp({ prospectId, prospectName }, { title? }), dialog }` wraps `FollowUpForm` in a dialog (render `{dialog}` once).
- Sidebar badge: `(app)/layout.tsx` → `getFollowUpBadgeCountData` → `NavLinks`/`MobileNav` `badges={{ "/follow-ups": { count, label } }}` (`data-nav-badge`; failure → no badge). Server-action revalidation (`revalidateProspect`) re-renders the layout, so the badge updates after complete/reschedule/create without extra work.
- Tests: `supabase/tests/follow_ups.test.sql` (40), `src/lib/{time,follow-ups,validation/follow-ups-page}.test.ts`, `tests/integration/follow-ups.test.ts` (seed counts per user, counts = list lengths, parity, lifecycle), `e2e/follow-ups.spec.ts` (counts relative to the first render).

## AI insights (Prompt 11)

- **One call, manual only.** `generateInsight({ prospectId })` (`src/server/actions/ai.ts`) → `generateInsightData(ctx, input, deps?)` (`src/server/data/ai-insights.ts`): RLS read of the prospect (no access → not found, before anything else) → rate limit RPC `ai_insight_recent_count()` (DB clock, own rows, ≥ `AI_RATE_LIMIT` 10 per 10 min → blocked before the AI call) → `getAiClient()` → `buildInsightContext()` → `requestInsight()` → RPC `record_ai_insight(...)` (security invoker; inserts the insight **and** its `ai_insight` activity in one tx, re-checks the limit under an advisory lock). Never writes `prospects`; failures return `{ ok: false }` with `AI_MESSAGES` text and store nothing. `listProspectInsightsData` → newest first + `author_name`.
- `src/lib/ai/`: `context.ts` (pure, deterministic; org-tz dates; last 30 activities excluding `ai_insight`/`stage_change`; full stage history; no email/phone; field caps), `instructions.ts`, `insights.ts` (`server-only`; `responses.parse` + `zodTextFormat(aiInsightOutputSchema, "prospect_insight")`, `store: false`, 30 s overall `AbortSignal.timeout`, refusal / incomplete / null `output_parsed` / ZodError / 401 / 404 / 429 / timeout mapping), `client.ts` (`server-only`; `getAiClient(env)` needs `OPENAI_API_KEY` + `OPENAI_MODEL`, never a hardcoded model; SDK `timeout` 30 s, `maxRetries` 1), `types.ts` (`AiClient` = the minimal `responses.parse` surface; inject mocks via `deps.getAiClient`), `suggestions.ts` (`shouldSuggestDecisionMaker`: AI status ≠ prospect's and ≠ `unknown`), `limits.ts` (mirror the SQL numbers).
- **Fake AI flag:** `AI_FAKE=1` selects the deterministic `fake.ts` client (no network, model `fake-ai`; DM `unknown` → suggests `yes`) **only** when `NODE_ENV !== "production"` and `VERCEL_ENV` is not production/preview (`isFakeAiEnabled`, unit-tested). Playwright's webServer sets it (`playwright.config.ts`); a reused dev server must be started with `AI_FAKE=1 npm run dev`. Integration tests pass `getAiClient({ AI_FAKE: "1", NODE_ENV: "test" })` via deps.
- UI: `AiInsightsCard` (server, own `<Suspense>`) → client `AiInsightsPanel` (Generate / Regenerate with pending + inline `role="alert"` error, latest insight with `DealHealthBadge` (shared with Kanban, in `prospect-badges.tsx`), Apply → `updateProspect`, Dismiss = local state only, "Create follow-up from next step" → `useScheduleFollowUp()` with `defaultNote`, collapsible previous insights). Test ids: `ai-insight-latest`, `ai-dm-suggestion`, `ai-insight-history`, `ai-insights-error`.
- Tests: `src/lib/ai/*.test.ts`, `src/server/data/ai-insights.test.ts` (mocked Supabase + AI), `supabase/tests/ai_insights.test.sql` (22), `tests/integration/ai-insights.test.ts` (fake client; frees Sam's rate-limit window by deleting its prospects), `e2e/ai-insights.spec.ts`.

## Dashboard (Prompt 12)

- **Shared metric definitions in SQL** (migration `20261010120000_dashboard.sql`, security invoker → RLS; reuse in Prompt 13, don't redefine):
  - `open_pipeline_value(p_owner_id?)` → rows `(currency, total_value, prospect_count)` of **open** prospects per currency; the row with `currency = null` (total null) = open prospects **without a value** (SPEC §12). Sum of `prospect_count` = open prospects. `report_pipeline_value()` should wrap it. TS: `getPipelineValueData(ctx, { ownerId })` → `summarizePipelineValue()` → `{ totals: [{ currency, total, count }], withoutValueCount, openCount }`.
  - `closed_outcome_counts(p_from date, p_to date, p_owner_id?)` → `(won, lost)` of prospects currently closed whose **org-tz date of `closed_at`** is in `[from, to]` (inclusive). TS: `getClosedOutcomeCountsData(ctx, { from, to, ownerId })` → `{ won, lost, rate, from, to }`; pure `winRate(won, lost)` (null when 0 closed) / `formatWinRate` ("—"). `report_outcomes()` should reuse it.
  - `latest_ai_insights` now also exposes `recommended_next_step`, `main_objection`.
  - View `deals_needing_attention` (open deals with ≥ 1 reason; flags `has_overdue_follow_up`, `is_stale`, `low_health` (latest insight low), `no_follow_up`; `attention_rank` 1 overdue > 2 stale > 3 AI low > 4 no follow-up). Order: `attention_rank, follow_up_date asc nulls last, last_activity_at, id`. TS mirror `rankDealsNeedingAttention()` / `attentionReasons()` in `src/lib/dashboard.ts` (unit-tested; integration checks SQL = TS).
- Data functions `src/server/data/dashboard.ts` (ctx pattern; `ownerId` honoured for managers only via `effectiveOwner` from `follow-up-views.ts`): `getDashboardKpisData(ctx, { ownerId, today })` (4 queries in parallel; due today/overdue = `getFollowUpCountsData`, stale = `prospects_with_flags.is_stale`, win rate = 90 org days ending `today` via `winRateWindow`), `countStaleDealsData`, `listContactTodayData` (`follow_up_buckets` overdue+today with objections, snippet, latest AI next step embedded), `listDealsNeedingAttentionData` (top 10 + total), `listLatestAiRecommendationsData` (top 5, open prospects, newest insight first), `listRecentActivityData` (15, owner = prospect owner).
- `/dashboard`: greeting (`greetingFor(tz)` org-local hour + `firstName`) + org-tz date; manager owner select (`?owner=`, `parseDashboardParams`/`dashboardHref`; unknown ids → All; reps' param ignored); KPI tiles link to filtered pages (`data-kpi`, `data-kpi-value`); each section in its own `<Suspense>` (`data-section`, `role="region"` named by title). Activity icons/titles/detail shared with the prospect timeline: `src/components/timeline/activity-entry.tsx`.
- Tests: `src/lib/{dashboard,validation/dashboard}.test.ts`, `supabase/tests/dashboard.test.sql` (32), `tests/integration/dashboard.test.ts` (every KPI/list vs **hand-written SQL via `psql`** as postgres — needs `psql` on PATH or `SUPABASE_DB_URL`; A, B, rep with a spoofed owner, M All + filtered; seed + fixture incl. a win 100 days ago), `e2e/dashboard.spec.ts`.

## Reports (Prompt 13)

- **Metric SQL** (migration `20261011120000_reports.sql`; all `security invoker` + `search_path = ''` → RLS; a rep passing another owner gets zeros / no rows; params `p_from date, p_to date, p_owner_id uuid default null`). Period = org calendar days `[p_from, p_to]` = instants `[p_from 00:00, p_to+1 00:00)` in the org tz via `org_period_bounds()` (reversed → 22023). Shared cohorts: `prospects_created_in_period()` (funnel) and `prospects_closed_in_period()` (currently closed, `closed_at` in the period; `closed_outcome_counts()` now wraps it). `stage_funnel_rank(stage)` = SPEC §2 order 1–8, `closed_lost` null.
  - `report_stage_counts(owner)` → 9 rows, current stage, **now** (not period-filtered), zero-filled; total prospects = sum.
  - `report_stage_reached(from, to, owner)` → 8 ranked stages: prospects **created in the period** whose highest stage ever reached (max rank over all `stage_history` from/to + current stage; nothing ranked → `prospect`) is ≥ X. Skips count skipped stages, backward moves never lower it, a reopened deal that ends won counts everywhere, reaching `follow_up` implies ≥ Demo Attended.
  - `report_funnel(…)` → 7 steps (reached minus `follow_up`) + `step_conversion_pct` (vs previous step; null for step 1 / previous 0) + `overall_conversion_pct` (vs Prospects; Closed Won row = SPEC overall), 1 decimal.
  - `report_outcomes(…)` → prospects **closed in the period** (current state): won, lost (via `closed_outcome_counts`), `win_rate_pct` (null when none), `won_value` jsonb `[{currency,total,count}]` (nulls ignored), `won_without_value`, `lost_reasons` jsonb `[{reason,count}]`.
  - `report_pipeline_value(owner)` = `open_pipeline_value()` (now). `report_follow_ups(…)` → overdue + due today **now** (`follow_up_bucket_counts`) + completed in the period (owner = `follow_ups.owner_id`).
  - SPEC §12 counts on the page: contacted … follow-ups = `report_stage_reached` (created in period); closed won / lost = `report_outcomes` (closed in period).
- TS: `src/lib/reports.ts` (presets `this_month | last_30 | last_90 | this_quarter | custom` → `resolveReportRange(preset, orgToday)`, `formatPct`, RPC mappers incl. zero-filled lost reasons), `src/lib/validation/reports.ts` (URL `range` default `last_30`, `from`/`to` custom only — invalid/reversed/> 731 days → default, `owner`; `reportsHref`, `reportRangeFor`, `reportQuerySchema`), `getReportData(ctx, { from, to, ownerId })` (`src/server/data/reports.ts`, 6 RPCs in parallel, owner for managers only).
- `/reports`: header period + scope, `ReportFilters` (client; keyed by the URL so state resets), 8 KPI tiles (`data-kpi`), Counts strip (`data-count`), Funnel + Conversion table (`data-testid="conversion-table"`, `data-step`, `overall-conversion`, `win-rate`), Prospects by stage, Lost reasons — Recharts `HorizontalBarChart` (client, single series `--viz-series-1` light `#2a78d6` / `.dark` `#3987e5`, sr-only data table); one `<Suspense>` keyed by period + owner; empty states. `SectionCard`/`SectionEmpty` moved to `src/components/section-card.tsx`.
- Tests: `supabase/tests/reports.test.sql` (53; clean-slate fixture built with real `move_prospect_stage` calls), `src/lib/{reports,validation/reports}.test.ts`, `tests/integration/reports.test.ts` (data layer + psql timestamp pinning; `created_at` is trigger-immutable → `session_replication_role = replica`), `e2e/reports.spec.ts` (June 2022 fixture).

## Commands

- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm run test` · `npm run test:integration` (local Supabase; not in verify) · `npm run e2e`
- `npx supabase start|stop|status` (Docker) · `npm run db:reset` · `npm run db:types` (regenerates `src/lib/supabase/database.types.ts`)
- `npm run verify` = typecheck && lint && test && build
- `npm run test:db` = `supabase test db` (pgTAP files in `supabase/tests/*.test.sql`; needs the local stack running; **not** part of `verify`). Run it after every migration change.
- Supabase CLI is a devDependency; always use `npx supabase` / npm scripts, never a global install.
- Vitest runs `src/**/*.test.{ts,tsx}` (jsdom; `server-only` is stubbed). Playwright browsers: `npx playwright install chromium` before the first `npm run e2e`.
- Env: copy `.env.example` → `.env.local` (values from `npx supabase status`). Never commit `.env*` files except `.env.example`.

## Build process

The app is built by executing the prompts in `BUILD_PROMPTS.md` **in order**, one per session. Each prompt is first rewritten into an enhanced, checkable execution plan saved in `prompts/enhanced/NN-<name>.md`, then executed and verified (`npm run verify` + the prompt's "Done when"). Progress, verification results, commits and deferred blockers are tracked in `BUILD_PROGRESS.md`.

@AGENTS.md
