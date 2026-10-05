# Prompt 15 (enhanced): Deploy

Source: `BUILD_PROMPTS.md` → "Prompt 15: Deploy". `SPEC.md` is the source of truth (§4 no public sign-up, invites, role in `app_metadata`, ≥ 1 manager; §5 org settings; §10 AI via `OPENAI_MODEL`; §13 Vercel + GitHub). No new product features.

Goal: production on Vercel + Supabase cloud + a private GitHub repo, with the first manager created by a script, and a smoke test that walks the real invite → login → prospect → AI path.

This session is split in two:

- **Part A — local preparation (done by Claude without any account):** README, `scripts/create-manager.mts`, production-readiness checks, CI workflow, full regression, local commit.
- **Part B — cloud deploy (needs the user):** every step marked **[USER]** needs an account, a credential or an explicit go-ahead (creating a repo, pushing, linking/pushing to a cloud database, deploying). Claude must not run them without that go-ahead.

---

## Part A — local preparation

### A1. `scripts/create-manager.mts` (first manager in production)

- Runs with the Node 22 built-in TypeScript type stripping (no global install, no new dependency): `npm run create-manager -- --email <email> --name "<Full Name>" [--dotenv <path>] [--link] [--yes]`. Standalone (no `@/` imports, no `server-only`), only `@supabase/supabase-js`.
- Env: `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (+ `NEXT_PUBLIC_SITE_URL`/`SITE_URL` for links). `--dotenv` loads a dotenv file via `process.loadEnvFile` (e.g. `.env.production.local`, git-ignored).
- **Safer path, no password ever handled by the script:**
  - default: `auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo: <site>/auth/confirm })` → the person sets their own password from the email (same flow as Settings → Team invites);
  - `--link`: `auth.admin.generateLink({ type: "invite" })` and print a one-time `<site>/auth/confirm?token_hash=…&type=invite` link (for when email delivery isn't set up yet — the default Supabase sender only delivers to project team members). The link is single-use and expires (`otp_expiry`).
  - then `updateUserById(id, { app_metadata: { role: "manager" } })` (triggers sync `public.users.role`); if that fails the just-created user is deleted (no half-configured account).
- **Idempotent:** an existing user (looked up by lowercased email through the admin API) is promoted (`app_metadata.role = "manager"`, other app_metadata kept) — or reported as already a manager; no email is sent and the password is untouched (they can use "Forgot password"). Verifies `public.users.role = 'manager'` afterwards.
- Safety: prints the target host; for a non-local target asks for confirmation (`--yes` skips; non-interactive without `--yes` aborts). Clear errors for missing env, bad email/name, wrong key (401/403), unreachable URL, rate limits, SMTP errors (suggest `--link`). Exit code ≠ 0 on failure.
- Test against **local** Supabase: invite a new address (Mailpit receives it), run again (→ already manager), promote a seed rep, `--link` for a new address (open link → `/set-password`), invalid args/env, then clean up the test users and restore the seed rep (`npm run db:reset`).

### A2. Production readiness

- `next.config.ts`: `poweredByHeader: false` + cheap security headers on every route: `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` (no full CSP — Next inline scripts would need nonces), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security: max-age=63072000; includeSubDomains` (ignored on http://localhost).
- `next build` with the production env shape using canary values for the secrets (`SUPABASE_SERVICE_ROLE_KEY=CANARY_SERVICE_ROLE_…`, `OPENAI_API_KEY=sk-CANARY…`, `OPENAI_MODEL`, `NEXT_PUBLIC_*`) → grep `.next/static` for the canaries, the local service-role JWT, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: **no hits**. Only `NEXT_PUBLIC_*` values may appear in client chunks.
- AI fake can't activate in prod: `isFakeAiEnabled` is unit-tested; additionally run `next start` (production build) with `AI_FAKE=1` and no OpenAI key → "Generate AI Insights" shows "AI is not configured" (nothing stored).
- Migrations apply from scratch: `npm run db:reset` (also proves `supabase db push` order). The seed is **local only** (`db push` never runs it unless `--include-seed`, which must not be used: it contains known passwords).
- `vercel.json`: **not needed** (Next.js is auto-detected; no rewrites/crons/regions). Node 22 on Vercel (default).
- Headers verified with `curl -I` against `next start`.

### A3. CI (`.github/workflows/ci.yml`, no secrets)

- Job `verify`: Node 22, `npm ci`, typecheck, lint, test, build.
- Job `supabase` (after verify): `npx supabase start` (exclude studio/imgproxy/edge-runtime/logflare/vector/supavisor/storage), write `.env.local` from `npx supabase status -o env` (local demo keys only), `npm run test:db`, `npm run test:integration` (psql is preinstalled on ubuntu runners), Playwright Chromium + `npm run e2e` (CI=true → fresh dev server with `AI_FAKE=1`, 2 retries), upload the report on failure.
- Committed locally only; it runs once the user pushes.

### A4. README

Overview + features, stack, local setup (Docker, `npx supabase start`, env, seed credentials), scripts table (incl. `create-manager`, `test:db`), tests, environment variables table (where each goes; server-only vs public), AI key setup, changing org timezone/currency, **deploying** (short version + link to this runbook), creating the first manager, troubleshooting (emails/rate limits).

### A5. Regression + bookkeeping

`npm run verify`, `npm run test:db`, `npm run test:integration`, `PLAYWRIGHT_CHANNEL=chrome npm run e2e` all green. Commit locally (no remote). BUILD_PROGRESS row 15 = "local prep done — cloud deploy awaiting user" + an exact checklist of what the user must provide. Stop the dev server; leave local Supabase running.

---

## Part B — cloud deploy runbook (all **[USER]**-gated)

### B0. What the user must provide / approve

1. **GitHub**: repo name + visibility (private recommended) and which account/org (gh is logged in as `farandev-team`, also `cool-developer-dot`). Approval to create the repo and push.
2. **Supabase cloud**: an existing project (ref + DB password) or permission to create one (org, region close to the users — e.g. `us-east-1` for an ET org, plan). `npx supabase login` is interactive → the user runs it.
3. **Vercel**: account/team; `npx vercel login` (interactive) or import via the Vercel dashboard. Approval to deploy.
4. **OpenAI**: API key + model id (a Responses-API model with structured outputs).
5. **Production domain**: the `*.vercel.app` name or a custom domain (DNS access if custom).
6. **Email**: custom SMTP credentials (Resend/SendGrid/Postmark/SES…) + sender address — strongly recommended (see B2.5).
7. **First manager**: email + full name.

### B1. GitHub [USER]

```bash
gh auth status                                    # pick the account
gh repo create <owner>/<repo> --private --source=. --remote=origin --push
```
CI starts automatically (`.github/workflows/ci.yml`). Never commit `.env*` (only `.env.example` is tracked; `.gitignore` enforces it).

### B2. Supabase cloud [USER]

1. Create the project (dashboard → New project, or `npx supabase projects create <name> --org-id <org> --region <region> --db-password <pw>`). Save the DB password in a password manager.
2. Link + migrate from this folder:
   ```bash
   npx supabase login                                 # interactive (browser/token)
   npx supabase link --project-ref <project-ref>      # asks for the DB password
   npx supabase db push --dry-run                     # review: 8 migrations, no seed
   npx supabase db push                               # NEVER --include-seed (seed has known passwords)
   ```
   Check: Table editor shows `org_settings` (1 row: USD, America/New_York, 14), RLS enabled on every table; Database → Publications → `supabase_realtime` contains `prospects`.
3. **Authentication → Sign In / Providers**: *Allow new users to sign up* **OFF** (SPEC §4; admin invites still work); Email provider ON; *Confirm email* irrelevant (invites confirm). Anonymous sign-ins OFF. **Password**: minimum length **8** (matches the app's validation).
4. **Authentication → URL Configuration**: Site URL = `https://<vercel-domain>`; Redirect URLs = `https://<vercel-domain>/auth/confirm` (add `https://<vercel-domain>/**` only if needed; no wildcards for other hosts). Re-do this if the domain changes.
5. **Email (SMTP)**: the default Supabase sender is for testing only — it delivers **only to members of the Supabase org team** and is rate-limited to a few emails per hour, so rep invites/password resets to other addresses fail. Configure **Authentication → Emails → SMTP Settings** with a real provider (sender e.g. `crm@<domain>`), then raise **Rate Limits → emails per hour** as needed. Until then use `create-manager --link` for the first manager.
6. **Email templates** (Authentication → Emails → Templates). Cloud does **not** read `supabase/templates/*` automatically — paste them:
   - *Invite user*: subject `You have been invited to the AI Sales CRM`, body = `supabase/templates/invite.html`
   - *Reset password*: subject `Reset your AI Sales CRM password`, body = `supabase/templates/recovery.html`
   Both links must stay `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite|recovery` (the default `{{ .ConfirmationURL }}` templates would break the SSR `/auth/confirm` flow).
   Alternative: `npx supabase config diff` then `npx supabase config push` — it shows each changed resource and asks per change; **decline** `site_url`/redirect URLs (local values), rate limits (`email_sent = 100`, `max_frequency = 1s` are local-only) and accept only the templates. When unsure, use the dashboard.
7. API keys (Project Settings → API Keys): Project URL, `anon` (public) and `service_role` (secret) — the legacy JWT keys are what's tested locally; the new `sb_publishable_…` / `sb_secret_…` keys work the same way with supabase-js but re-run the smoke test if you use them.

### B3. Vercel [USER]

1. Import the GitHub repo (dashboard → Add New → Project; framework Next.js auto-detected; build `next build`, Node 22). Or `npx vercel link` + `npx vercel deploy --prod` after `npx vercel login`.
2. Environment variables (**Production** scope; Preview only if previews should hit the production database — safer: leave Preview without Supabase vars or point it to a separate project):

   | Variable | Value | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | public (inlined at build) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key | public; RLS protects data |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **server-only, Sensitive**, never `NEXT_PUBLIC_` |
   | `OPENAI_API_KEY` | `sk-…` | **server-only, Sensitive**, never `NEXT_PUBLIC_` |
   | `OPENAI_MODEL` | model id | server-only |
   | `NEXT_PUBLIC_SITE_URL` | `https://<vercel-domain>` | invite redirect base; no trailing slash |
   | `AI_FAKE` | — | **never set** in Vercel (ignored there anyway: `NODE_ENV=production`/`VERCEL_ENV` guard) |

   `NEXT_PUBLIC_*` are baked in at build time → redeploy after changing them.
3. Deploy; note the production domain; if it differs from what was configured in B2.4 / `NEXT_PUBLIC_SITE_URL`, fix both and redeploy.

### B4. First manager [USER]

Create a git-ignored `.env.production.local` with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` (prod values), then:
```bash
npm run create-manager -- --dotenv .env.production.local --email you@company.com --name "Your Name"
# no SMTP yet? print a one-time invite link instead of emailing:
npm run create-manager -- --dotenv .env.production.local --email you@company.com --name "Your Name" --link
```
Delete `.env.production.local` (or keep it only in a password manager) afterwards.

### B5. Production smoke test (checklist)

- [ ] `https://<domain>/` → redirects to `/login`; response headers include `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
- [ ] Sign-up is impossible: `POST https://<ref>.supabase.co/auth/v1/signup` with the anon key → "Signups not allowed".
- [ ] First manager: invite email (or `--link`) → `/auth/confirm` → `/set-password` → set password → dashboard shows "Admin/Manager"; `public.users.role = manager`.
- [ ] Settings → Organization: timezone/currency as desired (saved, persisted).
- [ ] Settings → Team → invite a rep (real inbox) → email arrives with the CRM subject → link opens `/set-password` on the production domain (not localhost) → rep logs in, sees no Settings.
- [ ] Forgot password for the rep → email → reset works.
- [ ] Rep creates a prospect → detail page → log a call → move stage (Demo Booked dialog) → follow-up appears on `/follow-ups` and the sidebar badge.
- [ ] Generate AI Insights → real insight within ~30 s, `ai_insights.model` = `OPENAI_MODEL`, timeline entry; Apply / Create follow-up work.
- [ ] Manager sees the rep's prospect, reassigns it; Pipeline drag works; Realtime: a second browser updates.
- [ ] Dashboard + Reports render with the real data; no console errors; Vercel function logs clean.
- [ ] View source / JS chunks: no `service_role` key, no `sk-` key.
- [ ] Delete smoke-test prospects (manager) if they shouldn't stay.

## Pitfalls

- Default Supabase SMTP only delivers to org team members + very low hourly limit → configure SMTP before inviting reps.
- Site URL / redirect URLs must match the production domain exactly or invite links point to localhost / get rejected.
- Templates must use `token_hash` links, or `/auth/confirm` returns `invalid_link`.
- Never run `db push --include-seed` or `db reset --linked` against production.
- Service-role key and OpenAI key: server-only env vars, never `NEXT_PUBLIC_`, never in git.
- `NEXT_PUBLIC_*` changes need a redeploy.

## Verification checklist ("Done when")

Part A (this session):
- [x] `scripts/create-manager.mts` + `npm run create-manager` tested against local Supabase (invite, idempotent re-run, promote existing, `--link`, error cases), test users cleaned up.
- [x] Security headers present (`curl -I` on `next start`); production build has no secrets in `.next/static`; AI fake inactive in `next start`.
- [x] `npm run db:reset` from scratch OK.
- [x] `.github/workflows/ci.yml` committed (runs on first push).
- [x] README complete (setup, env table, scripts, first manager, deploy, timezone/currency, AI key, tests).
- [x] `npm run verify`, `npm run test:db`, `npm run test:integration`, `PLAYWRIGHT_CHANNEL=chrome npm run e2e` pass; committed locally; BUILD_PROGRESS updated.

Part B (after the user's go-ahead): B1–B5 complete; the production URL passes the smoke test.
