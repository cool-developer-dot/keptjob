# Prompt 0 (enhanced): Project bootstrap + CLAUDE.md

Source: `BUILD_PROMPTS.md` → "Prompt 0: Project bootstrap + CLAUDE.md". `SPEC.md` is the source of truth; if this plan conflicts with it, SPEC.md wins. Nothing from SPEC §14 (out of scope) may be added.

Goal: a clean, empty Next.js app in `/Users/mac/Downloads/sales` with every dependency, folder, config file and convention later prompts rely on, where `npm run verify` passes.

---

## 0. Preconditions / pitfalls

- The folder is **not empty**: it holds `SPEC.md`, `BUILD_PROMPTS.md`, `BUILD_PROGRESS.md`, `prompts/`. `create-next-app` refuses non-empty dirs → scaffold into a temp dir (scratchpad) and copy the files in. Never overwrite or delete those four entries.
- Use **latest stable** versions (at time of writing: Next 16.x, React 19, Tailwind v4, ESLint 9 flat config, shadcn CLI 4.x, Vitest 5, Supabase CLI 2.x). Pin the `create-next-app` version to the current `next` version.
- Next 16: `next lint` no longer exists → `lint` script is plain `eslint`. `next build` no longer runs lint, so `verify` must run lint explicitly (it does). Next 16 renames root `middleware.ts` to `proxy.ts` — that root file is Prompt 3's job; Prompt 0 only creates the helper `src/lib/supabase/middleware.ts` (name fixed by the prompt).
- `create-next-app` must run non-interactively: pass every flag + `--yes`, `--disable-git` (we run `git init` ourselves in the final folder), `--skip-install` (install once in the real folder).
- The scaffold creates `AGENTS.md` (Next.js agent rules) and a one-line `CLAUDE.md` (`@AGENTS.md`). `next dev` re-creates/updates the managed block in `AGENTS.md` on every run, so **keep `AGENTS.md`** (committed) and write our own `CLAUDE.md` that ends with `@AGENTS.md`.
- `create-next-app` scaffolds `@types/node@^20`, which conflicts with Vitest 5's peer range (`^22 || >=24`) → install `@types/node@^22` (matches Node 22).
- The scaffold's root layout types props as `LayoutProps<"/">`, a global generated into `.next/types` → `tsc --noEmit` fails on a fresh clone. Use `Readonly<{ children: React.ReactNode }>` instead.
- Name the Vitest config `vitest.config.mts` (the package is CommonJS; a `.ts` ESM config triggers a Vite warning).
- shadcn: init non-interactively (`--yes`, explicit `-t next -b radix -p nova`; without `-p` the CLI prompts for a preset even with `--yes`). shadcn 4.x uses its own `cn` package (`src/lib/utils.ts` re-exports it) and the `radix-ui` umbrella package; set the Geist font variable to `--font-sans` (globals.css maps `--font-sans`). Newer shadcn registries may not ship `form` (replaced by `field`). If `npx shadcn add form` fails or produces nothing, write `src/components/ui/form.tsx` manually (the canonical shadcn react-hook-form wrapper: `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`, `useFormField`) using `Slot` from `radix-ui` + `@/components/ui/label`.
- `npx supabase init` must not prompt: run it with stdin closed / non-TTY (or `--force` if a config exists). Supabase CLI is a **devDependency** (`supabase`), always used via `npx supabase` / npm scripts; nothing installed globally.
- Vitest must pass with the app essentially empty → add one real test (`src/lib/constants.test.ts`) that asserts the constants match SPEC.md. Also set `passWithNoTests: true` as a safety net. Vitest must **not** pick up Playwright specs in `e2e/`.
- `tsc --noEmit` must pass on a fresh clone before any build: do not rely on generated `.next/types` existing.
- ESLint must ignore generated/vendored output: `.next/`, `node_modules/`, `supabase/` (non-TS), `playwright-report/`, `test-results/`, `src/lib/supabase/database.types.ts` (generated), `next-env.d.ts`.
- Never commit `.env*` files except `.env.example`.

## 1. Scaffold Next.js

1. In scratchpad: `npx create-next-app@<latest> app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-react-compiler --disable-git --skip-install --yes` (adjust flags to the CLI's help output).
2. Copy everything (including dotfiles) from the temp `app/` into `/Users/mac/Downloads/sales`, skipping anything that would overwrite SPEC.md / BUILD_PROMPTS.md / BUILD_PROGRESS.md / prompts/.
3. Set `package.json` `"name": "ai-sales-crm"`, `"private": true`.
4. `tsconfig.json`: confirm `"strict": true` and paths `@/*` → `./src/*`; otherwise keep scaffold defaults.
5. Replace the default landing page with a minimal placeholder (`src/app/page.tsx` showing "AI Sales CRM"), set `metadata.title = "AI Sales CRM"` in `src/app/layout.tsx`, remove unused default SVGs in `public/`.

## 2. Dependencies

- Runtime: `@supabase/supabase-js @supabase/ssr zod react-hook-form @hookform/resolvers recharts @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities date-fns @date-fns/tz openai server-only`
- Dev: `vitest @vitejs/plugin-react @testing-library/react jsdom @playwright/test supabase` (+ `@testing-library/dom` peer, `vite-tsconfig-paths` not required — use `resolve.alias` in vitest config).
- Do **not** run `npx playwright install` browsers globally now (not needed for verify; Prompt 14 does that). Note it in CLAUDE.md.

## 3. shadcn/ui

1. `npx shadcn@latest init` (radix base, Next template, CSS variables, non-interactive) → creates `components.json`, `src/lib/utils.ts` (`cn`), theme tokens in `src/app/globals.css`.
2. `npx shadcn@latest add -y button input label card dialog alert-dialog dropdown-menu select table tabs badge textarea calendar popover sonner form sheet skeleton avatar separator checkbox command tooltip`
3. Verify all 23 files exist in `src/components/ui/`: button, input, label, card, dialog, alert-dialog, dropdown-menu, select, table, tabs, badge, textarea, calendar, popover, sonner, form, sheet, skeleton, avatar, separator, checkbox, command, tooltip. Write `form.tsx` manually if missing (see pitfalls).
4. Mount `<Toaster />` (from `@/components/ui/sonner`) in the root layout so later prompts can toast. `sonner.tsx` uses `next-themes`; make sure it is installed (shadcn adds it).

## 4. Supabase

1. `npx supabase init` (non-interactive) → `supabase/config.toml`.
2. In the `[auth]` section set `enable_signup = false` (SPEC §4: no public sign-up; users only arrive via manager invites). Leave `[auth.email]` defaults (email + password login) unchanged so login, invites and password recovery keep working.
3. Set `[auth] site_url = "http://localhost:3000"` and add `http://localhost:3000/**` + `http://127.0.0.1:3000/**` to `additional_redirect_urls` (needed later for `/auth/confirm` invites and recovery; harmless now).
4. Create `supabase/migrations/.gitkeep` and `supabase/tests/.gitkeep` (`supabase init` may not create them).
5. Confirm `npx supabase --version` works.

## 5. Folders and files

| Path | Content |
|---|---|
| `src/app/` | from scaffold |
| `src/components/` | `ui/` from shadcn |
| `src/lib/supabase/client.ts` | `createClient()` → `createBrowserClient<Database>(URL, ANON)` |
| `src/lib/supabase/server.ts` | `import "server-only"`; `async createClient()` → `createServerClient<Database>` with `await cookies()`, `getAll`/`setAll` (try/catch in setAll for Server Components) |
| `src/lib/supabase/admin.ts` | `import "server-only"`; `createAdminClient()` → `createClient<Database>(URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })`; doc comment: only for manager-verified admin actions (invites) |
| `src/lib/supabase/middleware.ts` | `updateSession(request: NextRequest)` using `createServerClient` + `supabase.auth.getUser()`; returns `{ response, user }` so Prompt 3's root `proxy.ts`/`middleware.ts` can redirect. No redirects yet. |
| `src/lib/supabase/env.ts` | small helper reading/validating the public env vars with a clear error (`getSupabaseEnv()`), so clients fail loudly when `.env.local` is missing — evaluated lazily, never at import/build time |
| `src/lib/supabase/database.types.ts` | placeholder `Database` type in the shape `supabase gen types` produces (empty `public` schema); overwritten by `npm run db:types` in Prompt 1 |
| `src/lib/validation/` | `.gitkeep` (schemas come in Prompt 5) |
| `src/lib/constants.ts` | see §6 |
| `src/lib/constants.test.ts` | asserts every constant matches SPEC exactly (values, order, labels) |
| `src/lib/time.ts` | placeholder module with a header comment: org-timezone helpers are implemented in Prompt 4; all date/time logic must go through this file. Exports nothing functional yet (`export {}`) — no hardcoded timezone. |
| `src/lib/ai/` | `.gitkeep` |
| `src/server/actions/` | `.gitkeep` + `src/server/actions/types.ts` exporting `ActionResult<T> = { ok: true; data: T } \| { ok: false; error: string }` (the convention) |
| `supabase/migrations/`, `supabase/tests/` | `.gitkeep` |
| `e2e/` | `.gitkeep`; `playwright.config.ts` at root (`testDir: "e2e"`, baseURL `http://localhost:3000`, `webServer: npm run dev`) |
| `vitest.config.mts` | `@vitejs/plugin-react`, `environment: "jsdom"`, `include: ["src/**/*.test.{ts,tsx}"]`, `exclude e2e`, alias `@` → `src`, `passWithNoTests: true` |
| `.env.example` | the six variables (§7) |
| `README.md` | short: requirements (Node, Docker), setup steps, scripts table; replaces the scaffold README |

## 6. `src/lib/constants.ts` (exact SPEC values)

All lists are `as const` tuples of values plus a label map, with derived TS types:

- `PIPELINE_STAGES` (order matters, SPEC §2): `prospect, contacted, conversation, qualified, demo_booked, demo_attended, follow_up, closed_won, closed_lost`; labels: Prospect, Contacted, Conversation, Qualified, Demo Booked, Demo Attended, Follow-up, Closed Won, Closed Lost. Plus `CLOSED_STAGES = [closed_won, closed_lost]`, `OPEN_STAGES`, `isClosedStage()`.
- `OBJECTION_CATEGORIES` (§3): price, timing, competitor, budget, no_authority, not_interested, other → Price, Timing, Competitor, Budget, No authority, Not interested, Other.
- `WON_REASONS` (§3): product_fit, price_value, relationship, urgent_need, other → Product fit, Price/value, Relationship, Urgent need, Other.
- `LOST_REASONS` (§3): price, timing, competitor, no_budget, no_response, not_a_fit, other → Price, Timing, Competitor, No budget, No response, Not a fit, Other.
- `ACTIVITY_TYPES` (§7): call, conversation, note, demo, follow_up, stage_change, owner_change, ai_insight; `LAST_ACTIVITY_TYPES` (human sales activity: call, conversation, note, demo, follow_up, stage_change).
- `ROLES` (§4): manager → "Admin/Manager", sales_rep → "Sales Rep".
- `ALLOWED_TIMEZONES` (§5): America/New_York, America/Chicago, America/Denver, America/Phoenix, America/Los_Angeles, America/Anchorage, Pacific/Honolulu (with human labels).
- Also from SPEC (needed by later prompts, still exact): `DECISION_MAKER_STATUSES` yes/no/unknown, `FOLLOW_UP_STATUSES` pending/completed, `DEAL_HEALTH` high/medium/low.
- No hardcoded org timezone/currency defaults (SPEC §5/§6: those live in the DB settings default).

## 7. `.env.example`

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```
With comments: local values come from `npx supabase status`; the service role key is server-only.

## 8. `package.json` scripts (exact)

```
"dev": "next dev",
"build": "next build",
"start": "next start",
"lint": "eslint",
"typecheck": "tsc --noEmit",
"test": "vitest run",
"e2e": "playwright test",
"db:reset": "supabase db reset",
"db:types": "supabase gen types typescript --local > src/lib/supabase/database.types.ts",
"verify": "npm run typecheck && npm run lint && npm run test && npm run build"
```
(`supabase` resolves to the local devDependency binary inside npm scripts.)

## 9. git

- `.gitignore`: scaffold defaults + `.env*` with `!.env.example`, `/playwright-report`, `/test-results`, `/blob-report`, `/playwright/.cache`, `supabase/.branches`, `supabase/.temp`, `.DS_Store`.
- `git init` in `/Users/mac/Downloads/sales` (branch `main`).

## 10. CLAUDE.md

Must contain:
1. Short project summary (internal AI-assisted sales CRM; reps + managers; the 6 "always know" goals).
2. "SPEC.md is the source of truth, read the relevant section before every task."
3. The out-of-scope list (SPEC §14) verbatim in meaning.
4. Conventions (all six from the prompt, verbatim in meaning):
   - mutations go through server actions in `src/server/actions` and return `{ ok: true, data } | { ok: false, error }`
   - Zod validates every input, on the client and again on the server
   - RLS is the security boundary; user-facing code uses the user-scoped Supabase client; the service-role client (`src/lib/supabase/admin.ts`) is only for manager-verified admin actions (invites)
   - all dates/times go through `src/lib/time.ts` using the org timezone; store UTC
   - AI never writes prospect fields without a user click
   - after every task run `npm run verify` and fix everything until it passes
5. Stack, scripts, folder map, enum source (`src/lib/constants.ts`), local Supabase notes, Next 16 notes (proxy.ts, eslint).
6. "Build process": prompts are executed in order from `BUILD_PROMPTS.md`, enhanced versions live in `prompts/enhanced/`, progress in `BUILD_PROGRESS.md`.

## 11. Edge cases

- Missing env vars must not break `npm run build` (no top-level env reads in modules imported by pages; Supabase clients read env lazily inside functions).
- `admin.ts` and `server.ts` import `server-only` so they can never be bundled client-side.
- The placeholder `Database` type must satisfy `@supabase/supabase-js` generics so the typed clients compile.
- Lint must not fail on `.gitkeep`-only folders or on shadcn-generated files (fix rule violations rather than disabling lint globally).

## 12. Verification checklist (mirrors "Done when")

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes with zero errors
- [ ] `npm run test` passes (constants test runs and passes)
- [ ] `npm run build` passes
- [ ] → `npm run verify` passes on the empty app
- [ ] `npx supabase --version` prints a version; `supabase/config.toml` has `[auth] enable_signup = false`
- [ ] all 23 shadcn components exist in `src/components/ui/`
- [ ] all listed folders/files exist; `.env.example` has the 6 vars
- [ ] `git status` shows no `.env*` file other than `.env.example` staged
- [ ] CLAUDE.md contains every required item + Build process note
- [ ] commit created; `BUILD_PROGRESS.md` row 0 updated
