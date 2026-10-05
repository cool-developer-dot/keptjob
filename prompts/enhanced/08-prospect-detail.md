# Prompt 8 (enhanced): Prospect detail page + timeline

Source: `BUILD_PROMPTS.md` → "Prompt 8: Prospect detail page + timeline". `SPEC.md` §3 (fields, derived next follow-up, close reasons), §4 (reps only their own prospects; managers reassign + delete; append-only history), §6 (org timezone for activity timestamps and demo date/time), §7 (activity types), §8 (follow-ups), §9 (stage-change prompts), §10 (AI insights live on this page — slot only), §11 (Prospect Details page) are the source of truth; SPEC wins any conflict. Nothing from SPEC §14 (no emails/messages, no automation, no currency conversion). No schema changes.

Goal: `/prospects/[id]` shows everything a rep needs about one prospect — header with stage + owner controls, editable info card, follow-ups panel, activity timeline with a "Log activity" form, and the AI insights slot — reusing the Prompt 5 actions, the Prompt 6 stage-change flow and the Prompt 7 badges.

---

## 0. What already exists (reuse, do not rebuild)

- Actions (`src/server/actions/*`, all `ActionResult`): `updateProspect` (strict: editable fields only), `moveProspectStage` (only via `useStageChange()`), `reassignProspect` / `deleteProspect` (manager-only, `requireManager()`), `addActivity` (`occurredAt` ISO, ≤ now + 5 min), `createFollowUp`, `completeFollowUp`, `rescheduleFollowUp`, `deleteFollowUp`. All call `revalidateProspect(id)` → `/prospects/[id]` re-renders after a mutation.
- `useStageChange()` (`src/components/stage-change/`): `requestStageChange(prospect, toStage)` → `"moved" | "unchanged" | "cancelled" | "failed"`; renders the demo/close dialogs; toasts itself.
- DB: triggers write `stage_history` + `stage_change` activity (`metadata { from, to, close_reason }`, `content` = optional note) and `owner_change` activity (`metadata { from_owner, to_owner }`, `content` null); the insert trigger writes the initial `stage_history` row (`from_stage` null) but **no activity**. `follow_up` activities (`metadata { follow_up_id, due_date, task, bulk? }`). `activities.user_id` is null for system/seed writes. `prospects.follow_up_date` is derived. `prospects_with_flags` view adds `is_stale` / `has_overdue_follow_up` (security_invoker → RLS).
- `public.users` is readable by every authenticated user (author/owner names, reassign options).
- `src/lib/time.ts` (`formatOrgDateTime`, `formatRelativeTime`, `timeZoneAbbreviation`, `orgLocalToUtc`, `utcToOrgLocal`, `orgToday`, `addDaysToDateString`, `formatDateString`, `followUpBucket`), `src/lib/money.ts` (`formatMoney`, `COMMON_CURRENCIES`), `src/lib/constants.ts` labels, `src/components/prospects/*` (`StageBadge`, `FollowUpBadge`, `StaleBadge`, `ObjectionChips`, `DecisionMakerLabel`, `ObjectionMultiSelect`).
- shadcn: card, badge, button, select, dropdown-menu, alert-dialog, popover, dialog, form, input, textarea, skeleton, separator, tooltip, sonner.

## 1. Design decisions + pitfalls (read first)

### Route, 404 and loading
1. **Next 16: `params` is a Promise** → `const { id } = await params`. Validate `id` with `uuidSchema` (`z.uuid`) → `notFound()` for anything that isn't a uuid (no DB call, no 500 from Postgres `22P02`).
2. Load the prospect **through RLS** (user-scoped client, `prospects_with_flags`, `.maybeSingle()`): missing **or hidden by RLS** (another rep's prospect) → `notFound()`. Same 404 for both, so a rep can't probe for existence.
3. **Real HTTP 404:** a `loading.tsx` above the page starts streaming (status 200 is committed before `notFound()`; see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md` → Status Codes). So: move the list's `loading.tsx`/`error.tsx`/`page.tsx` (+ its private components) into a route group `src/app/(app)/prospects/(list)/` (URL unchanged), give `[id]` **no `loading.tsx`**, do the existence check before any Suspense boundary, and stream the heavy sections (timeline, follow-ups) inside `<Suspense>` with skeleton fallbacks. `[id]/not-found.tsx` renders "Prospect not found" + "Back to prospects" inside the app shell; `[id]/error.tsx` (client, Next 16.3 `retry` prop) for unexpected failures.
4. Phase 1 (before Suspense, in parallel): prospect (view row) + users (`id, full_name, role`). Phase 2 (in Suspense, in parallel): activities (newest first, `occurred_at desc, created_at desc`, cap 500 with a "showing latest 500" note), stage history (for the "created" entry), follow-ups. Author/owner names come from the users map (one query; also resolves `owner_change` ids from metadata). Data functions in `src/server/data/prospect-detail.ts` (`ctx` pattern, testable).

### Header (`prospect-header.tsx`, client)
5. Name (h1), company, `StageBadge`-coloured stage **select** (all 9 stages, SPEC order) → `requestStageChange(prospect, to)`. The select shows the target optimistically and **reverts on `cancelled`/`failed`/`unchanged`**; on `moved` it keeps the target until the server prop arrives (no flicker); local optimistic state is dropped whenever the server stage changes (render-time adjustment, no setState in effects). Disabled while `isBusy`. `{dialog}` rendered once.
6. Owner: managers → select of all users (name + role) → `reassignProspect` (same optimistic/revert pattern, toast "Reassigned to X"); reps → owner name text.
7. Deal value via `formatMoney(deal_value, currency)` ("No deal value" muted when null); `StaleBadge` when `is_stale`; Overdue badge when `has_overdue_follow_up`.
8. Closed stages: outcome line with the label from `WON_REASON_LABELS` / `LOST_REASON_LABELS` (helper `closeReasonLabel(stage, reason)` in constants), close notes, closed date (org tz).
9. Demo date/time when `demo_at` is set: `formatOrgDateTime(demo_at, tz)` + `timeZoneAbbreviation(tz, demo_at)` (e.g. "Oct 8, 2026 2:30 PM ET").
10. Manager-only overflow menu (`DropdownMenu`, `EllipsisVertical` button, aria-label "More actions") → "Delete prospect" → `AlertDialog` ("This permanently deletes … its activities, follow-ups and history") → `deleteProspect` → toast → `router.replace("/prospects")`. Reps don't get the menu at all (not hidden by CSS).

### Info card (`prospect-info-card.tsx`, client)
11. View mode: name, company, email (mailto), phone (tel), decision maker, objections (chips) + objection notes, conversation notes (whitespace preserved), deal value + currency, **Next follow-up (read-only, derived)** = `FollowUpBadge(follow_up_date)` + link "View follow-ups" → `#follow-ups`. Created / updated (org tz).
12. "Edit" switches the card into a react-hook-form form (in place) with `zodResolver(prospectDetailsFormSchema)` (built from the same field schemas as `prospectUpdateSchema`, exported from `validation/prospects.ts`). Objections via `ObjectionMultiSelect`; currency select (`COMMON_CURRENCIES` + the current code if not in the list); deal value text input `inputMode="decimal"`. Save sends **only changed fields** (compare parsed output with the parsed initial values) to `updateProspect`; nothing changed → just close. Error → toast, stay in edit mode with the user's input. Busy state disables buttons. Cancel/Esc restores values. "Next follow-up" is not part of the form.

### Follow-ups panel (`follow-ups-panel.tsx`, client; `id="follow-ups"`)
13. Pending (due date asc) with `FollowUpBadge` (red Overdue / amber Today) + note; Completed (completed_at desc; completed date + by whom). Empty states.
14. Actions per pending item: **Complete** (popover: optional outcome note → `completeFollowUp`), **Reschedule** (popover: date input, default current due date → `rescheduleFollowUp`), **Delete** (alert-dialog confirm → `deleteFollowUp`; also on completed items). "Add follow-up" opens the reusable **`FollowUpForm`** (`src/components/follow-ups/follow-up-form.tsx`: RHF + `followUpInputSchema`, props `prospectId, defaultDueDate?, defaultNote?, onDone?, onCancel?`; default due = org today + 1; Prompts 10/11 reuse it). Toast on success/error; buttons disabled while busy.

### Timeline (`timeline.tsx`, server-safe) + pure builder (`src/lib/timeline.ts`)
15. `buildTimeline({ activities, stageHistory, users })` (pure, unit-tested) → entries newest first (`occurred_at desc`, then `created_at desc`), each with `authorName` (`"System"` when `user_id` is null, `"Former user"` if the id isn't in the users map). Metadata is parsed defensively (unknown/invalid enum values → no badge, never a crash):
   - `stage_change`: "From → To" with stage labels (`StageBadge`), close reason label when the target is closed, note (content).
   - `owner_change`: "Old owner → New owner" (names resolved from `metadata.from_owner/to_owner`).
   - `follow_up`: "Completed follow-up" + task (`metadata.task`) and outcome note when different; due date.
   - `ai_insight`: "AI insight generated" + content (summary) + deal health label if `metadata.deal_health` is valid (Prompt 11 writes these).
   - call / conversation / note / demo: content (whitespace preserved).
   - plus a synthetic "Prospect created" entry from the initial `stage_history` row (`from_stage` null) with its stage + `changed_by`.
16. Each item: lucide icon per type, type label, author, `<time dateTime title>` with `formatOrgDateTime(occurred_at, tz)` + tz abbreviation and `formatRelativeTime` ("3 hours ago").
17. **Log activity** (`log-activity-form.tsx`, client): "Log activity" button reveals the form (so "now" is computed on click, never during SSR → no hydration mismatch): type select (`MANUAL_ACTIVITY_TYPES`: call/conversation/note/demo), content (textarea), date + time inputs **in the org tz** labelled with the tz abbreviation, defaulting to `utcToOrgLocal(now, tz)`. Submit → `orgLocalToUtc(date, time, tz).toISOString()` → `addActivity`; future time (> now + 5 min) → field error before the call. If the prefilled date/time were left unchanged, `occurredAt` is omitted (server `now()`), so the entry keeps second precision and stays on top of the newest-first timeline (an "HH:mm" value would sort below changes made earlier in the same minute). Schema `activityFormSchema` in `validation/activities.ts`.

### AI insights slot
18. `<AiInsightsCard prospectId={…} />` stub in `src/components/ai/ai-insights-card.tsx` (card "AI insights", explanatory text, no API calls), rendered in the page's right column inside a `{/* Prompt 11: AI insights slot */}` comment. Prompt 11 replaces the component body; the page stays unchanged.

### Layout
19. Desktop (`lg`): 3-column grid — info card + timeline (2 cols), right column (follow-ups, AI insights). Mobile (375 px): one column in the order header → info → follow-ups → AI → timeline; header controls wrap; no page-level horizontal scroll; selects full width on mobile.

### Out of scope
AI generation (Prompt 11), editing/deleting activities (append-only), editing stage history, Kanban (9), follow-ups page (10), emails/messages, stage changes without the Prompt 6 flow.

## 2. Files

| File | Purpose |
|---|---|
| `src/app/(app)/prospects/(list)/*` | the Prompt 7 list files moved into a route group (URL unchanged) |
| `src/app/(app)/prospects/[id]/{page,not-found,error}.tsx` | page (uuid check → RLS read → notFound; Suspense sections), 404, error boundary |
| `src/app/(app)/prospects/[id]/{prospect-header,prospect-info-card,follow-ups-panel,log-activity-form,timeline,detail-skeletons}.tsx` | page sections |
| `src/components/follow-ups/follow-up-form.tsx` | reusable add-follow-up form |
| `src/components/ai/ai-insights-card.tsx` | Prompt 11 slot (stub) |
| `src/lib/timeline.ts` + test | pure timeline builder |
| `src/lib/constants.ts` (+ test) | `closeReasonLabel()` |
| `src/lib/validation/{prospects,activities}.ts` + tests | `prospectDetailsFormSchema`, `activityFormSchema` |
| `src/server/data/prospect-detail.ts` | `getProspectDetailData`, `listProspectActivitiesData`, `listProspectStageHistoryData`, `listProspectFollowUpsData`, `listUsersData` |
| `tests/integration/prospect-detail.test.ts` | RLS (rep B → null), manager sees all, timeline rows after move/reassign |
| `e2e/prospect-detail.spec.ts` | key flows incl. the rep 404 |
| `CLAUDE.md`, `BUILD_PROGRESS.md` | notes, row 8 |

## 3. Steps
1. This plan. 2. Pure pieces + schemas + unit tests (timeline builder, close reason label, form schemas). 3. Data functions + integration tests. 4. Move the list into `(list)`; build the page, sections, 404/error, skeletons. 5. Browser check (in-app browser) as Riley and Morgan, desktop + 375 px. 6. e2e spec. 7. `npm run verify`, `test:db`, `test:integration`, e2e; clean test data. 8. Docs + commit.

## 4. Verification checklist ("Done when")
- [x] Every info field saves via `updateProspect` (name, company, email, phone, decision maker, objections, objection notes, notes, deal value, currency) and persists after reload; invalid email / deal value show field errors; unchanged save sends nothing.
- [x] Stage select: forward, backward, skip, close won (reason), close lost (reason), won ↔ lost, reopen, demo booked/attended (Save/Skip) each appear in the timeline as "From → To" with the right user (+ close reason); Cancel reverts the select and writes nothing.
- [x] Manager reassign → owner_change entry "Riley Rep → Sam Rep"; reps see no owner select and no overflow menu.
- [x] Log activity (each manual type) with the default "now" and an edited org-tz time; appears newest-first with author, org-tz time + relative time.
- [x] Follow-ups: add / complete (→ follow_up timeline entry, moves to Completed) / reschedule / delete; Overdue/Today badges; "Next follow-up" updates and links to the panel.
- [x] Closed prospect shows the reason/notes labels; demo date/time shows in the org tz with its label.
- [x] Rep opening another rep's prospect URL gets the 404 page (HTTP 404); `/prospects/not-a-uuid` → 404; manager can open any prospect.
- [x] Manager delete (overflow menu → confirm) removes the prospect and lands on `/prospects`.
- [x] Loading skeletons, error boundary, 375 px layout without page-level horizontal scroll.
- [x] `npm run verify` passes; `npm run test:db`, `npm run test:integration`, e2e green; test data cleaned.
