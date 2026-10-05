# Build Progress

Tracks each BUILD_PROMPTS.md prompt: status, verification result, commit, and any blockers deferred to the end.

| # | Prompt | Status | Notes |
|---|--------|--------|-------|
| 0 | Project bootstrap + CLAUDE.md | done | `npm run verify` passes (typecheck, lint, 8 vitest tests, build). Next 16.3.8, shadcn radix-nova (23 components; `form.tsx` hand-written, registry no longer ships it), Supabase CLI 2.119.0 (devDep), `[auth] enable_signup = false`. Plan: prompts/enhanced/00-bootstrap.md |
| 1 | Database schema + triggers | done | 2 migrations apply cleanly (`npm run db:reset`); pgTAP `npm run test:db` 113/113 pass (needs local Supabase; not in verify); `npm run verify` passes (18 vitest incl. SQL↔constants drift test). Extras for later prompts: `is_manager()` defined here, `move_prospect_stage` RPC (stage note), `prospects_with_flags` view, auth⇄public role sync. Plan: prompts/enhanced/01-schema.md |
| 2 | Row Level Security | done | Migration `20261006120000_rls.sql`: RLS on all 7 tables, `can_access_prospect()`, role/name guard trigger on users, tight grants (anon nothing; column-level insert/update for authenticated; append-only tables have no update/delete), prospects in `supabase_realtime`. pgTAP `npm run test:db` 207/207 (113 schema unchanged + 94 RLS with M/A/B); REST smoke test via GoTrue/PostgREST OK; `npm run verify` passes. Plan: prompts/enhanced/02-rls.md |
| 3 | Auth + app shell | done | Login/forgot/set-password, `/auth/confirm` (invite+recovery token_hash), `src/proxy.ts` guards (+ `safeNextPath` open-redirect guard), `getCurrentUser/requireUser/requireManager`, shell (sidebar, header w/ role badge + logout, mobile sheet), placeholder pages, seed 1 manager + 2 reps, token-hash email templates. Browser-checked (in-app browser) + `e2e/auth.spec.ts` 8/8 (`PLAYWRIGHT_CHANNEL=chrome`; Playwright Chromium 1.63 not downloaded); invite link verified via admin API → /set-password. `npm run test:db` 207/207 (schema test setup made seed-robust); `npm run verify` passes (44 vitest). Plan: prompts/enhanced/03-auth-shell.md |
| 4 | Org settings, time helpers, Team page | done | `src/lib/time.ts` (pure, @date-fns/tz; 21 tests: 11pm NY/UTC midnight, DST spring-forward incl. nonexistent 02:30 and fall-back ambiguous 01:30, Honolulu/Phoenix no-DST, bucket boundaries upcoming = next 7 days; also pass under TZ=Asia/Kolkata/Pacific/Kiritimati), `money.ts`, `getOrgSettings()` (cache) + `OrgSettingsProvider`, /settings Organization + Team tabs, actions `updateOrgSettings`/`inviteUser`/`changeUserRole`. Invite flow browser-checked (in-app browser: invite manager → Mailpit → /set-password → login as Admin/Manager; DB `public.users.role` = `raw_app_meta_data.role`) + `e2e/settings.spec.ts` 4/4 (full e2e 12/12, `PLAYWRIGHT_CHANNEL=chrome`, now `workers: 1`). Local `email_sent` rate limit 2 → 100. `npm run test:db` 207/207; `npm run verify` passes (76 vitest). Plan: prompts/enhanced/04-settings-time-team.md |
| 5 | Validation + server actions | done | Schemas (`validation/{prospects,activities,follow-ups,demo,ai,common}.ts`, 37 new vitest incl. close-reason matrix + future `occurredAt` w/ 5-min skew), data layer `src/server/data/*` (ctx-injected, testable) + `"use server"` wrappers (prospects/activities/followUps/demo) with `revalidateProspect`; `moveProspectStage` via `move_prospect_stage` RPC (same stage = no-op), `updateProspect` strict (rejects stage/owner/close/derived keys), error mapper `dbErrorMessage`. `npm run test:integration` 11/11 vs local Supabase as rep A/rep B/manager (RLS, reassignment, follow-up ownership, demo tz); wrappers smoke-tested via a temporary route handler in `next dev` as rep + manager (rep → requireManager redirect on reassign/delete), then removed. `npm run test:db` 207/207; `npm run verify` passes (113 vitest); e2e 12/12. Plan: prompts/enhanced/05-data-layer.md |
| 6 | Stage-change workflow | pending | |
| 7 | Prospects list page | pending | |
| 8 | Prospect detail page + timeline | pending | |
| 9 | Kanban pipeline | pending | |
| 10 | Follow-ups page + stale deals | pending | |
| 11 | AI insights | pending | real-key test deferred until OPENAI_API_KEY is provided |
| 12 | Dashboard | pending | |
| 13 | Reports | pending | |
| 14 | Seed data + e2e tests | pending | |
| 15 | Deploy | pending | external accounts (GitHub/Supabase cloud/Vercel) need user go-ahead |

## Deferred blockers

- (none yet)
