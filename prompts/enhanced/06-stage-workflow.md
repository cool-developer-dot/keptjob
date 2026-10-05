# Prompt 6 (enhanced): Stage-change workflow (automation rules)

Source: `BUILD_PROMPTS.md` → "Prompt 6: Stage-change workflow (automation rules)". `SPEC.md` §2 and §9 are the source of truth; if this plan conflicts with them, SPEC.md wins. Nothing from SPEC §14: **no automatic messages/emails, no automatic stage changes** — the flow only prompts the user after they chose a target stage. No new tables/migrations, no detail page or Kanban (Prompts 8/9 consume this flow).

Goal: ONE reusable client flow — `useStageChange()` + `<StageChangeDialog />` — that, given a prospect and a target stage, decides which dialog to show (if any) via a pure, fully unit-tested `decideStageFlow()`, then calls `moveProspectStage` and the related Prompt 5 actions. Promise-based so the Kanban can do optimistic updates and snap back on Cancel/failure.

---

## 0. What already exists (reuse, do not rebuild)

- Actions (`ActionResult<T>`): `moveProspectStage({ prospectId, toStage, closeReason?, closeNotes?, note? })` → `{ prospect, changed }` (RPC; same stage → `changed: false`; won/lost reason must match target; open targets reject close fields, the DB clears them on reopen); `setDemoDetails({ prospectId, demoDate, demoTime, followUp? })` (org-local → UTC on the server); `logDemoAttended({ prospectId, notes?, followUp? })`; `completeAllPendingFollowUps({ prospectId })` → `{ completed }`. None of the secondary actions change the stage.
- Schemas: `stageChangeSchema`, `setDemoDetailsSchema`, `logDemoAttendedSchema`, `followUpInputSchema` (`dueDate` + required `note` ≤ 2000), `optionalText`, `dateStringSchema`, `timeStringSchema` (`src/lib/validation/*`).
- `src/lib/constants.ts`: `PIPELINE_STAGES`, `STAGE_LABELS`, `isClosedStage`, `WON_REASON_OPTIONS`, `LOST_REASON_OPTIONS`, `TIMEZONE_LABELS`.
- `src/lib/time.ts`: `orgToday`, `addDaysToDateString`, `utcToOrgLocal`, `formatDateString`, `orgLocalToUtc`. Client org settings: `useOrgSettings()` (`timezone`).
- UI: shadcn `dialog`, `form` (react-hook-form), `select`, `checkbox`, `textarea`, `input`, `button`, `sonner` (`<Toaster />` in the root layout).

## 1. Design decisions + pitfalls (read first)

### Pure decision — `src/lib/workflow.ts`
1. `decideStageFlow(from, to, pendingFollowUps)` returns a discriminated union:
   ```ts
   type StageFlow =
     | { kind: "noop" }                       // from === to
     | { kind: "immediate" }                  // any other target (forward, backward, skip, reopen to an open non-dialog stage)
     | { kind: "demo_booked" }                // to === demo_booked (Save / Skip / Cancel)
     | { kind: "demo_attended" }              // to === demo_attended (Save / Skip / Cancel)
     | { kind: "close"; outcome: "won" | "lost"; pendingFollowUps: number; offerCompleteFollowUps: boolean };
   ```
   - Rules are **target-based** (SPEC §9 "Moving to …"), only same stage short-circuits to `noop` (checked first, so `closed_won → closed_won` is a no-op, not a dialog).
   - `closed_won ↔ closed_lost` → `close` with the **new** outcome (a reason from the new list is still required; the DB check enforces it too).
   - Reopen (closed → open stage) is `immediate` (the DB clears close fields). Reopen/backward/skip **into** `demo_booked` / `demo_attended` still shows that stage's dialog (SPEC §9 is target-based; Skip is always available there). Prompt text "any other target, including backward moves and skips: move immediately" applies to the non-dialog targets.
   - `pendingFollowUps` is only meaningful for `close`; non-finite/negative → 0; `offerCompleteFollowUps = pendingFollowUps > 0`.
2. Defaults (pure, injectable `now`, all via `time.ts`, never the browser timezone):
   - `demoBookedDefaults(demoAt, tz)` → existing `demo_at` prefilled as org-local date/time (`utcToOrgLocal`), else empty; follow-up checkbox **on**, due = demo date + 1 day (empty until a demo date exists), note `"Follow up after demo"` (`DEFAULT_DEMO_FOLLOW_UP_NOTE`).
   - In the dialog, changing the demo date updates the follow-up due date to demo + 1 **unless the user edited the due date** (`isDirty`).
   - `demoAttendedDefaults(tz, now)` → notes empty; follow-up on, due = `orgToday(tz, now) + 2`, note `"Follow up after demo"`.
   - `timeZoneAbbreviation(tz, at?)` in `time.ts`: `Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortGeneric" })` → "ET", "CT", "MT", "PT", "AKT", "MST" (Phoenix), "HST"; fallback `short`, then the IANA id. Never hardcoded.

### Form schemas — `src/lib/validation/stage-change.ts` (reuse existing pieces)
3. `demoBookedFormSchema`: `{ demoDate, demoTime, createFollowUp: boolean, followUpDueDate: string, followUpNote: string }` (form state stays strings; empty native date/time inputs say "Choose the demo date/time." instead of the wire format) + `superRefine`: when `createFollowUp`, validate due date + note with the same rules as `followUpInputSchema` and attach issues to `followUpDueDate` / `followUpNote`.
   `demoAttendedFormSchema`: `{ notes: optionalText(10_000), createFollowUp, followUpDueDate, followUpNote }` with the same follow-up refinement.
   `closeFormSchema(outcome)`: `{ closeReason: required ∈ WON_REASONS | LOST_REASONS ("Choose a close reason."), closeNotes: optionalText(2000), completePendingFollowUps: boolean }`.
   Mappers `toSetDemoDetailsInput / toLogDemoAttendedInput / toCloseStageInput` build the action inputs (follow-up omitted when unchecked). The server re-validates with the action schemas.

### Hook — `src/components/stage-change/useStageChange.tsx` (+ `StageChangeDialog.tsx`; `.tsx` because the hook returns the dialog element — the prompt said `.ts`)
4. API:
   ```ts
   const { requestStageChange, dialog, isBusy } = useStageChange();
   requestStageChange(prospect: { id; name; stage; demo_at? }, toStage, { pendingFollowUps? }):
     Promise<"moved" | "unchanged" | "cancelled" | "failed">
   // render {dialog} once in the component tree
   ```
   - `noop` → resolves `"unchanged"` without calling the server.
   - `immediate` → `moveProspectStage` → toast success / toast error; `"moved"` / `"failed"`.
   - Dialog kinds → open `<StageChangeDialog />`, resolve when the user finishes: Save / Skip → `"moved"`; Cancel / Esc / overlay / X → `"cancelled"` (no server call).
   - A new request while a dialog is open resolves the previous one as `"cancelled"` first.
   - `close` without `pendingFollowUps` → fetch N with the new read action `getPendingFollowUpCount({ prospectId })` (data fn `countPendingFollowUpsData`, RLS-scoped, integration-tested). If that read fails, N = 0 (checkbox hidden; the close itself still works).
5. **Save ordering:** move first (`moveProspectStage`, incl. `closeReason`/`closeNotes` for close), then the secondary action (`setDemoDetails` / `logDemoAttended` / `completeAllPendingFollowUps` if checked and N > 0).
   - Move fails → toast error, **dialog stays open** with the input intact (retry or Cancel; Cancel → `"cancelled"`, so a Kanban card snaps back either way).
   - Move succeeds but the secondary action fails → toast error ("Moved to Demo Booked, but the demo details weren't saved: …"), dialog closes, result `"moved"` (never pretend the move rolled back).
   - While saving: all buttons disabled, dialog can't be dismissed.
6. Close dialog: reason `Select` (won or lost list), optional notes, checkbox "Mark N pending follow-up(s) as completed" **only when N > 0** (checked by default — the user can untick it; it's an offer, nothing happens without Save). **Save is disabled until a reason is chosen** and Zod blocks it too. Save / Cancel only — **no Skip**.
7. Demo dialogs: demo date (`type="date"`) + time (`type="time"`) labelled with the org timezone abbreviation, e.g. "Time (ET)", plus a description "Times are in Eastern Time (New York)." Follow-up checkbox (on by default) toggles due date + note fields. Demo attended: notes `Textarea` + the same follow-up block (+2 days). Save / Skip / Cancel.
8. Accessibility: `DialogTitle` ("Move {name} to {Stage}"), `DialogDescription`, every input has a `FormLabel`, errors via `FormMessage` (`aria-describedby`/`aria-invalid` from `form.tsx`), Radix focus trap + initial focus on the first field, focus returns on close.
9. Forms: react-hook-form + `zodResolver(schema)`; values reset from defaults each time the dialog opens (`key` per request).
10. Never: send messages, change any other stage, call AI, or move the stage when the user cancels.

### Out of scope here
Detail page/Kanban/list wiring (Prompts 7–9), the optional stage-change `note` field (not in the prompt), new DB objects.

## 2. Files

| File | Purpose |
|---|---|
| `src/lib/workflow.ts` + `workflow.test.ts` | `decideStageFlow`, `StageFlow`, defaults (`demoBookedDefaults`, `demoAttendedDefaults`, `DEFAULT_DEMO_FOLLOW_UP_NOTE`) |
| `src/lib/time.ts` (+ test) | `timeZoneAbbreviation(tz, at?)` |
| `src/lib/validation/stage-change.ts` + test | dialog form schemas + mappers to action inputs |
| `src/server/data/follow-ups.ts`, `src/server/actions/followUps.ts` | `countPendingFollowUpsData` / `getPendingFollowUpCount` |
| `src/components/stage-change/StageChangeDialog.tsx` | the three dialog forms (presentational + RHF) |
| `src/components/stage-change/useStageChange.tsx` | the promise-based hook (`requestStageChange`, `dialog`) |
| `tests/integration/data-layer.test.ts` | case for `countPendingFollowUpsData` |
| temporary `src/app/(app)/dev/stage-change/` | render check — **deleted afterwards** |
| `CLAUDE.md`, `BUILD_PROGRESS.md` | usage note, row 6 |

## 3. Steps
1. This plan. 2. `workflow.ts` + tests (every case). 3. `timeZoneAbbreviation` + form schemas + tests. 4. Count data fn/action + integration case. 5. Dialog + hook. 6. Temporary /dev page → browser check (each dialog renders; Save/Skip/Cancel on a seeded prospect; DB: `stage_history`, `stage_change`/`demo`/`follow_up` activities, `demo_at`, follow-ups) → delete it. 7. `npm run verify`, `npm run test:db`, `npm run test:integration`, e2e. 8. Docs + commit.

## 4. Verification checklist ("Done when")
- [x] `decideStageFlow` unit tests cover: forward, backward, skipped, reopened-from-closed (immediate), reopen into demo_booked (dialog), same-stage no-op (incl. closed → same closed), won↔lost (close + reason), into each dialog stage (demo_booked, demo_attended, closed_won, closed_lost), N = 0 vs N > 0 (offer flag), every from×to pair returns a valid kind.
- [x] Defaults tests: demo + 1 day, today + 2 in the org tz (late-evening NY vs UTC), existing demo_at prefilled; `timeZoneAbbreviation` for all allowed zones; form schema tests (follow-up required only when checked, reason required + list per outcome).
- [x] Dialogs render (temporary /dev page, checked in the browser): demo_booked (date/time labelled with tz abbreviation, follow-up checkbox on, due = day after), demo_attended (+2 days), closed won/lost (reason required — Save disabled without it; checkbox only when N > 0; no Skip).
- [x] Save / Skip / Cancel exercised against a seeded prospect; DB shows the stage_history rows + activities; Cancel writes nothing.
- [x] /dev page deleted; no automatic messages or stage changes anywhere.
- [x] `npm run verify` passes; `npm run test:db`, `npm run test:integration`, e2e green.
