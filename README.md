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
| `npm run e2e` | Playwright tests in `e2e/` (needs local Supabase + seed; run `npx playwright install chromium` once, or set `PLAYWRIGHT_CHANNEL=chrome` to use installed Chrome) |
| `npm run db:reset` | Recreate the local database from migrations + seed |
| `npm run db:types` | Regenerate `src/lib/supabase/database.types.ts` from the local DB |
| `npm run verify` | typecheck → lint → test → build (must pass after every task) |
