# Prompt 4 (enhanced): Org settings, time helpers, Team page

Source: `BUILD_PROMPTS.md` → "Prompt 4: Org settings, time helpers, Team page". `SPEC.md` §4 (roles, invites, last manager), §5 (org settings), §6 (time), §8 (follow-up views) and §11 (Settings page) are the source of truth; if this plan conflicts with them, SPEC.md wins. Nothing from SPEC §14 may be added: Settings stays minimal (org settings + team list/invite/role change). No user deletion, no deactivation, no resend/revoke-invite UI, no profile editing, no audit log, no custom emails (only the Supabase invite email).

Goal: pure, tested org-timezone helpers every later prompt uses; org settings readable everywhere (server helper + client context) and editable by managers; a Team tab where managers invite users (email arrives in Mailpit, link → set password → login with the right role) and change roles (DB enforces the last-manager rule).

---

## 0. What already exists (do not rebuild)

- `org_settings` (single row `id = true`): `default_currency char(3)` (`^[A-Z]{3}$`), `timezone` (CHECK: the 7 allowed US zones), `stale_days` (1–365), `updated_at` (trigger), `updated_by` (trigger: `coalesce(auth.uid(), …)`). RLS: select = any authenticated; update = managers only (`is_manager()`). **Column grants: `update (default_currency, timezone, stale_days)` only** — sending `updated_by`/`updated_at`/`id` in the payload fails with 42501. A rep's update matches 0 rows silently (USING) → check affected rows.
- `public.users`: created by `on_auth_user_created` (`handle_new_user`: role from `raw_app_meta_data.role`, default `sales_rep`; `full_name` from `raw_user_meta_data.full_name`). `on_auth_user_updated` syncs `raw_app_meta_data.role` → `public.users.role`; `users_sync_role_to_auth` mirrors back. `users_protect_last_manager_update` raises **P0001 `At least one manager must remain`**. `users_before_update_guard` raises **42501 `Only managers can change roles`** for signed-in non-managers (service role / GoTrue bypass it: `auth.uid()` null). Grants: `update (full_name, role)` for authenticated; RLS `users_update` = own row or manager.
- `src/lib/auth.ts`: `getCurrentUser()` (cached), `requireUser()`, `requireManager()` (redirects). `src/lib/supabase/{server,admin}.ts`, `src/lib/site-url.ts` (`getSiteUrl()`), `ActionResult<T>` in `src/server/actions/types.ts`.
- `src/lib/constants.ts`: `ALLOWED_TIMEZONES`, `TIMEZONE_OPTIONS`, `ROLES`, `ROLE_OPTIONS`, `ROLE_LABELS`. `src/lib/time.ts` is a stub (`export {}`).
- `/auth/confirm` handles `type=invite` → `/set-password`; invite template `supabase/templates/invite.html` uses the token-hash link. `/settings` page is a placeholder calling `requireManager()`; proxy already blocks reps.
- shadcn: tabs, select, dialog, table, form, input, badge, button, card, sonner.

## 1. Pitfalls and design decisions (read first)

### time.ts (pure; no `server-only`, no Supabase, no `Date.now()` hidden inside except as the `now` default)
1. Built on `@date-fns/tz` (`TZDate`, `tz()`) + `date-fns` (`format`, `addDays`, `parseISO`-free parsing). **Never** use the host/browser timezone (`new Date().getDate()`, `toLocaleDateString()` without `timeZone`, `date-fns` without `in: tz(...)`). Tests must pass regardless of `process.env.TZ` (run one test block with a different `TZ` assumption by asserting UTC instants only).
2. Calendar dates are **`YYYY-MM-DD` strings** (type `DateString`), matching Postgres `date` (`follow_ups.due_date`) and `org_today()`. Instants are `Date | string` (ISO / `timestamptz` from Supabase) in, `Date` out.
3. API (all take `tz: string`; invalid input → `RangeError`):
   - `orgToday(tz, now = new Date()): DateString` — current calendar date in the org tz (= SQL `org_today()`).
   - `toOrgDate(utc, tz): DateString` — calendar date of an instant in the org tz.
   - `formatOrgDateTime(utc, tz, pattern = "MMM d, yyyy h:mm a"): string`; plus `formatOrgDate(utc, tz, pattern = "MMM d, yyyy")` and `formatDateString(date: DateString, pattern = "MMM d, yyyy")` (formats a calendar date without any tz shift — for `due_date`).
   - `orgLocalToUtc(dateStr: DateString, timeStr: "HH:mm", tz): Date` — demo entry. **DST rules (documented + tested):** a nonexistent local time (spring-forward gap, e.g. 2026-03-08 02:30 New York) is shifted **forward by the gap** → 03:30 EDT = 07:30Z (same as browsers/`TZDate`); an ambiguous time (fall-back, 2026-11-01 01:30 New York) resolves to the **earlier** occurrence (EDT, 05:30Z).
   - `utcToOrgLocal(utc, tz): { date: DateString; time: "HH:mm" }` — inverse, to prefill demo date/time inputs.
   - `addDaysToDateString(date, n): DateString` — calendar arithmetic without tz (pure string date math in UTC).
   - `followUpBucket(dueDate: DateString, tz, now = new Date()): "overdue" | "today" | "upcoming" | "later"` — for **pending** follow-ups (completed ones belong to the Completed view; the caller filters by status). `today = orgToday(tz, now)`: `due < today` → `overdue` (SPEC §8: pending and due before today); `due = today` → `today`; `today < due ≤ today + UPCOMING_DAYS` → `upcoming`; beyond → `later`. **`UPCOMING_DAYS = 7`** (exported; matches Prompt 10's "Upcoming (next 7 days)"). String comparison of `YYYY-MM-DD` is correct ordering.
4. Required test cases (`src/lib/time.test.ts`):
   - 11pm New York (2026-10-06T23:00 EDT = 2026-10-07T03:00Z): `orgToday` = `2026-10-06` (UTC date is the 7th); `toOrgDate` same; a follow-up due `2026-10-06` is `today`, due `2026-10-05` `overdue`, `2026-10-07` `upcoming`.
   - UTC midnight exactly (`2026-10-07T00:00Z`): NY still 2026-10-06; Honolulu 2026-10-06 (14:00 prev day).
   - DST spring-forward 2026-03-08 NY: 01:59 EST = 06:59Z, 03:00 EDT = 07:00Z, nonexistent 02:30 → 07:30Z; `orgToday` on both sides of the jump; `formatOrgDateTime` shows the right wall clock before/after.
   - DST fall-back 2026-11-01 NY: 01:30 ambiguous → 05:30Z; 02:00 EST = 07:00Z; 00:30 → 04:30Z.
   - Honolulu (UTC−10, no DST) and Phoenix (UTC−7 all year, no DST): `orgLocalToUtc` gives the same offset in March and November (e.g. 09:00 Phoenix = 16:00Z on 2026-01-15 and 2026-07-15) while Denver differs (16:00Z vs 15:00Z).
   - Bucket boundaries: today+7 → `upcoming`, today+8 → `later`; month/year rollover (`2026-12-31` + 1 = `2027-01-01`).
   - Round trip `utcToOrgLocal(orgLocalToUtc(d, t, tz), tz)` for every allowed timezone.
   - Invalid input (`"2026-13-01"`, `"25:00"`, unknown tz) → throws.

### Org settings access
5. `src/lib/org.ts` (`server-only`): `getOrgSettings = cache(async () => …)` (React `cache`, once per request) reading `default_currency, timezone, stale_days` via the **user-scoped** client (RLS select allows any authenticated). Returns a typed `OrgSettings { defaultCurrency, timezone: AllowedTimezone, staleDays }`. If the row can't be read (signed out / error) fall back to `DEFAULT_ORG_SETTINGS` (USD, America/New_York, 14 — the only place these defaults live in TS besides the DB default; mirrored from the migration). `default_currency` is `char(3)` → trim.
6. `src/components/org-settings-provider.tsx` (`"use client"`): `OrgSettingsProvider({ value, children })` + `useOrgSettings()` (throws outside the provider). The `(app)` layout fetches `getOrgSettings()` and wraps the shell. Types/defaults shared from a non-server module (`src/lib/org-settings.ts`) so client code doesn't import `server-only`.

### Money
7. `src/lib/money.ts`: `formatMoney(value: number | string | null | undefined, currency: string, opts?)` via `Intl.NumberFormat("en-US", { style: "currency", currency })`; Postgres `numeric` arrives as string → `Number()`; null/NaN → `"—"`; unknown currency code → falls back to `"<value> <CODE>"` instead of throwing. `COMMON_CURRENCIES` (USD, EUR, GBP, CAD, AUD, NZD, CHF, JPY, CNY, INR, MXN, BRL, SGD, HKD, SEK, NOK, DKK, ZAR) + `isSupportedCurrency(code)` (Intl `supportedValuesOf("currency")`). Unit-tested (USD, EUR, JPY no decimals, string input, null). Not multi-currency conversion (out of scope).

### Server actions (`src/server/actions/settings.ts`, `"use server"`, all return `ActionResult`)
8. Every action: `await requireManager()` **first** (it redirects non-managers; reps can't reach the admin client), then Zod `safeParse` again on the server (schemas in `src/lib/validation/settings.ts`, shared with the client forms), then `revalidatePath("/settings")` (and `"/", "layout"` for org settings so the provider value refreshes).
9. `updateOrgSettings({ defaultCurrency, timezone, staleDays })`: Zod — currency `^[A-Z]{3}$` + `isSupportedCurrency`; timezone `z.enum(ALLOWED_TIMEZONES)`; staleDays `z.coerce.number().int().min(1).max(365)`. **User-scoped client** (RLS: managers only) `.update({ default_currency, timezone, stale_days }).eq("id", true).select(...)` — payload contains **only** the 3 granted columns (never `updated_by`, the trigger sets it). 0 rows → "You don't have permission…". Returns the new settings.
10. `inviteUser({ fullName, email, role })`: Zod (name 1–100 trimmed, email lowercased, role `z.enum(ROLES)`). Then the admin client:
    - `auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo: \`${await getSiteUrl()}/auth/confirm\` })` (`getSiteUrl()` = `NEXT_PUBLIC_SITE_URL`, fallback origin).
    - Then `auth.admin.updateUserById(id, { app_metadata: { role } })` → `on_auth_user_updated` sets `public.users.role` (handle_new_user created it as `sales_rep`; GoTrue has `auth.uid()` null so the role guard doesn't block). Set it for **both** roles so `raw_app_meta_data.role` is always explicit.
    - If the role update fails: delete the just-created auth user (`auth.admin.deleteUser`) so no half-configured account remains, and return an error.
    - "Already registered": GoTrue returns 422 `email_exists` (or message "already been registered") → `{ ok:false, error: "A user with this email already exists." }`. Rate limit (429 / `over_email_send_rate_limit`) → friendly message. Other errors → generic message (log server-side; never leak the service-role error).
    - Pre-check `public.users` (user-scoped) for the email to give the "already exists" message without calling GoTrue.
    - Returns `{ id, email }`. The admin client is **never** imported into client code and never used before `requireManager()`.
11. `changeUserRole({ userId, role })`: Zod (uuid, role enum). **User-scoped client** `.from("users").update({ role }).eq("id", userId).select("id, role")` so RLS + `users_before_update_guard` + `protect_last_manager` + role→auth sync all apply. Error mapping: `P0001`/"At least one manager must remain" → "At least one manager must remain. Promote another user to manager first."; `42501` → "Only managers can change roles."; 0 rows → "User not found." Changing your own role to rep (when another manager exists) is allowed; afterwards the page redirects you (requireManager) — the client then navigates to `/dashboard`.
12. Role changes take effect immediately for authorization: `getCurrentUser()` reads `public.users.role`; the proxy reads `app_metadata.role` from `getUser()` (fresh from GoTrue; synced by trigger).

### UI (`/settings`, managers only)
13. `page.tsx` (server): `requireManager()`, then `getOrgSettings()` + users list (user-scoped select `id, full_name, email, role, created_at` order by `created_at`). Tabs (shadcn `Tabs`, default "Organization"; `?tab=team` selects Team so links/reloads keep the tab).
14. Organization tab (client form, react-hook-form + zodResolver, same schema): currency `Select` (COMMON_CURRENCIES with code + name; include the current value if not in the list), timezone `Select` (`TIMEZONE_OPTIONS`), stale days `Input type=number` (1–365). Note under currency, exactly: "Applies to new prospects; existing prospects keep their currency." Save → toast success/error; button disabled while pending/not dirty.
15. Team tab: table (Name, Email, Role, Joined — "Joined" = `created_at` formatted with `formatOrgDate` in the org tz). Role column = `Select` per user (`ROLE_OPTIONS`), calling `changeUserRole`; on error toast the friendly message and revert the select; current user marked "(you)". "Invite user" button → `Dialog` with full name, email, role (default Sales Rep) → `inviteUser`; success toast "Invitation sent to …", dialog closes + resets, list refreshes (revalidatePath + `router.refresh()`).
16. Accessible labels so e2e can target them (`getByLabel("Full name")`, `getByRole("combobox", { name: "Role for <name>" })`).

### Local email / config
17. Local GoTrue counts the admin invite toward `[auth.rate_limit] email_sent` (currently 2/hour) → repeated invite testing hits 429. Raise to a dev-friendly value (e.g. 100) in `supabase/config.toml` (local only; hosted limits are set in the dashboard), then `npx supabase stop && npx supabase start`.

## 2. Files

| File | Purpose |
|---|---|
| `src/lib/time.ts` (+ `time.test.ts`) | pure org-tz helpers above |
| `src/lib/money.ts` (+ `money.test.ts`) | `formatMoney`, `COMMON_CURRENCIES`, `isSupportedCurrency` |
| `src/lib/org-settings.ts` | `OrgSettings` type, `DEFAULT_ORG_SETTINGS`, row mapper (client-safe) |
| `src/lib/org.ts` | `getOrgSettings()` (server-only, React `cache`) |
| `src/components/org-settings-provider.tsx` | `OrgSettingsProvider`, `useOrgSettings()` |
| `src/lib/validation/settings.ts` (+ test) | `orgSettingsSchema`, `inviteUserSchema`, `changeRoleSchema` |
| `src/server/actions/settings.ts` | `updateOrgSettings`, `inviteUser`, `changeUserRole` |
| `src/app/(app)/layout.tsx` | wrap in `OrgSettingsProvider` |
| `src/app/(app)/settings/{page.tsx, org-settings-form.tsx, team-table.tsx, invite-user-dialog.tsx, settings-tabs.tsx}` | UI |
| `supabase/config.toml` | local `email_sent` rate limit |
| `e2e/settings.spec.ts` | org settings save + invite → Mailpit → set password → login with role + role change / last-manager error |

## 3. Steps

1. This plan. 2. time.ts + tests; money.ts + tests; validation + tests. 3. org.ts + provider + layout. 4. Server actions. 5. Settings UI. 6. Config rate limit + restart Supabase. 7. Browser check (dev server) + `e2e/settings.spec.ts` (`PLAYWRIGHT_CHANNEL=chrome`), DB check that `public.users.role` + `raw_app_meta_data.role` are right for invited managers and reps. 8. Clean up test users (`npm run db:reset`). 9. `npm run test:db`, `npm run verify`. 10. CLAUDE.md notes (time.ts API, org settings access, money), BUILD_PROGRESS row 4, commit.

## 4. Verification checklist ("Done when")

- [ ] `src/lib/time.ts` is pure (no server-only/Supabase imports) and its tests pass: 11pm NY = next UTC day, UTC midnight, DST spring-forward (incl. nonexistent 02:30) and fall-back (ambiguous 01:30), Honolulu + Phoenix (no DST), bucket boundaries (overdue/today/upcoming ≤ 7 days/later), invalid inputs.
- [ ] `formatMoney` tests pass; `getOrgSettings()` is `cache()`-wrapped; client components read settings via `useOrgSettings()`.
- [ ] `/settings` (manager): Organization tab saves currency/timezone/stale days (persisted in `org_settings`, `updated_by` = manager via trigger); the currency note is shown; stale days outside 1–365 rejected client- and server-side. Rep cannot reach the page or the actions (requireManager).
- [ ] Team tab lists users (name, email, role, joined). Invite dialog → email in Mailpit (http://127.0.0.1:54324) with a `/auth/confirm?token_hash=…&type=invite` link → `/set-password` → password set → `/dashboard`, signed in with the invited role (header badge); `public.users.role` and `auth.users.raw_app_meta_data.role` match (checked in DB for a manager invite).
- [ ] Inviting an existing email → "A user with this email already exists." (no new user).
- [ ] Changing a role works; demoting the last manager shows "At least one manager must remain…" and the select reverts.
- [ ] All actions return `{ ok: true, data } | { ok: false, error }`; admin client used only after `requireManager()`; org update payload only contains granted columns.
- [ ] Test users cleaned up (`npm run db:reset`); `npm run test:db` green; `npm run verify` passes; `.env.local` not committed.
