# AI Sales CRM — project guide for Claude

## Project summary

A simple, AI-assisted sales CRM for an **internal** sales team. Only sales reps (`sales_rep`) and managers (`manager`) use it; leads/customers have no access. The salesperson should always know: who to contact, what happened in the last conversation, the main objection, the next follow-up, what the AI recommends next, and which deals need attention.

Core pieces: a flexible pipeline (forward/backward/skip, every change in `stage_history`), prospects with objections and close reasons, an activity timeline, follow-ups (due today/overdue in the org timezone), rule-based workflow prompts (never automatic), manual AI insights (OpenAI Responses API, structured output), dashboard, Kanban, reports, and a minimal manager-only Settings page (org settings + team invites).

## Source of truth

**SPEC.md is the source of truth. Read the relevant section before every task.** If a prompt, this file or existing code conflicts with SPEC.md, SPEC.md wins.

## Out of scope for V1 (do NOT add)

Customer portal · invoicing · payments · inventory · support ticketing · marketing automation · WhatsApp automation · complex email automation (only Supabase auth emails exist) · multiple AI agents · large admin systems · automatic messages/emails · automatic stage changes · multi-currency conversion.

## Conventions

- **Mutations** go through server actions in `src/server/actions` and return `{ ok: true, data } | { ok: false, error }` (type `ActionResult<T>` in `src/server/actions/types.ts`). Expected failures are returned, not thrown.
- **Zod validates every input**, on the client (react-hook-form + `@hookform/resolvers/zod`) and again on the server inside the action. Schemas live in `src/lib/validation/`.
- **RLS is the security boundary.** User-facing code uses the user-scoped Supabase client (`src/lib/supabase/server.ts` on the server, `src/lib/supabase/client.ts` in the browser). The service-role client (`src/lib/supabase/admin.ts`, `server-only`) is **only** for manager-verified admin actions (invites); call `requireManager()` first.
- **All dates/times go through `src/lib/time.ts`** using the org timezone from `org_settings`; store UTC (`timestamptz`). Never hardcode a timezone or currency outside the settings default.
- **AI never writes prospect fields without a user click** ("Apply", "Create follow-up from next step"). No automatic AI calls.
- **After every task run `npm run verify`** (typecheck → lint → test → build) and fix everything until it passes.

More rules:
- Enum values and labels come from `src/lib/constants.ts` (exact SPEC values: stages and their order, objection categories, won/lost reasons, activity types, roles, allowed US timezones, decision-maker status, follow-up status, deal health). Don't redeclare them elsewhere.
- The role comes from `raw_app_meta_data` / `public.users.role`, never from user-editable metadata.
- Activities, stage history and AI insights are append-only. Only managers delete prospects.
- Never send messages/emails or change stages automatically; workflow rules only prompt the user.
- Keep UI on shadcn/ui components (`src/components/ui/`); add new ones with `npx shadcn@latest add <name>`. Note: `form.tsx` was written by hand (the current registry no longer ships it for this style).

## Stack

TypeScript (strict) · Next.js 16 App Router (`src/`) + React 19 · Tailwind CSS v4 · shadcn/ui (radix) · server actions / route handlers · Supabase (Postgres, Auth, RLS, Realtime) via `@supabase/ssr` · Zod v4 · react-hook-form · Recharts · @dnd-kit · date-fns + @date-fns/tz · OpenAI Responses API (`OPENAI_MODEL` env) · Vitest · Playwright · Vercel · GitHub.

Next.js 16 notes: the root middleware file is `src/proxy.ts` (renamed from `middleware.ts`); it should call `updateSession()` from `src/lib/supabase/middleware.ts`. `next lint` no longer exists (`npm run lint` runs `eslint`), and `next build` does not lint. When unsure about a Next API, read `node_modules/next/dist/docs/` (see `AGENTS.md`).

## Layout

```
src/app/                    routes (App Router)
src/components/ui/          shadcn/ui components
src/components/             app components
src/lib/constants.ts        SPEC enums + labels
src/lib/time.ts             org-timezone date helpers (Prompt 4)
src/lib/validation/         Zod schemas
src/lib/ai/                 OpenAI insight generation
src/lib/supabase/           client.ts, server.ts, admin.ts (service role), middleware.ts (updateSession), database.types.ts (generated)
src/server/actions/         server actions (ActionResult)
supabase/config.toml        local Supabase config ([auth] enable_signup = false)
supabase/migrations/        SQL migrations
supabase/tests/             database tests
e2e/                        Playwright tests
```

## Commands

- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm run test` · `npm run e2e`
- `npx supabase start|stop|status` (Docker) · `npm run db:reset` · `npm run db:types` (regenerates `src/lib/supabase/database.types.ts`)
- `npm run verify` = typecheck && lint && test && build
- Supabase CLI is a devDependency; always use `npx supabase` / npm scripts, never a global install.
- Vitest runs `src/**/*.test.{ts,tsx}` (jsdom; `server-only` is stubbed). Playwright browsers: `npx playwright install chromium` before the first `npm run e2e`.
- Env: copy `.env.example` → `.env.local` (values from `npx supabase status`). Never commit `.env*` files except `.env.example`.

## Build process

The app is built by executing the prompts in `BUILD_PROMPTS.md` **in order**, one per session. Each prompt is first rewritten into an enhanced, checkable execution plan saved in `prompts/enhanced/NN-<name>.md`, then executed and verified (`npm run verify` + the prompt's "Done when"). Progress, verification results, commits and deferred blockers are tracked in `BUILD_PROGRESS.md`.

@AGENTS.md
