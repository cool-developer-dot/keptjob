# AI Sales CRM

Internal, AI-assisted sales CRM for a sales team: **sales reps** manage their own prospects, **managers** see the whole team. Customers/leads have no access. `SPEC.md` is the source of truth for product behaviour; `CLAUDE.md` holds the working conventions.

The salesperson always knows who to contact, what happened in the last conversation, the main objection, the next follow-up, what the AI recommends next and which deals need attention.

**Features:** flexible pipeline (forward / backward / skip, every move in `stage_history`) with a Kanban board (drag & drop, keyboard, Realtime) · prospects list with filters/search · prospect detail with activity timeline · follow-ups (overdue / today / upcoming / completed, in the org timezone) · rule-based workflow prompts (demo booked/attended, close reason required — never automatic) · manual AI insights (OpenAI Responses API, structured output, "Apply" only on click) · dashboard · reports (funnel, conversion, win rate, pipeline value per currency) · manager-only settings (org timezone/currency/stale days, team invites and roles). No public sign-up: users are invited.

**Stack:** Next.js 16 (App Router) + React 19 + TypeScript · Tailwind CSS v4 + shadcn/ui · Supabase (Postgres, Auth, RLS, Realtime) via `@supabase/ssr` · Zod · react-hook-form · Recharts · @dnd-kit · date-fns + @date-fns/tz · OpenAI Responses API · Vitest · Playwright · Vercel · GitHub Actions.

## Requirements

- Node.js 22+ and npm
- Docker Desktop (local Supabase runs in Docker)
- `psql` on the PATH for `npm run test:integration` (or set `SUPABASE_DB_URL`)

The Supabase CLI is a devDependency — always use `npx supabase …` / the npm scripts, never a global install.

## Local setup

```bash
npm install
npx supabase start          # starts local Supabase (Postgres, Auth, Realtime, Studio, Mailpit)
npx supabase status         # shows API URL, anon key and service role key
cp .env.example .env.local  # then fill in the values from `supabase status`
npm run db:reset            # apply migrations + seed
npm run dev                 # http://localhost:3000
```

Local Supabase: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`, Mailpit (auth emails) `http://127.0.0.1:54324`.

### Dev credentials (local seed only)

`npm run db:reset` seeds these users (`supabase/seed.sql`). Local development only — the seed is never pushed to production.

| Role | Email | Password |
|---|---|---|
| Manager | `morgan.manager@example.com` | `Password123!` |
| Sales rep | `riley.rep@example.com` | `Password123!` |
| Sales rep | `sam.rep@example.com` | `Password123!` |

### Demo data (local seed)

`npm run db:reset` also loads a realistic demo team: **40 prospects** (Riley 21, Sam 19) across all 9 stages, ~260 timeline activities over the past 60 days, stale deals, follow-ups (overdue / due today / upcoming / later / completed), booked and attended demos, closed won/lost deals with reasons, a skip, backward moves, a lost → reopened → won deal, one manager reassignment and 8 AI insights. All dates are relative to "now" in the org timezone, so the data stays fresh — re-run `npm run db:reset` when it has aged (e.g. the next day; the integration tests assume a fresh seed). The seed ends with a consistency check and fails the reset if anything is off.

Auth emails (invites, password resets) are not sent for real locally: open Mailpit at http://127.0.0.1:54324. After changing `supabase/config.toml` or `supabase/templates/*`, restart with `npx supabase stop && npx supabase start`.

Public sign-up is disabled (`supabase/config.toml` → `[auth] enable_signup = false`); users are invited by a manager (Settings → Team).

## Environment variables

`.env.example` documents every variable. Locally they live in `.env.local` (git-ignored); in production they are set in Vercel.

| Variable | Where | Secret? | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | no | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | no (RLS protects data) | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | **yes** — bypasses RLS | Manager-verified invites (`src/lib/supabase/admin.ts`), `create-manager` script |
| `OPENAI_API_KEY` | **server only** | **yes** | AI insights |
| `OPENAI_MODEL` | server only | no | OpenAI model id (Responses API + structured outputs); never hardcoded |
| `NEXT_PUBLIC_SITE_URL` | browser + server | no | Public base URL for auth email redirects (`https://<domain>`, no trailing slash) |
| `AI_FAKE` | local dev/tests only | — | `1` = deterministic fake AI client; **ignored** in production builds and on Vercel; never set it there |

Never prefix a secret with `NEXT_PUBLIC_` (those values are inlined into the browser bundle). `NEXT_PUBLIC_*` values are baked in at build time, and on Vercel any env var change only applies to new deployments — redeploy after changing them.

### AI key setup

1. Create an API key in the OpenAI dashboard and pick a model that supports the Responses API with structured outputs (`json_schema`).
2. Set `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env.local` (and in Vercel for production); make sure `AI_FAKE` is not set; restart `npm run dev`.
3. Open a prospect → **Generate AI Insights**. Without both variables the button answers "AI is not configured"; a wrong key shows "API key was rejected", a wrong model "model not found". Calls are manual only and rate-limited (10 per user per 10 minutes).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm run start` | Production build / serve it |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests (`src/**/*.test.ts(x)`) |
| `npm run test:db` | pgTAP database tests (`supabase/tests/`; needs local Supabase) |
| `npm run test:integration` | Data-layer tests against local Supabase with RLS (`tests/integration/`; needs the stack + fresh seed + `psql`) |
| `npm run e2e` | Playwright tests in `e2e/` (needs local Supabase + seed) |
| `npm run db:reset` | Recreate the local database from migrations + seed |
| `npm run db:types` | Regenerate `src/lib/supabase/database.types.ts` from the local DB |
| `npm run create-manager -- …` | Create or promote a manager (see below) |
| `npm run create-user -- --role sales_rep …` | Same script for any role (sets role + missing name on existing users) |
| `npm run demo-data -- --dotenv <file> [--clear]` | Load / remove 6 small demo prospects in a cloud project |
| `npm run db:setup-sql` | Regenerate `supabase/setup/production-setup.sql` (first-time cloud DB setup via SQL Editor) |
| `npm run start:cloud` | Build + run locally on :3001 against `.env.production.local` (cloud project) |
| `npm run verify` | typecheck → lint → test → build (must pass after every change) |

## Tests

| Command | Needs | Covers |
|---|---|---|
| `npm run test` (part of `verify`) | nothing | Unit tests (Vitest) |
| `npm run test:db` | local Supabase | pgTAP: schema, triggers, RLS, metric SQL |
| `npm run test:integration` | local Supabase + fresh seed, `psql` | Data layer through RLS as the seed users; some expectations are the seed's documented numbers |
| `PLAYWRIGHT_CHANNEL=chrome npm run e2e` | local Supabase + seed | End-to-end (Playwright, 35 tests) incl. the full rep journey (`e2e/journey.spec.ts`) |

Full regression: `npm run verify && npm run test:db && npm run test:integration && PLAYWRIGHT_CHANNEL=chrome npm run e2e` (run `npm run db:reset` first if the seed is from an earlier day).

E2E notes: Playwright starts `npm run dev` with `AI_FAKE=1`; if you reuse a running dev server, start it with `AI_FAKE=1 npm run dev`. Specs run serially against the shared local database, create their own `e2e-*` records and delete them afterwards, and restore any org setting they change. Without `PLAYWRIGHT_CHANNEL=chrome`, run `npx playwright install chromium` once.

CI (`.github/workflows/ci.yml`, no secrets): `verify` on every push/PR, then a job that starts local Supabase in Docker and runs `test:db`, `test:integration` and `e2e`.

## Creating a manager (first manager in production)

Production has no seed users and sign-up is off, so the first manager is created with `scripts/create-manager.mts` (Node 22 runs it directly; it uses the service role key and never handles a password):

```bash
# .env.production.local (git-ignored): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL (production values)
npm run create-manager -- --dotenv .env.production.local --email you@company.com --name "Your Name"
```

- Default: sends the Supabase **invite email**; the link opens `/set-password` and the person chooses their own password.
- `--link`: prints a **one-time invite link** instead of emailing (use it before SMTP is configured — the default Supabase sender only delivers to members of your Supabase org). Single use, expires; share it privately.
- **Idempotent:** an existing user is promoted to manager (`app_metadata.role`), already-managers are left alone; passwords are never changed (use "Forgot password").
- For a non-local project it asks for confirmation (`--yes` skips it). Env can also come from the shell (`SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` or `SITE_URL`). `--help` lists all options.

After that, the manager invites everyone else from **Settings → Team**. Delete `.env.production.local` when done.

## Deploying

Full runbook with every command, setting and the production smoke test: [`prompts/enhanced/15-deploy.md`](prompts/enhanced/15-deploy.md) (Part B). In short:

1. **GitHub:** `gh repo create <owner>/<repo> --private --source=. --remote=origin --push`.
2. **Supabase cloud:** create a project, then create the database, either way (migrations only; **never** the seed):
   - **No CLI:** Dashboard → **SQL Editor** → paste all of [`supabase/setup/production-setup.sql`](supabase/setup/production-setup.sql) → **Run**. One transaction, refuses to run twice, and records the migrations so `supabase db push` works for later ones. Regenerate it with `npm run db:setup-sql` after adding migrations (first-time setup only).
   - **CLI:** `npx supabase login` → `npx supabase link --project-ref <ref>` → `npx supabase db push`.
   - Authentication → Sign In / Providers: **disable "Allow new users to sign up"**; password minimum length 8.
   - Authentication → URL Configuration: Site URL `https://<domain>`; Redirect URLs `https://<domain>/auth/confirm`.
   - Authentication → Emails → Templates: paste `supabase/templates/invite.html` (Invite user) and `recovery.html` (Reset password) — cloud doesn't read these files; the links must stay `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=…`. (`npx supabase config push` can push them, but it also offers local-only values like `site_url` and rate limits — decline those.)
   - Authentication → Emails → SMTP: configure a real provider before inviting reps (the default sender is test-only and limited to a few emails/hour).
3. **Vercel:** import the GitHub repo (Next.js auto-detected; no `vercel.json` needed); set the environment variables from the table above for Production (`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` as Sensitive; no `AI_FAKE`); deploy.
4. **Users:** `npm run create-manager` against production (above), or Dashboard → Authentication → **Add user** (email + password, *Auto Confirm*) and then set role + name: `npm run create-user -- --dotenv .env.production.local --role manager|sales_rep --email … --name "…" --yes` (for an existing user it only sets the role and a missing name).
   Optional demo data for the first two reps: `npm run demo-data -- --dotenv .env.production.local --yes` (remove with `--clear`).
5. **Smoke test:** first manager logs in → invites a rep → rep sets their password → creates a prospect → generates an AI insight (checklist in the runbook).

Security headers (`X-Frame-Options`, `frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS) are set in `next.config.ts`.

## Changing the org timezone / currency

Managers: **Settings → Organization**.

- **Timezone** (one of the allowed US timezones) decides "today" for follow-ups (due today / overdue), the dashboard date, report periods, activity times and demo date/time entry. Stored timestamps are UTC, so changing it re-buckets follow-ups immediately; nothing is rewritten.
- **Default currency** (ISO 4217) applies to **new** prospects. Existing prospects keep their currency; amounts are never converted — pipeline value and won value are shown per currency.
- **Stale days** (default 14) controls the "stale" warning for open deals without activity.

The database defaults (`USD`, `America/New_York`, `14`) come from the first migration; a fresh production project starts with them.

## Troubleshooting

- **Invite / reset email never arrives (production):** default Supabase SMTP only sends to org team members and has a tiny hourly limit → configure SMTP; meanwhile `create-manager --link`.
- **Invite link points to localhost or fails with `invalid_link`:** Site URL / redirect URLs / templates in Supabase Auth don't match the production domain, or the link was already used/expired (send a new invite).
- **"AI is not configured":** `OPENAI_API_KEY` / `OPENAI_MODEL` missing in that environment. On Vercel, env var changes only apply to new deployments → redeploy.
- **Local integration tests fail on seed numbers:** the seed is relative to the day it ran — `npm run db:reset`.
