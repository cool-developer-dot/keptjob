# Prompt 9 (enhanced): Kanban pipeline

Source: `BUILD_PROMPTS.md` → "Prompt 9: Kanban pipeline". `SPEC.md` §2 (9 stages in order; forward/backward/skip; every change in `stage_history`; close reason required; reopen clears close fields), §4 (reps see only their own prospects; managers everything), §9 (stage-change prompts; never automatic stage changes), §11 (Pipeline (Kanban) page) are the source of truth; SPEC wins any conflict. Nothing from §14 (no automation, no messages, **no currency conversion** — totals are per currency).

Goal: `/pipeline` is a drag-and-drop board of the user's (rep) or team's (manager) prospects, one column per stage. Every move goes through the Prompt 6 `useStageChange()` flow, is applied optimistically, and moves by other users show up live through Supabase Realtime (RLS-scoped).

---

## 0. What already exists (reuse, do not rebuild)

- `useStageChange()` (`src/components/stage-change/useStageChange.tsx`): `requestStageChange({ id, name, stage, demo_at }, toStage)` → `"moved" | "unchanged" | "cancelled" | "failed"`; renders the demo/close dialogs (`{dialog}` once); toasts itself (success + error). Close targets fetch the pending follow-up count themselves.
- `moveProspectStage` (via the hook only) → RPC `move_prospect_stage` → triggers write `stage_history` (`changed_by = auth.uid()`) + `stage_change` activity (`user_id`); the action calls `revalidateProspect()` (incl. `/pipeline`).
- `prospects_with_flags` view (security_invoker → RLS): `is_stale`, `has_overdue_follow_up`. `searchOrFilter(term)` (injection-safe ILIKE over name/company/email), `SEARCH_MAX_LENGTH`.
- Badges `src/components/prospects/prospect-badges.tsx`: `FollowUpBadge` (org-tz Overdue/Today), `StaleBadge`, `StageBadge`. `formatMoney(value, currency, { compact })`. Labels: `STAGE_LABELS`, `PIPELINE_STAGES` (SPEC order), `DECISION_MAKER_STATUS_LABELS`, `DEAL_HEALTH_LABELS`.
- `ai_insights` table (empty until Prompt 11; index `(prospect_id, created_at desc)`; RLS via `can_access_prospect`).
- `prospects` is already in the `supabase_realtime` publication (Prompt 2 migration).
- `@dnd-kit/core` 6.3 is installed. Browser Supabase client `src/lib/supabase/client.ts` (session cookies; supabase-js wires the session JWT into Realtime via its `accessToken` callback).

## 1. Design decisions + pitfalls (read first)

### Data (server)
1. `/pipeline/page.tsx` (server): `requireUser()`; parse URL params `q` (search) and `owner` (managers only; reps' `owner` ignored) with Zod, invalid → default (`parsePipelineParams`, pure, in `src/lib/validation/pipeline.ts`). **Filtering is server-side**: same `searchOrFilter` semantics as the list page, the RLS boundary stays in Postgres, and a Realtime `router.refresh()` re-runs the same filtered query — no second filtering implementation on the client and no shipping of rows the user filtered out.
2. `listPipelineData(ctx, params)` (`src/server/data/pipeline.ts`, ctx pattern): from `prospects_with_flags` (user-scoped client) columns `id, name, company, stage, owner_id, decision_maker_status, follow_up_date, deal_value, currency, demo_at, is_stale, has_overdue_follow_up, last_activity_at`, ordered by `last_activity_at desc, id`, capped at `PIPELINE_LIMIT` = 500 → `{ cards, truncated }` (fetch limit + 1, which must stay ≤ PostgREST `max_rows` 1000). Truncated → a visible "Showing the 500 most recently active prospects" note.
3. **Latest AI deal health per prospect:** new view `public.latest_ai_insights` (`security_invoker = true`, `select distinct on (prospect_id) prospect_id, id, deal_health, created_at from ai_insights order by prospect_id, created_at desc, id desc`) — one query, uses the existing `(prospect_id, created_at desc)` index, RLS of `ai_insights` applies. Grant select to `authenticated` only (revoke from `anon`/`public`). Embedded in the same query (`select("…, latest_ai_insights(deal_health)")`, FK `prospect_id → prospects.id`; the filter is pushed into the distinct-on view → index lookup; no `.in(ids)` URL) → `ai_health: DealHealth | null`. Reusable by Prompts 11/12.
4. Owners (managers only): `users` (`id, full_name`) for the owner filter + card initials.

### Board (client, `pipeline-board.tsx`)
5. 9 columns in `PIPELINE_STAGES` order, header = `STAGE_LABELS[stage]` + count + **total deal value of rows with a value**, grouped by currency (`formatMoney(sum, currency, { compact: true })`, joined with " · " when mixed, sorted by currency code; no total when no row has a value). Pure helper `summarizeColumn(rows)` in `src/lib/pipeline.ts` (unit-tested: empty, null values ignored, mixed currencies never summed together, float rounding to cents).
6. Columns fixed width (`w-72 shrink-0`); the board is `overflow-x-auto` (horizontal scroll on narrow screens; no page-level horizontal scroll — the scroll is inside the board). Empty column → dashed "No prospects" placeholder that is still a drop target (`min-h`).
7. Card: name (truncate), company (muted), owner initials avatar (**managers only**, `title` = full name; helper `initials(name)`), next follow-up `FollowUpBadge` (date; red Overdue / amber Today via `followUpBucket` in the org tz, using the server-provided `now`), decision-maker badge (`DM: Yes/No/Unknown`, unknown muted), `StaleBadge` when `is_stale`, AI health badge (`AI: High/Medium/Low`, green/amber/red) when `ai_health` is set, deal value (`formatMoney`) when set.
8. **Open on click:** clicking a card navigates to `/prospects/[id]` (`router.push`; ⌘/Ctrl-click → new tab); Enter on a focused card also opens it. Clicks right after a drag are suppressed.

### Drag and drop (@dnd-kit/core)
9. `DndContext` with `PointerSensor` (`activationConstraint: { distance: 6 }` — a plain click never starts a drag) and `KeyboardSensor` (start key **Space** only so Enter keeps "open"; Space/Enter drop; Escape cancels) with a custom `coordinateGetter` that jumps **one column per ArrowLeft/ArrowRight** (by droppable rect order) instead of 25 px steps. `useDraggable` per card (`id` = prospect id, `data` = row), `useDroppable` per column (`id` = stage). Collision: `pointerWithin`, falling back to `rectIntersection` (keyboard has no pointer). Drop onto **any** column (no sortable within columns). `DragOverlay` renders a copy of the card; the source card is dimmed. `autoScroll` default (board scrolls horizontally while dragging).
10. **Screen reader announcements** (`accessibility.announcements` + `screenReaderInstructions`) in plain words with the prospect name and stage labels: "Picked up X in Contacted.", "X is over Qualified.", "X dropped in Qualified.", "Moving X was cancelled." Cards: `aria-roledescription="draggable card"` (from attributes) + `aria-label` "Name, Company, Stage".
11. **On drop:** `over` missing or same column → ignore (no call). Otherwise set an optimistic override `{ from, to, settled: false }` for that card, then `await requestStageChange({ id, name, stage: from, demo_at }, to)`:
    - `"cancelled"` / `"failed"` → remove the override (card snaps back; `"failed"` toast comes from the hook).
    - `"moved"` / `"unchanged"` → mark the override `settled`; it is dropped once a server snapshot shows a stage other than `from` (normally `to`). Then `router.refresh()` as a safety net (the action already revalidated `/pipeline`).
    - A card with an unsettled override can't be dragged again (`disabled`) until it settles.
12. **Realtime never overwrites an in-flight move:** the board renders `server rows` + `overrides`; an unsettled override always wins over incoming snapshots, a settled one only until the server agrees. Overrides for prospects that disappeared are discarded. All state adjustments happen at render time or in event handlers (no setState in effects).

### Realtime (`src/components/realtime/use-realtime-refresh.ts`)
13. `useProspectsRealtime({ userId, onChange })` hook: browser client `createClient()`, `await supabase.realtime.setAuth()` (session JWT → Realtime RLS; supabase-js keeps it fresh on token refresh), then a channel `postgres_changes` `{ event: "*", schema: "public", table: "prospects" }`. Every event (INSERT / UPDATE / DELETE) → **debounced (400 ms)** `onChange` → `router.refresh()` (in a transition) — the server re-runs the filtered RLS query, so inserts, updates, deletes, filters and flags all stay correct without client-side merging. A re-subscribe after a dropped connection (`SUBSCRIBED` after the first time) also refreshes (missed events). Cleanup on unmount: clear the timer, `removeChannel` for every channel (React Strict Mode double-mount safe via a `cancelled` flag).
14. **RLS facts (verify locally):** Realtime checks the subscriber's RLS for INSERT/UPDATE, so rep B never receives rep A's rows. DELETE events can't be RLS-checked; with the default replica identity they carry only the primary key (`old.id`) — acceptable (no data), and they just trigger a refresh.
15. **Owner reassignment away from a rep:** the UPDATE's new row fails the old owner's RLS, so `postgres_changes` delivers **nothing** to them. Fix: migration trigger `prospects_broadcast_owner_change` (after update of `owner_id`, `security definer`, `set search_path = ''`) calls `realtime.send(jsonb_build_object('prospect_id', id), 'prospect_owner_changed', 'user:' || old.owner_id, true)` (private broadcast; payload is only the id). RLS policy on `realtime.messages`: `authenticated` may receive broadcasts only on topic `'user:' || auth.uid()` (`realtime.topic()`). The hook also subscribes to the private channel `user:<userId>` (`config: { private: true }`) → same debounced refresh. `realtime.send` swallows its own errors (warning), so the reassignment never fails because of Realtime.

### Filters (`pipeline-filters.tsx`)
16. Search input (debounced 300 ms, `router.replace`, Escape/× clears) + Owner select (managers only; "All owners") → URL params `q` / `owner` (`pipelineHref(params, overrides)`, non-default values only). Radix `SelectValue` gets the selected label as children (SSR). A "Clear filters" button when any filter is set.

### Out of scope
Sorting cards within a column, editing cards inline, bulk moves, automatic stage changes, WIP limits, per-column pagination, currency conversion.

## 2. Files

| File | Purpose |
|---|---|
| `supabase/migrations/20261007120000_pipeline.sql` | `latest_ai_insights` view + grants; owner-change broadcast trigger; `realtime.messages` policy |
| `supabase/tests/pipeline.test.sql` | pgTAP: view RLS (rep A/B/manager, latest only), trigger exists, broadcast row for the old owner, realtime.messages policy |
| `src/lib/supabase/database.types.ts` | regenerated (`npm run db:types`) |
| `src/lib/validation/pipeline.ts` + test | `parsePipelineParams`, `pipelineHref`, `PIPELINE_PATH` |
| `src/lib/pipeline.ts` + test | `summarizeColumn`, `groupByStage`, `initials`, `applyOverrides` (pure) |
| `src/server/data/pipeline.ts` | `listPipelineData`, `PipelineRow` |
| `src/app/(app)/pipeline/{page,loading,error}.tsx` | page (server), skeleton, error boundary |
| `src/app/(app)/pipeline/{pipeline-board,pipeline-card,pipeline-filters}.tsx` | board (dnd + overrides + realtime), card, filters |
| `src/components/realtime/use-prospects-realtime.ts` | reusable Realtime → debounced refresh hook |
| `tests/integration/pipeline.test.ts` | data function (RLS, filters, latest insight), **Realtime RLS** (B doesn't receive A's changes; manager does; old owner gets the broadcast) |
| `e2e/pipeline.spec.ts` | keyboard drag forward/backward/skip, close (Cancel snaps back, Save), reopen, persistence after reload, live update across two browser contexts |
| `CLAUDE.md`, `BUILD_PROGRESS.md` | notes, row 9 |

## 3. Steps
1. This plan. 2. Migration + pgTAP + `db:reset` + `db:types` + `test:db`. 3. Pure helpers + unit tests. 4. Data function + integration tests (incl. Realtime RLS). 5. Page, board, card, filters, realtime hook. 6. Browser check as Riley + Morgan (1440 px and 375 px). 7. e2e spec. 8. `npm run verify`, `test:db`, `test:integration`, e2e; clean test data. 9. Docs + commit.

## 4. Verification checklist ("Done when")
- [x] 9 columns in SPEC order with labels; counts and per-currency totals correct (null deal values ignored, mixed currencies listed separately).
- [x] Cards show name, company, owner initials (managers only), follow-up Overdue/Today, DM badge, Stale badge, AI health badge (when an insight exists — checked with a temporary `ai_insights` row).
- [x] Drag (mouse and keyboard) forward, backward, skip, close won/lost (reason dialog; Cancel snaps back and writes nothing), reopen, demo booked/attended (Save/Skip/Cancel); same-column drop does nothing.
- [x] Every move persists after reload and creates exactly one `stage_history` row + one `stage_change` activity with the acting user (DB checked); timeline shows it on the detail page.
- [x] Failure → card snaps back + error toast.
- [x] Click on a card opens `/prospects/[id]`; Enter on a focused card too; drags don't navigate.
- [x] Filters: search + owner (managers) in the URL; reps have no owner filter and `?owner=` is ignored.
- [x] Realtime: a move in one browser context appears in another without reload; rep B doesn't receive rep A's changes (integration test); a prospect reassigned away from a rep disappears from that rep's board live.
- [x] 375 px: board scrolls horizontally inside its container, no page-level horizontal scroll.
- [x] `npm run verify` passes; `test:db`, `test:integration`, e2e green; test data cleaned.
