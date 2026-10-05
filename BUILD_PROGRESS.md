# Build Progress

Tracks each BUILD_PROMPTS.md prompt: status, verification result, commit, and any blockers deferred to the end.

| # | Prompt | Status | Notes |
|---|--------|--------|-------|
| 0 | Project bootstrap + CLAUDE.md | done | `npm run verify` passes (typecheck, lint, 8 vitest tests, build). Next 16.3.8, shadcn radix-nova (23 components; `form.tsx` hand-written, registry no longer ships it), Supabase CLI 2.119.0 (devDep), `[auth] enable_signup = false`. Plan: prompts/enhanced/00-bootstrap.md |
| 1 | Database schema + triggers | done | 2 migrations apply cleanly (`npm run db:reset`); pgTAP `npm run test:db` 113/113 pass (needs local Supabase; not in verify); `npm run verify` passes (18 vitest incl. SQL↔constants drift test). Extras for later prompts: `is_manager()` defined here, `move_prospect_stage` RPC (stage note), `prospects_with_flags` view, auth⇄public role sync. Plan: prompts/enhanced/01-schema.md |
| 2 | Row Level Security | pending | |
| 3 | Auth + app shell | pending | |
| 4 | Org settings, time helpers, Team page | pending | |
| 5 | Validation + server actions | pending | |
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
