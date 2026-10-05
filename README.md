# AI Sales CRM

Internal, AI-assisted sales CRM for sales reps and managers. `SPEC.md` is the source of truth; `CLAUDE.md` holds the working conventions.

## Requirements

- Node.js 22+ and npm
- Docker Desktop (local Supabase runs in Docker)

## Setup

```bash
npm install
npx supabase start          # starts local Supabase (Postgres, Auth, Studio, Mailpit)
npx supabase status         # copy API URL, anon key and service role key
cp .env.example .env.local  # then fill in the values
npm run db:reset            # apply migrations + seed
npm run dev                 # http://localhost:3000
```

Local Supabase: API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`, Mailpit (auth emails) `http://127.0.0.1:54324`.

### Dev credentials (local seed only)

`npm run db:reset` seeds these users (`supabase/seed.sql`). Local development only; never use them anywhere else.

| Role | Email | Password |
|---|---|---|
| Manager | `morgan.manager@example.com` | `Password123!` |
| Sales rep | `riley.rep@example.com` | `Password123!` |
| Sales rep | `sam.rep@example.com` | `Password123!` |

### Demo data (local seed)

`npm run db:reset` also loads a realistic demo team from `supabase/seed.sql`: **40 prospects** (Riley 21, Sam 19) across all 9 stages, ~140 timeline activities over the past 60 days, stale deals, follow-ups (overdue / due today / upcoming / later / completed), booked and attended demos, closed won/lost deals with reasons, a skip, backward moves, a lost → reopened → won deal, one manager reassignment and 8 AI insights. All dates are relative to "now" in the org timezone, so the data stays fresh — re-run `npm run db:reset` when it has aged (e.g. the next day; the integration tests assume a fresh seed). The seed ends with a consistency check (stage history ⇔ current stage, derived follow-up/last-activity dates, close fields, matching activities) and fails the reset if anything is off.

Auth emails (invites, password resets) are not sent for real locally: open Mailpit at http://127.0.0.1:54324. After changing `supabase/config.toml` or `supabase/templates/*`, restart with `npx supabase stop && npx supabase start`.

Public sign-up is disabled (`supabase/config.toml` → `[auth] enable_signup = false`); users are invited by a manager.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests (`src/**/*.test.ts(x)`) |
| `npm run test:integration` | Data-layer tests against local Supabase with RLS (`tests/integration/`; needs the stack + seed; not part of `verify`) |
| `npm run e2e` | Playwright tests in `e2e/` (needs local Supabase + seed; run `npx playwright install chromium` once, or set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome) |
| `npm run db:reset` | Recreate the local database from migrations + seed |
| `npm run db:types` | Regenerate `src/lib/supabase/database.types.ts` from the local DB |
| `npm run verify` | typecheck → lint → test → build (must pass after every task) |

## Tests

| Command | Needs | Covers |
|---|---|---|
| `npm run test` (part of `verify`) | nothing | Unit tests (Vitest) |
| `npm run test:db` | local Supabase | pgTAP: schema, triggers, RLS, metric SQL (`supabase/tests/`) |
| `npm run test:integration` | local Supabase + fresh seed, `psql` on PATH | Data layer through RLS as the seed users; some expectations are the seed's documented numbers |
| `PLAYWRIGHT_CHANNEL=chrome npm run e2e` | local Supabase + seed | End-to-end (Playwright, 35 tests) incl. the full rep journey (`e2e/journey.spec.ts`) |

E2E notes: Playwright starts `npm run dev` with `AI_FAKE=1` (deterministic fake AI client, never used in production); if you reuse a running dev server, start it with `AI_FAKE=1 npm run dev`. Specs run serially against the shared local database, create their own `e2e-*` records and delete them afterwards, and restore any org setting they change. Without `PLAYWRIGHT_CHANNEL=chrome`, run `npx playwright install chromium` once.
