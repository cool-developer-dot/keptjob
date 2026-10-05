# Prompt 7 (enhanced): Prospects list page

Source: `BUILD_PROMPTS.md` → "Prompt 7: Prospects list page". `SPEC.md` §3 (fields, objection categories), §4 (reps see only their own prospects), §6 (org timezone), §9.4/§9.6 (due today / overdue, stale) and §11 (Prospects list page) are the source of truth; SPEC wins any conflict. Nothing from SPEC §14 (no bulk email, no exports, no automation). No schema changes.

Goal: a server-rendered `/prospects` page whose whole state (search, filters, sort, page) lives in the URL, a "New prospect" dialog that calls `createProspect`, and reusable badges / objection multi-select for Prompts 8–10.

---

## 0. What already exists (reuse, do not rebuild)

- View `public.prospects_with_flags` (**security_invoker** → RLS applies): `p.*` + `is_stale` (open stage and `last_activity_at < now() - stale_days`) + `has_overdue_follow_up` (`follow_up_date < org_today()`). Granted `select` to `authenticated`.
- `prospects.follow_up_date` is derived (earliest pending follow-up); `last_activity_at` is maintained by triggers (never null).
- Action `createProspect(input)` (owner defaults to the current user; reps may only pass their own id; currency omitted → org default via DB trigger), schema `prospectCreateSchema` (`src/lib/validation/prospects.ts`).
- `getActionContext()` (`src/server/actions/helpers.ts`) → `{ supabase (user-scoped), user }`; `requireUser()`; `getOrgSettings()` / `useOrgSettings()` (`timezone`, `defaultCurrency`, `staleDays`).
- `src/lib/time.ts`: `followUpBucket`, `formatDateString`, `formatOrgDateTime`, `orgToday`; `src/lib/money.ts`: `formatMoney`.
- `src/lib/constants.ts`: `PIPELINE_STAGES`/`STAGE_LABELS`/`STAGE_OPTIONS`, `DECISION_MAKER_STATUS_OPTIONS`, `OBJECTION_OPTIONS`/`OBJECTION_LABELS`, `isClosedStage`.
- shadcn: table, badge, button, dialog, form, input, textarea, select, popover, command, checkbox, skeleton, sonner.
- `public.users` is readable by every authenticated user (owner names / owner select).

## 1. Design decisions + pitfalls (read first)

### URL state — `src/lib/validation/prospect-list.ts` (client-safe, pure)
1. `parseProspectListParams(searchParams)` — every key parsed **independently** with Zod `.catch()` so one bad value falls back to its default and never crashes or invalidates the rest. `string[]` values → first item.
   | Param | Values | Default |
   |---|---|---|
   | `q` | trimmed, collapsed whitespace, ≤ 100 chars (longer → truncated) | `""` |
   | `stage` | one of `PIPELINE_STAGES` | none |
   | `owner` | uuid (**ignored for reps** — the page drops it) | none |
   | `dm` | `yes`/`no`/`unknown` | none |
   | `objection` | one of `OBJECTION_CATEGORIES` | none |
   | `overdue` | `"1"` → true | false |
   | `stale` | `"1"` → true | false |
   | `sort` | whitelist `name, company, stage, follow_up, last_activity, deal_value` | `last_activity` |
   | `dir` | `asc`/`desc` | per column (`name/company/stage/follow_up` asc; others desc) |
   | `page` | integer ≥ 1 (≤ 10 000) | 1 |
2. `prospectListHref(params, overrides)` builds `/prospects?…` with only non-default values (clean URLs; changing any filter/search/sort resets `page`). `hasActiveFilters(params)`.
3. Sort keys map to columns in the data layer only (`follow_up` → `follow_up_date` asc **nulls last**, `last_activity` → `last_activity_at`, `deal_value` nulls last); tiebreaker `id` so pagination is stable. Stage sorts by enum order = pipeline order. No owner-name sort (would need a join; not required).

### Data — `src/server/data/prospect-list.ts`
4. `listProspectsData(ctx, params)` → `ActionResult<{ rows, total, page, pageSize: 25, pageCount }>`; queries **`prospects_with_flags` with the user-scoped client** (RLS: reps get only their rows; never the service role) using `{ count: "exact" }` and `.range()`.
   - Reps: `owner` param ignored (RLS would filter anyway, but the param must not even reach the query).
   - Search: `.or()` over `name`, `company`, `email` with `ilike`. **Injection safety:** escape LIKE metacharacters (`\` `%` `_` → backslash-escaped), map `*` → `_` (PostgREST turns `*` into `%`), wrap the pattern in PostgREST double quotes (escape `\` and `"`), so `,` `(` `)` `.` in the term can't add filter clauses. Verified against local PostgREST: `50%`, `a_b`, `acme, inc`, `(co)`, `x),name.eq.foo` behave literally.
   - Filters: `stage` eq, `owner_id` eq (managers), `decision_maker_status` eq, `objections` **contains** `[category]`, `has_overdue_follow_up = true`, `is_stale = true`.
   - Page beyond the last page → re-query the last page (PostgREST returns 416/`PGRST103` for an out-of-range offset). `total = 0` → `page 1`, `pageCount 1`.
   - DB error → `dbFailure(…)`; the page throws → `error.tsx`.

### Page — `src/app/(app)/prospects/`
5. `page.tsx` (server): `requireUser()`, `getOrgSettings()`, parse params, list query; managers also load `users` (owner names, owner filter, owner select). Renders `PageHeader` (with an `actions` slot → "New prospect"), `ProspectFilters`, the table, pagination.
6. Columns: **Name** (link to `/prospects/[id]`, + email under it), Company, Stage (`StageBadge`), Decision maker, Objections (`ObjectionChips`, max 2 + "+N"), Next follow-up (`FollowUpBadge`: red "Overdue" / amber "Today" via `followUpBucket(date, org tz)` + the date via `formatDateString`; "—" if none), **Owner (managers only — column not rendered for reps)**, Last activity (`formatRelativeTime`, absolute org-tz time in `title`), Deal value (`formatMoney(value, row.currency)`, right-aligned), Stale badge (under the last-activity time; only `is_stale`).
7. Sortable headers: server-rendered `<Link>`s, clicking the active column toggles `dir`, `aria-sort` on `<th>`, sort icon.
8. Row click → `/prospects/[id]` via a small client `ProspectRowLink` (`<tr onClick>` ignoring clicks on links/buttons and text selection, `cursor-pointer`); **keyboard access via the real `<Link>` in the name cell** (no fake row focus).
9. Pagination: "Showing 26–50 of 60", Previous/Next links (disabled at the edges, `aria-disabled`), "Page 2 of 3".
10. Empty states: no prospects at all (no filters) → "No prospects yet" + New prospect button; filters active → "No prospects match your filters" + "Clear filters".
11. `loading.tsx` (skeleton header/filters/rows), `error.tsx` (client; Next 16.3 `retry()` prop; friendly message + Try again).
12. Mobile: filters wrap; the table scrolls horizontally inside its container (`Table` already wraps in `overflow-x-auto`); the page itself never scrolls horizontally.

### Filters — `prospect-filters.tsx` (client)
13. Search input: local state, **debounced 300 ms** → `router.replace(href)` (no history spam); syncs from the URL when it changes externally (back/clear) using the "adjust state during render" pattern (no setState-in-effect). Esc/clear button empties it.
14. Selects (stage, owner [managers only], decision maker, objection) with an "All …" sentinel (Radix Select disallows `""`); toggles "Overdue follow-up" and "Stale" as `aria-pressed` buttons; "Clear filters" when any is active. All navigations in `startTransition` → subtle pending indicator. Every change resets `page`.

### New prospect dialog — `src/components/prospects/new-prospect-dialog.tsx` (client)
15. react-hook-form + `zodResolver(prospectCreateSchema)` (the **shared** schema; the server re-validates). Fields: name*, company, email, phone, decision-maker status (default Unknown), objections (`ObjectionMultiSelect`), objection notes, notes, deal value (text input `inputMode="decimal"`, label shows the org default currency, e.g. "Deal value (USD)"; currency itself isn't sent → DB default), **owner select only for managers** (default = current user; reps never send `ownerId`).
16. Submit → `createProspect`; error → toast, dialog stays open; success → toast "<name> was added." with a "View" action to `/prospects/[id]`, close, `router.refresh()` (the form resets when the dialog opens, so a closing dialog never flashes empty). Busy state disables the buttons and prevents closing. Scrollable content on small screens.

### Reusable components — `src/components/prospects/` (Prompts 8–10 reuse these)
17. `StageBadge` (closed won green, closed lost red, others neutral), `FollowUpBadge` (`{ dueDate, timezone }`), `StaleBadge`, `ObjectionChips` (`max?`), `DecisionMakerLabel`; `ObjectionMultiSelect` (`value`, `onChange`, `id`, aria props; Popover + Command with check marks, selected values shown as chips in the trigger, keyboard operable).

### Time helper
18. `formatRelativeTime(utc, now?)` in `src/lib/time.ts` ("just now" < 1 min, otherwise date-fns `formatDistanceStrict` with suffix, e.g. "3 days ago"); timezone-independent (a duration). Unit-tested.

### Seed (for checking; Prompt 14 expands it)
19. `supabase/seed.sql`: ~8 prospects with fixed UUIDs `22222222-2222-4222-8222-0000000000NN` (`on conflict do nothing`) for Riley and Sam: various stages/objections/decision-maker statuses/deal values (incl. one null), one stale (`last_activity_at` 30 days ago), one closed (with close reason), pending follow-ups yesterday (overdue) and today (relative to `org_today()`). Must keep `npm run test:db` and `npm run test:integration` green (they must not assume an empty table).

### Out of scope
Detail page content (Prompt 8), Kanban (9), follow-up pages (10), inline editing, bulk actions, CSV export, saved views, owner reassignment from the list.

## 2. Files

| File | Purpose |
|---|---|
| `src/lib/validation/prospect-list.ts` + test | URL params schema, defaults, `prospectListHref`, `hasActiveFilters`, `escapeSearchTerm`/`searchOrFilter` |
| `src/lib/time.ts` + test | `formatRelativeTime` |
| `src/server/data/prospect-list.ts` | `listProspectsData` |
| `src/app/(app)/prospects/{page,loading,error}.tsx`, `prospect-filters.tsx`, `prospects-table.tsx`, `prospect-row-link.tsx`, `pagination.tsx` | page |
| `src/components/prospects/*` | badges, objection multi-select, new-prospect dialog |
| `src/components/app-shell/page-header.tsx` | optional `actions` slot |
| `supabase/seed.sql` | demo prospects + follow-ups |
| `tests/integration/prospect-list.test.ts` | RLS scoping, owner param ignored for reps, search escaping, each filter, sort, pagination |
| `e2e/prospects.spec.ts` | rep + manager browser flow |
| `CLAUDE.md`, `BUILD_PROGRESS.md` | notes, row 7 |

## 3. Steps
1. This plan. 2. Params schema + search escaping + relative time (+ unit tests). 3. Data function + integration tests (seed first). 4. Components + page + loading/error. 5. Browser check as Riley (rep) and Morgan (manager): create, search, each filter, sort, pagination (temporarily > 25 rows), rep sees only own rows, manager owner column/filter; 375 px width. 6. e2e spec. 7. `npm run verify`, `test:db`, `test:integration`, e2e. 8. Docs + commit.

## 4. Verification checklist ("Done when")
- [x] Create: the dialog validates (name required, bad email/deal value), creates via `createProspect`, toast, row appears; manager can pick another owner, rep has no owner field.
- [x] Search across name/company/email works; `%`, `_`, `,`, `(` are literal (integration test).
- [x] Each filter (stage, owner [manager], decision maker, objection, overdue, stale) works and is reflected in the URL; invalid params (`?page=abc&sort=evil&stage=nope`) render defaults without errors.
- [x] Sorting by each sortable column, both directions; pagination 25/page with exact count ("Showing x–y of N").
- [x] A rep only sees their own rows, has no Owner column/filter, and `?owner=<other id>` changes nothing; a manager sees all rows + Owner column + filter.
- [x] Badges: Overdue (red) / Today (amber) from `followUpBucket` in the org tz; Stale badge; money via `formatMoney`; relative last activity.
- [x] Row click and keyboard (Tab to name link + Enter) open `/prospects/[id]`; empty (none vs no matches), loading skeleton and error states exist; 375 px has no page-level horizontal scroll.
- [x] `npm run verify` passes; `npm run test:db`, `npm run test:integration`, e2e green.
