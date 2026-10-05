# Prompt 5 (enhanced): Validation + server actions (data layer)

Source: `BUILD_PROMPTS.md` → "Prompt 5: Validation + server actions (data layer)". `SPEC.md` §2–§9 is the source of truth; if this plan conflicts with it, SPEC.md wins. Nothing from SPEC §14 may be added: no emails/messages, no automatic stage changes, no multi-currency conversion. **No UI in this prompt** (forms/dialogs come in Prompts 6–11), no new tables/migrations unless a requirement can't be met otherwise.

Goal: every prospect/activity/follow-up/demo mutation the later UI prompts need exists as a typed server action that validates with Zod, runs as the signed-in user (RLS is the boundary, no service role), returns `ActionResult<T>`, and revalidates the affected pages. Schemas are unit-tested; the actions are proven against the local database with RLS as rep and manager.

---

## 0. What already exists (do not rebuild)

- `ActionResult<T>` (`src/server/actions/types.ts`). Settings actions (`updateOrgSettings`, `inviteUser`, `changeUserRole`) and schemas `orgSettingsSchema`, `inviteUserSchema`, `changeRoleSchema` (`src/lib/validation/settings.ts`, tested) — they satisfy the prompt's "orgSettings, invite" schemas; only re-export/reference them, don't duplicate.
- `src/lib/constants.ts`: `PIPELINE_STAGES`, `CLOSED_STAGES`, `isClosedStage`, `WON_REASONS`, `LOST_REASONS`, `OBJECTION_CATEGORIES`, `DECISION_MAKER_STATUSES`, `MANUAL_ACTIVITY_TYPES` (call/conversation/note/demo), `DEAL_HEALTH_VALUES`.
- `src/lib/time.ts`: `isDateString`, `isTimeString`, `orgLocalToUtc(date, "HH:mm", tz)`. `src/lib/org.ts`: `getOrgSettings()` → `{ defaultCurrency, timezone, staleDays }`. `src/lib/auth.ts`: `getCurrentUser()`, `requireManager()` (redirects reps). `src/lib/money.ts`: `isSupportedCurrency`.
- DB (Prompts 1–2):
  - `move_prospect_stage(p_prospect_id, p_to_stage, p_close_reason?, p_close_notes?, p_note?)` (security invoker): locks the row, same stage → returns the row unchanged (no history), otherwise sets stage + close fields (nulls them for non-closed targets) and passes `p_note` to `stage_history.note` + the `stage_change` activity. Not visible → `P0002 Prospect not found`.
  - Triggers: reopening clears `close_reason/close_notes/closed_at`; `closed_at` set on close; stage_history + `stage_change`/`owner_change` activities; reassignment moves pending follow-ups to the new owner; non-manager owner change → `42501 Only managers can reassign prospects`; `prospects_before_insert` defaults `currency` from `org_settings.default_currency` and `owner_id` to `auth.uid()`; `follow_ups_before_insert` defaults `owner_id` to the prospect's owner; `last_activity_at` updated by human activity inserts (`least(occurred_at, now())`); `follow_up_date` derived.
  - CHECK `prospects_close_reason_check`: closed_won → won list, closed_lost → lost list, other stages → null. `follow_ups_completed_check`: completed ⇔ completed_at not null.
  - Column grants (writing anything else → 42501): prospects insert/update `name, company, email, phone, stage, decision_maker_status, objections, objection_notes, notes, demo_at, close_reason, close_notes, deal_value, currency, owner_id` (+ `id` on insert); activities insert `id, prospect_id, user_id, type, content, metadata, occurred_at`; follow_ups insert `id, prospect_id, owner_id, due_date, note, status, completed_at, completed_by`, update `due_date, note, status, completed_at, completed_by`.
  - RLS: reps only their own prospects/children; managers all; prospect delete = managers; activity insert needs `user_id = auth.uid()` and type ∉ {stage_change, owner_change}. USING mismatches are silent → check affected rows.

## 1. Pitfalls and design decisions (read first)

### Structure
1. **Two layers.** `src/server/data/*.ts` (`server-only`): pure data functions `fn(ctx, input)` where `ctx = { supabase: SupabaseClient<Database>, user: { id, role } }`; they Zod-parse, talk to Supabase, map errors, return `ActionResult<T>`, never call `revalidatePath`/`cookies`/`redirect` → callable from integration tests with a signed-in supabase-js client. `src/server/actions/{prospects,activities,followUps,demo}.ts` (`"use server"`, **only async function exports**; type-only exports are erased and fine; no schema exports): `getCurrentUser()` (null → "Your session has expired…"), or `requireManager()` for manager-only actions, user-scoped `createClient()`, call the data fn, `revalidatePath(...)` on success.
2. **Errors:** `src/server/data/errors.ts` `dbErrorMessage(error, fallback)` maps PostgREST/Postgres codes to friendly text: `42501` → permission (keep the trigger's own message for `Only managers can reassign prospects`), `P0002`/`PGRST116` → "not found or you don't have access", `23503` → related record not found, `23514` → invalid values, `22P02`/`22007`/`22008` → invalid value, `23505` → already exists; else the fallback. Unexpected errors are `console.error`ed server-side. Validation failures return the first Zod issue message (`firstIssue(error)`), never a stack.
3. **Revalidation** (`revalidateProspect(id?)` helper in the actions layer): `/prospects`, `/prospects/[id]` (the concrete id), `/pipeline`, `/follow-ups`, `/dashboard`, `/reports`. Every mutation revalidates all of them except that pure follow-up/activity changes may skip `/reports` only if it is obviously unaffected — simplest: always revalidate the full set (cheap, correct).

### Schemas (`src/lib/validation/`, Zod v4, enums only from constants; camelCase inputs mapped to snake_case columns in the data layer)
4. Shared helpers (`common.ts`): `uuidSchema`, `optionalText(max)` — trims; `""`/null → `null` (clear); **`undefined` stays `undefined`** (field not sent → not updated); `dateStringSchema` (`isDateString`), `timeStringSchema` (`isTimeString`), `CLOCK_SKEW_MS = 5 min`.
5. `prospects.ts`:
   - `prospectCreateSchema`: `name` (trim, 1–200, required), `company` (≤200), `email` (optional valid email, trimmed, lowercased; `""` → null), `phone` (optional, ≤40, digits/space/`+()-.` and optional `x`/`ext` extension), `decisionMakerStatus` (enum, default `unknown`), `objections` (array of `OBJECTION_CATEGORIES`, default `[]`, de-duplicated), `objectionNotes`/`notes` (≤10 000), `dealValue` (optional number or numeric string, ≥ 0, ≤ 9 999 999 999.99 = numeric(12,2), rounded to cents; `""`/null → null), `currency` (optional 3-letter supported ISO code, uppercased; **omitted → DB default from org_settings**), `ownerId` (optional uuid).
   - `prospectUpdateSchema`: **`z.strictObject`** `{ prospectId, …same editable fields, all optional }` — unknown keys are **rejected**, which covers `stage`, `ownerId`, `closeReason`, `closeNotes`, `closedAt`, `lastActivityAt`, `followUpDate`, `demoAt`, `createdBy`… (stage/owner/close/demo have dedicated actions; derived columns are not granted). Requires at least one field. The data layer additionally builds the payload from an explicit allow-list (defense in depth).
   - `stageChangeSchema`: `{ prospectId, toStage ∈ PIPELINE_STAGES, closeReason?, closeNotes? (≤2000), note? (≤2000) }`; `superRefine`: `closed_won` → closeReason required ∈ `WON_REASONS`; `closed_lost` → required ∈ `LOST_REASONS` (a won reason like `product_fit` for closed_lost fails, and vice versa; `other` is valid for both); non-closed target → closeReason/closeNotes must be empty (reopen: the DB clears close fields, the action never sends them).
   - `reassignProspectSchema`: `{ prospectId, ownerId }`. `prospectIdSchema` `{ prospectId }` (delete, completeAll).
6. `activities.ts` — `activityCreateSchema`: `{ prospectId, type ∈ MANUAL_ACTIVITY_TYPES (call/conversation/note/demo only), content (trim, 1–10 000, required), occurredAt? }`; `occurredAt` = ISO datetime with offset (or `Date`), normalized to ISO UTC; **refined in the schema: not later than `Date.now() + CLOCK_SKEW_MS`** (5 min tolerance for client clock skew). `follow_up`/`ai_insight`/`stage_change`/`owner_change` are rejected (system-written).
7. `follow-ups.ts`: `followUpCreateSchema { prospectId, dueDate: "YYYY-MM-DD" (org-local calendar date, no tz conversion), note (trim, 1–2000) }`; `followUpRescheduleSchema { followUpId, dueDate }`; `followUpCompleteSchema { followUpId, note? (≤2000, completion note) }`; `followUpIdSchema { followUpId }`. Nested `followUpInputSchema { dueDate, note }` reused by demo schemas.
8. `demo.ts`: `setDemoDetailsSchema { prospectId, demoDate (DateString), demoTime ("HH:mm"), followUp?: { dueDate, note } }`; `logDemoAttendedSchema { prospectId, notes? (≤10 000), followUp? }`.
9. `ai.ts`: `aiInsightOutputSchema` = SPEC §10 output: `summary` (string ≤ 600), `decision_maker_status` (yes/no/unknown), `main_objection`, `recommended_next_step` (strings), `deal_health` (high/medium/low). Plain object, no transforms/defaults (Prompt 11 feeds it to `zodTextFormat`). `index.ts` barrel is not needed; import from the module.

### Actions (behaviour)
10. `createProspect(input)` → `{ id }`-bearing prospect row. Owner: omitted → current user. A rep may only pass their own id (else "Only managers can assign prospects to other users."); a manager may pass any existing user (FK 23503 → "Owner not found."). Currency omitted → not sent (DB trigger fills the org default; never hardcode USD). Insert `.select().single()`.
11. `updateProspect(input)` → updated row. Payload = allow-listed columns only; `.update().eq("id").select()`; 0 rows → "Prospect not found or you don't have access."
12. `deleteProspect({ prospectId })`: `requireManager()` first (rep → redirect), data layer re-checks role; `.delete().eq("id").select("id")`; 0 rows → not found. Children cascade.
13. `moveProspectStage({ prospectId, toStage, closeReason?, closeNotes?, note? })` → `{ prospect, changed }`. Reads the current stage through RLS (not visible → not found); same stage → `{ changed: false }` without calling the RPC (no-op, no history); otherwise **`rpc("move_prospect_stage", …)`** so `note` reaches `stage_history.note` and the `stage_change` activity. Close fields only for closed targets. Never insert stage_history/stage_change activities from the app.
14. `reassignProspect({ prospectId, ownerId })`: `requireManager()` + data-layer role check + DB trigger. Target must exist in `public.users` ("User not found."). Same owner → ok, no write. The trigger logs `owner_change` and moves pending follow-ups.
15. `completeAllPendingFollowUps({ prospectId })` (close flow) → `{ completed: number }`: completes every pending follow-up of the prospect (`status=completed, completed_at=now, completed_by=user`) and logs one `follow_up` activity per completed follow-up (SPEC §8: completing logs an activity). Zero pending → `{ completed: 0 }`.
16. `addActivity(input)` → activity row; `user_id` is the DB default (`auth.uid()`), not sent.
17. `createFollowUp({ prospectId, dueDate, note })`: looks up the prospect **through RLS** (not visible → not found) and sets `owner_id = prospect.owner_id` explicitly. `rescheduleFollowUp({ followUpId, dueDate })`: pending only (completed → "already completed"). `completeFollowUp({ followUpId, note? })`: update `.eq("status","pending")` with `completed_at = now`, `completed_by = current user`; 0 rows → not found / already completed; then insert a `follow_up` activity: content = completion note if given, else the follow-up's note; metadata `{ follow_up_id, due_date, task }`. `deleteFollowUp({ followUpId })`: delete + check rows.
18. `setDemoDetails({ prospectId, demoDate, demoTime, followUp? })`: `demo_at = orgLocalToUtc(demoDate, demoTime, (await getOrgSettings()).timezone).toISOString()` (data fn takes `timezone` as a parameter); update prospect (0 rows → not found); optional follow-up via the createFollowUp logic. Does **not** change the stage (the caller moves the stage first).
19. `logDemoAttended({ prospectId, notes?, followUp? })`: inserts a `demo` activity (content = notes, or "Demo attended" when empty); optional follow-up. Does not change the stage.
20. Not atomic across statements (follow-up update + activity insert): primary write first, activity second; an activity failure is logged and reported. Acceptable for V1; no new RPCs.

### Tests
21. Vitest unit tests per schema file (valid + invalid): close-reason matrix (won/lost/other/missing/wrong list/reason on open stage), future `occurredAt` (now+1h rejected, now+1min accepted, past accepted, garbage rejected), strict update rejecting `stage`/`ownerId`/`closeReason`/`lastActivityAt`/`followUpDate`, empty update, dealValue (negative, string, too large, rounding), email/phone, date/time formats, manual activity types only, ai output enums + summary length. Plus `dbErrorMessage` mapping tests.
22. Integration tests (`tests/integration/*.test.ts`, `vitest.integration.config.mts`, node env, script **`npm run test:integration`**, **not** in `verify`; needs local Supabase + seed): sign in as rep Riley (A), rep Sam (B) and manager Morgan (M) with supabase-js and call the data functions: create (currency default from org settings, owner default, rep can't set another owner, manager can), update (strict reject), stage moves (forward, skip, backward, same-stage no-op, close with reason + note → stage_history note, wrong-list reason rejected, reopen clears close fields), B can't see/modify A's prospect, reassign (rep denied, manager ok → owner_change + follow-ups moved), activities (future rejected, last_activity_at bumps), follow-ups (owner = prospect owner when a manager creates one, complete → completed_by + follow_up activity, reschedule, delete, completeAll), demo (org-local → UTC, follow-up), delete (rep denied, manager ok). Tests clean up their rows.

## 2. Files

| File | Purpose |
|---|---|
| `src/lib/validation/{common,prospects,activities,follow-ups,demo,ai}.ts` (+ `*.test.ts`) | schemas + input/output types |
| `src/server/data/{context,errors,prospects,activities,follow-ups,demo}.ts` (+ `errors.test.ts`) | data functions (server-only, testable) |
| `src/server/actions/{prospects,activities,followUps,demo}.ts` | `"use server"` wrappers + `helpers.ts` (ctx builders + `revalidateProspect`, non-"use server" module) |
| `tests/integration/data-layer.test.ts`, `vitest.integration.config.mts`, `package.json` script | RLS integration tests |
| `CLAUDE.md`, `BUILD_PROGRESS.md` | action API notes, row 5 |

## 3. Steps

1. This plan. 2. Schemas + unit tests. 3. Errors + data layer. 4. Actions. 5. Integration tests vs local DB (fix until green). 6. `npm run test:db`, `npm run verify`, `PLAYWRIGHT_CHANNEL=chrome npm run e2e`. 7. CLAUDE.md, BUILD_PROGRESS, commit.

## 4. Verification checklist ("Done when")

- [x] Every schema has valid + invalid unit tests; close-reason rules and future `occurredAt` covered; `npm run test` green.
- [x] Action files start with `"use server"` and export only async functions; no service-role client in any of them.
- [x] `moveProspectStage` uses the `move_prospect_stage` RPC (note in `stage_history.note`), same stage = no-op `{ changed: false }`, reopen sends no close fields.
- [x] `updateProspect` rejects stage/owner/close/derived fields; `createProspect` leaves currency to the DB default, owner defaults to the current user, reps can't set another owner.
- [x] `completeFollowUp` sets `completed_by` and logs a `follow_up` activity; `createFollowUp` owner = prospect owner; `setDemoDetails` converts org-local → UTC with the org timezone.
- [x] `reassignProspect`/`deleteProspect` manager-only (requireManager + DB).
- [x] `npm run test:integration` green against local Supabase (rep A / rep B / manager M).
- [x] `npm run test:db` green; `npm run verify` passes; e2e still green.
