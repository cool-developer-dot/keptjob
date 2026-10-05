# Prompt 3 (enhanced): Auth + app shell

Source: `BUILD_PROMPTS.md` → "Prompt 3: Auth + app shell". `SPEC.md` §4 (users, roles, no public sign-up, email + password + forgot password) and §11 (pages) are the source of truth; if this plan conflicts with them, SPEC.md wins. Nothing from SPEC §14 may be added (no sign-up page, no custom emails beyond Supabase auth emails, no extra admin features). The Settings page content (org settings, team invites) is Prompt 4 — here it is a placeholder, but already manager-only.

Goal: a signed-out user can only reach the auth pages; a signed-in user gets the app shell (sidebar + header) with placeholder pages for every route; reps never see or reach Settings; password reset works end to end against local Supabase (Mailpit); seeded dev users (1 manager, 2 reps) can log in.

---

## 0. What already exists (do not rebuild)

- `src/lib/supabase/server.ts` (`createClient()` user-scoped, async `cookies()`), `client.ts` (browser), `admin.ts` (service role, server-only — **not used in this prompt**), `env.ts`, `middleware.ts` → `updateSession(request)` returns `{ response, user }` (calls `getUser()`, keeps refreshed cookies on `response`).
- DB (Prompts 1–2): `public.users (id, full_name, email, role)` is created by the `on_auth_user_created` trigger from `auth.users` (role from `raw_app_meta_data.role`, `full_name` from `raw_user_meta_data.full_name`); role sync both ways; RLS lets every authenticated user `select` all `users` rows.
- `src/lib/constants.ts`: `ROLES`, `ROLE_LABELS` (use these for the role badge; no new enum literals).
- shadcn components: button, card, input, label, form (hand-written), badge, sheet, separator, avatar, dropdown-menu, sonner (`<Toaster>` already in root layout), tooltip.
- `supabase/config.toml`: `[auth] enable_signup = false`, `site_url = "http://localhost:3000"`, `additional_redirect_urls` covers `http://localhost:3000/**`.

## 1. Pitfalls and design decisions (read first)

1. **Next.js 16:** middleware is `src/proxy.ts` exporting `proxy(request)` + `config.matcher`; runs on the Node runtime. `cookies()`, `headers()`, `params` and `searchParams` are **Promises** (await them). `next lint` is gone.
2. **Never trust `getSession()` on the server.** Auth decisions use `getUser()` (proxy, via `updateSession`) or `getClaims()` (verified JWT; `getCurrentUser`). The role for UI/authorization comes from `public.users.role` (server) — in the proxy, from `user.app_metadata.role` (= `raw_app_meta_data`, not user-editable; `getUser()` reads it fresh from GoTrue).
3. **Proxy redirects must keep refreshed cookies:** when redirecting, copy `response.cookies` from `updateSession` onto the redirect response.
4. **Matcher** excludes `_next/static`, `_next/image`, `favicon.ico` and static image files, otherwise CSS/JS get redirected to /login.
5. **Public routes** (no session needed): `/login`, `/forgot-password`, `/auth/confirm`. Everything else requires a session (including `/set-password`, which is reached with the session created by `/auth/confirm`). `/auth/confirm` must stay reachable when already signed in (recovery link clicked in a logged-in browser replaces the session).
6. **Open-redirect safety:** the proxy sends unauthenticated users to `/login?next=<path+query>`. `next` is only honoured if it is a same-origin relative path: starts with a single `/`, not `//` or `/\`, no scheme, no control chars, not an auth route; otherwise `/dashboard`. Pure helper `safeNextPath()` in `src/lib/safe-redirect.ts`, unit-tested. `/auth/confirm` ignores arbitrary targets and always goes to `/set-password`.
7. **/settings is managers only, twice:** proxy redirects non-managers to `/dashboard`; the page calls `requireManager()` (server) which redirects too. The nav item is not rendered for reps (filtered by role; not just hidden with CSS).
8. **`getCurrentUser()`** (`src/lib/auth.ts`, `server-only`) is wrapped in React `cache()` (once per request), returns `{ id, full_name, email, role } | null`, reading `public.users` via the user-scoped client (RLS). `requireUser()` → redirect `/login` if null; `requireManager()` → `requireUser()` + redirect `/dashboard` if not manager. Both return the user.
9. **Auth mutations are server actions** in `src/server/actions/auth.ts`, Zod-validated again on the server (`src/lib/validation/auth.ts`), returning `ActionResult` for expected failures; on success they `redirect()` (login → `safeNextPath(next)`, set-password → `/dashboard`, logout → `/login`). Error messages are user-presentable: invalid credentials → "Invalid email or password."; never reveal whether an email exists (forgot-password always shows the same success message, also when the email is unknown).
10. **Password rules:** min 8 chars + confirm field (Zod `refine`, error on `confirmPassword`). Also set `minimum_password_length = 8` in `config.toml` so the server agrees with the form.
11. **`/auth/confirm` route handler** (`GET`): reads `token_hash` and `type`; only `invite` and `recovery` are accepted; `verifyOtp({ type, token_hash })` with the server client (sets session cookies) → redirect `/set-password`. Missing/invalid params or a verify error (expired/used link) → redirect `/login?error=invalid_link` (login page shows "This link is invalid or has expired…"). Also handle GoTrue-style `error`/`error_description` query params the same way.
12. **Auth emails (local):** templates under `supabase/templates/{invite,recovery}.html` use the token-hash pattern `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite|recovery` (works with SSR cookies; the default `{{ .ConfirmationURL }}` uses the implicit flow / hash fragment, which a server can't read). Wire them via `[auth.email.template.invite]` / `[auth.email.template.recovery]` with `content_path = "./supabase/templates/…"`. `site_url = http://localhost:3000`; `additional_redirect_urls` includes `http://localhost:3000/auth/confirm` (+ the existing `/**` globs). Config changes need `npx supabase stop && npx supabase start` to take effect. Local emails land in Mailpit (http://127.0.0.1:54324). The local email rate limit (`[auth.rate_limit] email_sent`) may block repeated testing; raise it locally if needed.
13. **`resetPasswordForEmail(email, { redirectTo: SITE_URL + '/auth/confirm' })`**; `SITE_URL` = `NEXT_PUBLIC_SITE_URL` (fallback: request origin). Helper `getSiteUrl()` in `src/lib/site-url.ts`.
14. **Seed (`supabase/seed.sql`)** inserting into `auth.users` directly must look like a GoTrue-created user or login fails ("Database error querying schema"/invalid credentials):
    - `instance_id = '00000000-0000-0000-0000-000000000000'`, `aud = 'authenticated'`, `role = 'authenticated'`, `email_confirmed_at = now()`, `created_at/updated_at = now()`.
    - `encrypted_password = extensions.crypt('<pw>', extensions.gen_salt('bf'))` (bcrypt).
    - Token columns non-null `''`: `confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token`.
    - `raw_app_meta_data = {"provider":"email","providers":["email"],"role":"manager"|"sales_rep"}`, `raw_user_meta_data = {"full_name": "..."}`.
    - A matching `auth.identities` row: `provider = 'email'`, `provider_id = user id::text`, `identity_data = {"sub": id, "email": ..., "email_verified": true}`, timestamps.
    - Fixed UUIDs (Prompt 14 expands the seed with prospects owned by these users). Emails must not collide with pgTAP test users (`mia@`, `alex@`, `bea@`, `xav@`, `yan@example.com`, `*@rls.test`).
    - `public.users` rows come from the trigger — don't insert them.
15. **Seed vs pgTAP:** `npm run test:db` runs against the seeded DB. `schema.test.sql`'s last-manager assertions assume its manager is the only one → add a setup line (like `rls.test.sql` already has) demoting other managers inside the test transaction. Assertions are not weakened.
16. **Layout structure:** route groups `src/app/(auth)/` (centered card layout: login, forgot-password, set-password) and `src/app/(app)/` (shell layout calling `requireUser()`: dashboard, pipeline, prospects, prospects/[id], follow-ups, reports, settings). `/` redirects to `/dashboard`. Nav items live in one client module (icons are components, can't cross the server→client boundary as props); the server layout passes `role` and user info.
17. **Mobile:** below `md` the sidebar is replaced by a menu button opening a `Sheet` (side left) with the same nav; the sheet closes on navigation.
18. **Don't** add sign-up, profile editing, or Settings functionality (Prompt 4).

## 2. Files

| File | Purpose |
|---|---|
| `src/proxy.ts` | `updateSession` → redirects (unauth → `/login?next=`, auth on `/login`/`/forgot-password` → `/dashboard`, non-manager on `/settings*` → `/dashboard`), cookie-preserving redirects, matcher |
| `src/lib/auth.ts` | `getCurrentUser()` (cached), `requireUser()`, `requireManager()`, type `CurrentUser` |
| `src/lib/safe-redirect.ts` (+ `.test.ts`) | `safeNextPath(next, fallback = '/dashboard')`, `PUBLIC_AUTH_PATHS` / `isPublicPath()` shared with the proxy |
| `src/lib/site-url.ts` | `getSiteUrl()` |
| `src/lib/validation/auth.ts` (+ `.test.ts`) | `loginSchema`, `forgotPasswordSchema`, `setPasswordSchema` |
| `src/server/actions/auth.ts` | `signIn`, `requestPasswordReset`, `setPassword`, `signOut` |
| `src/app/auth/confirm/route.ts` | token-hash verification |
| `src/app/(auth)/layout.tsx`, `login/`, `forgot-password/`, `set-password/` | auth pages (server page + client form) |
| `src/app/(app)/layout.tsx` | shell: sidebar, header (name, role badge, logout), mobile sheet |
| `src/app/(app)/{dashboard,pipeline,prospects,prospects/[id],follow-ups,reports,settings}/page.tsx` | placeholders (`settings` calls `requireManager()`) |
| `src/components/app-shell/*` | `nav-items.ts`, `app-sidebar.tsx`, `mobile-nav.tsx`, `user-menu.tsx` |
| `src/app/page.tsx` | `redirect('/dashboard')` |
| `supabase/seed.sql` | 1 manager + 2 reps (auth.users + identities) |
| `supabase/templates/{invite,recovery}.html`, `supabase/config.toml` | token-hash email templates, redirect URLs, min password length |
| `e2e/auth.spec.ts` | Playwright check of the flows below (initial e2e spec) |
| README | dev credentials (only place they are documented) |

## 3. Steps

1. Write this plan. 2. Config + templates + seed; `npx supabase stop && npx supabase start` (config), `npm run db:reset`; fix `schema.test.sql` setup; `npm run test:db` green. 3. Libs (`safe-redirect`, `site-url`, `auth`, validation) + unit tests. 4. Server actions, `/auth/confirm`, proxy. 5. Auth pages, shell, placeholders. 6. `.env.local` from `npx supabase status` (never committed). 7. Browser check (dev server) + Playwright spec. 8. `npm run verify`. 9. README credentials, CLAUDE.md conventions, BUILD_PROGRESS row 3. 10. Commit.

## 4. Verification checklist ("Done when")

- [ ] Unauthenticated `GET /dashboard` (and every app route) → `/login?next=/dashboard`; `/login`, `/forgot-password`, `/auth/confirm` reachable signed out.
- [ ] Login with seeded manager → `/dashboard`; header shows name + "Manager" badge; sidebar shows Dashboard, Pipeline, Prospects, Follow-ups, Reports, **Settings**.
- [ ] Login with a seeded rep → sidebar has **no** Settings link (not in DOM); header badge "Sales Rep"; `GET /settings` → redirected to `/dashboard` (proxy) and `requireManager()` guards the page server-side.
- [ ] Signed in, `GET /login` → `/dashboard`.
- [ ] `?next=` honoured only for safe relative paths (`//evil.com`, `https://evil.com`, `/\evil.com` → `/dashboard`) — unit tests.
- [ ] Wrong password → error toast "Invalid email or password.", stays on `/login`.
- [ ] Logout → `/login`; afterwards `/dashboard` → `/login`.
- [ ] Forgot password → generic success message; recovery email arrives in Mailpit with a `…/auth/confirm?token_hash=…&type=recovery` link; opening it → `/set-password`; mismatched/short password shows field errors; valid new password → `/dashboard`; login with the new password works. Invalid/used link → `/login?error=invalid_link` with a message.
- [ ] Invite template wired (`type=invite` link) — full invite flow is verified in Prompt 4.
- [ ] Mobile width: menu button opens the nav sheet; selecting an item navigates and closes it.
- [ ] Every route has a placeholder page; `/` → `/dashboard`.
- [ ] `npm run db:reset` seeds 3 users; `npm run test:db` green; `npm run verify` passes; `.env.local` not committed; dev credentials only in README.
