/**
 * Dashboard data (Prompt 12) vs **hand-written SQL** on local Supabase.
 *
 * The dashboard data functions run as the seed users Riley (rep A), Sam
 * (rep B) and Morgan (manager M; All + filtered to each rep) through RLS. The
 * expected values come from independent SQL run with psql as the postgres
 * superuser (no RLS, no app views/functions: owner scoping is written out by
 * hand). Checked on the plain seed (also against literal numbers) and again
 * after adding a fixture (activities, AI insights, closed deals inside and
 * outside the 90-day window, mixed currencies, a deal without value).
 * Run: `npm run test:integration` (needs psql + the local stack).
 */
import { execFileSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rankDealsNeedingAttention, type RankableDeal } from "@/lib/dashboard";
import type { Database } from "@/lib/supabase/database.types";
import { addDaysToDateString, orgToday } from "@/lib/time";
import type { ActionResult } from "@/server/actions/types";
import { addActivityData } from "@/server/data/activities";
import type { DataContext } from "@/server/data/context";
import {
  getDashboardKpisData,
  listContactTodayData,
  listDealsNeedingAttentionData,
  listLatestAiRecommendationsData,
  listRecentActivityData,
} from "@/server/data/dashboard";
import { createFollowUpData } from "@/server/data/follow-ups";
import { createProspectData, moveProspectStageData } from "@/server/data/prospects";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides env vars directly.
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const DB_URL = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const PASSWORD = "Password123!";
const USERS = {
  M: { id: "11111111-1111-4111-8111-000000000001", email: "morgan.manager@example.com", role: "manager" },
  A: { id: "11111111-1111-4111-8111-000000000002", email: "riley.rep@example.com", role: "sales_rep" },
  B: { id: "11111111-1111-4111-8111-000000000003", email: "sam.rep@example.com", role: "sales_rep" },
} as const;
const PREFIX = `itest-dash-${Date.now()}`;

async function signIn(key: keyof typeof USERS): Promise<DataContext> {
  const supabase = createClient<Database>(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase.auth.signInWithPassword({ email: USERS[key].email, password: PASSWORD });
  if (error) throw new Error(`sign in ${key}: ${error.message}`);
  return { supabase: supabase as SupabaseClient<Database>, user: { id: USERS[key].id, role: USERS[key].role } };
}

function expectOk<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.data;
}

/** Runs hand-written SQL as the postgres superuser; returns the rows as JSON. */
function sql<T>(query: string): T[] {
  const out = execFileSync(
    "psql",
    [DB_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", `select coalesce(json_agg(t), '[]'::json) from (${query}) t`],
    { encoding: "utf8" },
  );
  return JSON.parse(out.trim()) as T[];
}

function exec(statement: string): void {
  execFileSync("psql", [DB_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8" });
}

let A: DataContext;
let B: DataContext;
let M: DataContext;
let timezone: string;
let today: string;

beforeAll(async () => {
  [A, B, M] = await Promise.all([signIn("A"), signIn("B"), signIn("M")]);
  const { data } = await M.supabase.from("org_settings").select("timezone").single();
  timezone = data!.timezone;
  today = orgToday(timezone);
});

const createdProspects: string[] = [];

afterAll(async () => {
  // Cascades to follow-ups, activities, stage history and AI insights.
  if (createdProspects.length > 0) await M.supabase.from("prospects").delete().in("id", createdProspects);
});

// ---------------------------------------------------------------------------
// Hand-written SQL (expected values). `owners` null = whole team.
// ---------------------------------------------------------------------------

type Scope = { label: string; ctx: () => DataContext; ownerId?: string; owners: string[] | null };

function ownerClause(owners: string[] | null, column: string): string {
  return owners === null ? "true" : `${column} in (${owners.map((id) => `'${id}'`).join(", ")})`;
}

const OPEN = "p.stage not in ('closed_won', 'closed_lost')";
const TODAY_SQL = "(select (now() at time zone s.timezone)::date from public.org_settings s where s.id)";

function expectedKpis(owners: string[] | null) {
  const own = ownerClause(owners, "p.owner_id");
  const [counts] = sql<{ open: number; without_value: number; stale: number }>(`
    select
      count(*) filter (where ${OPEN})::int as open,
      count(*) filter (where ${OPEN} and p.deal_value is null)::int as without_value,
      count(*) filter (where ${OPEN} and p.last_activity_at < now() - make_interval(days => s.stale_days))::int as stale
    from public.prospects p cross join public.org_settings s
    where s.id and ${own}`);
  const totals = sql<{ currency: string; total: string; count: number }>(`
    select p.currency::text as currency, sum(p.deal_value)::text as total, count(*)::int as count
    from public.prospects p
    where ${OPEN} and p.deal_value is not null and ${own}
    group by p.currency order by p.currency`);
  const [followUps] = sql<{ due_today: number; overdue: number }>(`
    select
      count(*) filter (where f.due_date = ${TODAY_SQL})::int as due_today,
      count(*) filter (where f.due_date < ${TODAY_SQL})::int as overdue
    from public.follow_ups f
    where f.status = 'pending' and ${ownerClause(owners, "f.owner_id")}`);
  const [outcomes] = sql<{ won: number; lost: number }>(`
    select
      count(*) filter (where p.stage = 'closed_won')::int as won,
      count(*) filter (where p.stage = 'closed_lost')::int as lost
    from public.prospects p cross join public.org_settings s
    where s.id and ${own}
      and (p.closed_at at time zone s.timezone)::date between ${TODAY_SQL} - 89 and ${TODAY_SQL}`);
  const decided = outcomes.won + outcomes.lost;
  return {
    openProspects: counts.open,
    pipelineValue: {
      totals: totals.map((row) => ({ currency: row.currency, total: Number(row.total), count: row.count })),
      withoutValueCount: counts.without_value,
      openCount: counts.open,
    },
    dueToday: followUps.due_today,
    overdue: followUps.overdue,
    stale: counts.stale,
    winRate: {
      won: outcomes.won,
      lost: outcomes.lost,
      rate: decided === 0 ? null : outcomes.won / decided,
      from: addDaysToDateString(today, -89),
      to: today,
    },
  };
}

function expectedContactToday(owners: string[] | null) {
  return sql<{ id: string }>(`
    select f.id from public.follow_ups f
    where f.status = 'pending' and f.due_date <= ${TODAY_SQL} and ${ownerClause(owners, "f.owner_id")}
    order by f.due_date, f.created_at, f.id`).map((row) => row.id);
}

type FlagRow = {
  id: string;
  rank: number;
  follow_up_date: string | null;
  last_activity_at: string;
  overdue: boolean;
  stale: boolean;
  low: boolean;
  no_follow_up: boolean;
};

/** Every open deal with its hand-computed flags (ordered as the dashboard should rank them). */
function expectedAttention(owners: string[] | null): FlagRow[] {
  return sql<FlagRow>(`
    with latest as (
      select distinct on (i.prospect_id) i.prospect_id, i.deal_health
      from public.ai_insights i order by i.prospect_id, i.created_at desc, i.id desc
    ), flags as (
      select p.id, p.follow_up_date, p.last_activity_at,
        coalesce(p.follow_up_date < ${TODAY_SQL}, false) as overdue,
        p.last_activity_at < now() - make_interval(days => s.stale_days) as stale,
        coalesce(l.deal_health = 'low', false) as low,
        p.follow_up_date is null as no_follow_up
      from public.prospects p cross join public.org_settings s
      left join latest l on l.prospect_id = p.id
      where s.id and ${OPEN} and ${ownerClause(owners, "p.owner_id")}
    )
    select *, case when overdue then 1 when stale then 2 when low then 3 when no_follow_up then 4 else 0 end as rank
    from flags
    order by case when overdue then 1 when stale then 2 when low then 3 when no_follow_up then 4 else 9 end,
      follow_up_date nulls last, last_activity_at, id`);
}

function expectedAiRecommendations(owners: string[] | null) {
  return sql<{ id: string; recommended_next_step: string }>(`
    select l.id, l.recommended_next_step from (
      select distinct on (i.prospect_id) i.* from public.ai_insights i
      order by i.prospect_id, i.created_at desc, i.id desc
    ) l join public.prospects p on p.id = l.prospect_id
    where ${OPEN} and ${ownerClause(owners, "p.owner_id")}
    order by l.created_at desc, l.id desc limit 5`);
}

function expectedRecentActivity(owners: string[] | null) {
  return sql<{ id: string }>(`
    select a.id from public.activities a join public.prospects p on p.id = a.prospect_id
    where ${ownerClause(owners, "p.owner_id")}
    order by a.occurred_at desc, a.created_at desc, a.id desc limit 15`).map((row) => row.id);
}

const SCOPES: Scope[] = [
  { label: "rep A (Riley)", ctx: () => A, owners: [USERS.A.id] },
  { label: "rep B (Sam)", ctx: () => B, owners: [USERS.B.id] },
  { label: "rep A with B's owner param (ignored)", ctx: () => A, ownerId: USERS.B.id, owners: [USERS.A.id] },
  { label: "manager, All", ctx: () => M, owners: null },
  { label: "manager filtered to A", ctx: () => M, ownerId: USERS.A.id, owners: [USERS.A.id] },
  { label: "manager filtered to B", ctx: () => M, ownerId: USERS.B.id, owners: [USERS.B.id] },
];

async function compareWithSql(scope: Scope) {
  const ctx = scope.ctx();
  const ownerId = scope.ownerId;

  const kpis = expectOk(await getDashboardKpisData(ctx, { ownerId, today }));
  expect(kpis, `${scope.label}: KPIs`).toEqual(expectedKpis(scope.owners));

  const contact = expectOk(await listContactTodayData(ctx, { ownerId, limit: 100 }));
  const contactIds = expectedContactToday(scope.owners);
  expect(contact.rows.map((row) => row.id), `${scope.label}: contact today`).toEqual(contactIds);
  expect(contact.total).toBe(contactIds.length);
  expect(contact.total).toBe(kpis.dueToday + kpis.overdue);

  const flags = expectedAttention(scope.owners);
  const needing = flags.filter((row) => row.rank > 0);
  const attention = expectOk(await listDealsNeedingAttentionData(ctx, { ownerId, limit: 100 }));
  expect(
    attention.rows.map((row) => [row.id, row.rank, row.hasOverdueFollowUp, row.isStale, row.lowHealth, row.noFollowUp]),
    `${scope.label}: attention`,
  ).toEqual(needing.map((row) => [row.id, row.rank, row.overdue, row.stale, row.low, row.no_follow_up]));
  expect(attention.total).toBe(needing.length);
  const top = expectOk(await listDealsNeedingAttentionData(ctx, { ownerId }));
  expect(top.rows.map((row) => row.id)).toEqual(needing.slice(0, 10).map((row) => row.id));

  // TS mirror: ranking every open deal in TS gives the SQL order.
  const rankable: RankableDeal[] = flags.map((row) => ({
    id: row.id,
    followUpDate: row.follow_up_date,
    lastActivityAt: row.last_activity_at,
    hasOverdueFollowUp: row.overdue,
    isStale: row.stale,
    lowHealth: row.low,
    noFollowUp: row.no_follow_up,
  }));
  expect(rankDealsNeedingAttention([...rankable].reverse()).map((row) => row.id)).toEqual(
    attention.rows.map((row) => row.id),
  );

  const ai = expectOk(await listLatestAiRecommendationsData(ctx, { ownerId }));
  expect(
    ai.map((row) => [row.insightId, row.nextStep]),
    `${scope.label}: AI recommendations`,
  ).toEqual(expectedAiRecommendations(scope.owners).map((row) => [row.id, row.recommended_next_step]));

  const feed = expectOk(await listRecentActivityData(ctx, { ownerId }));
  expect(feed.map((row) => row.id), `${scope.label}: recent activity`).toEqual(expectedRecentActivity(scope.owners));

  return { kpis, contact, attention, ai, feed };
}

// ---------------------------------------------------------------------------
// Plain seed
// ---------------------------------------------------------------------------

describe("dashboard on the seed data", () => {
  it("matches hand-written SQL for reps, manager (All) and manager filtered", async () => {
    for (const scope of SCOPES) await compareWithSql(scope);
  });

  it("matches the documented seed numbers", async () => {
    // Hand-computed from supabase/seed.sql (dates relative to now / org_today()).
    const riley = expectOk(await getDashboardKpisData(A, { today }));
    expect(riley).toMatchObject({ openProspects: 16, dueToday: 2, overdue: 3, stale: 2 });
    expect(riley.pipelineValue).toEqual({
      totals: [{ currency: "USD", total: 165700, count: 12 }],
      withoutValueCount: 4,
      openCount: 16,
    });
    expect(riley.winRate).toMatchObject({ won: 3, lost: 2, rate: 0.6 });

    const sam = expectOk(await getDashboardKpisData(B, { today }));
    expect(sam).toMatchObject({ openProspects: 13, dueToday: 2, overdue: 3, stale: 3 });
    expect(sam.pipelineValue).toEqual({
      totals: [
        { currency: "EUR", total: 15200, count: 2 },
        { currency: "USD", total: 93700, count: 9 },
      ],
      withoutValueCount: 2,
      openCount: 13,
    });
    expect(sam.winRate).toMatchObject({ won: 3, lost: 3, rate: 0.5 });

    const team = expectOk(await getDashboardKpisData(M, { today }));
    expect(team).toMatchObject({ openProspects: 29, dueToday: 4, overdue: 6, stale: 5 });
    expect(team.pipelineValue).toEqual({
      totals: [
        { currency: "EUR", total: 15200, count: 2 },
        { currency: "USD", total: 259400, count: 21 },
      ],
      withoutValueCount: 6,
      openCount: 29,
    });
    expect(team.winRate).toMatchObject({ won: 6, lost: 5, rate: 6 / 11 });

    const names = async (ctx: DataContext, ownerId?: string) =>
      expectOk(await listDealsNeedingAttentionData(ctx, { ownerId })).rows.map((row) => [row.name, row.reasons]);
    expect(await names(A)).toEqual([
      ["James O'Connor", ["overdue_follow_up", "stale", "low_health"]],
      ["Owen Fischer", ["overdue_follow_up"]],
      ["Jordan Lee", ["overdue_follow_up"]],
      ["Marcus Chen", ["stale", "no_follow_up"]],
      ["Ethan Wright", ["no_follow_up"]],
    ]);
    expect(await names(B)).toEqual([
      ["Kenji Tanaka", ["overdue_follow_up"]],
      ["Aisha Khan", ["overdue_follow_up", "stale", "low_health"]],
      ["Leah Cohen", ["overdue_follow_up", "stale"]],
      ["Hiro Sato", ["stale", "no_follow_up"]],
      ["Paul Schneider", ["no_follow_up"]],
    ]);
    // Same follow-up date → least recently active first (Aisha before James, Leah before Jordan).
    expect((await names(M)).map(([name]) => name)).toEqual([
      "Kenji Tanaka",
      "Aisha Khan",
      "James O'Connor",
      "Owen Fischer",
      "Leah Cohen",
      "Jordan Lee",
      "Marcus Chen",
      "Hiro Sato",
      "Ethan Wright",
      "Paul Schneider",
    ]);

    const contact = expectOk(await listContactTodayData(M));
    expect(contact.rows.map((row) => [row.prospect.name, row.bucket])).toEqual([
      ["Kenji Tanaka", "overdue"],
      ["Aisha Khan", "overdue"],
      ["James O'Connor", "overdue"],
      ["Owen Fischer", "overdue"],
      ["Leah Cohen", "overdue"],
      ["Jordan Lee", "overdue"],
      ["Ahmed Saleh", "today"],
      ["Grace Kim", "today"],
      ["Fatima Haddad", "today"],
      ["Priya Shah", "today"],
    ]);
    expect(contact.rows[5].prospect.objections).toEqual(["price"]);
    expect(contact.rows[1].aiNextStep).toMatchObject({ dealHealth: "low" });

    const ai = expectOk(await listLatestAiRecommendationsData(M));
    expect(ai.map((row) => row.nextStep)).toEqual([
      "Confirm attendees and ask who signs off on the budget during the demo.",
      "Send tiered volume pricing and propose a call with their finance lead.",
      "Run the demo around their weekly sales meeting and send a proposal the same day.",
      "Send a proposal with both pricing options before Friday.",
      "Return the security questionnaire and propose two demo dates.",
    ]);
  });

  it("rejects invalid input", async () => {
    expect((await getDashboardKpisData(M, { today: "2026-13-01" })).ok).toBe(false);
    expect((await listContactTodayData(M, { ownerId: "nope" })).ok).toBe(false);
    expect((await listRecentActivityData(M, { limit: 0 })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Seed + fixture
// ---------------------------------------------------------------------------

async function prospect(ctx: DataContext, name: string, fields: { dealValue?: number; currency?: string } = {}) {
  const row = expectOk(await createProspectData(ctx, { name: `${PREFIX} ${name}`, objections: ["price"], ...fields }));
  createdProspects.push(row.id);
  return row.id;
}

function insight(prospectId: string, owner: string, step: string, health: string, minutesAgo: number) {
  exec(`insert into public.ai_insights
    (prospect_id, summary, decision_maker_status, main_objection, recommended_next_step, deal_health, model, created_by, created_at)
    values ('${prospectId}', 'summary', 'unknown', 'Price', '${step}', '${health}', 'fake-ai', '${owner}',
            now() - interval '${minutesAgo} minutes')`);
}

describe("dashboard with a fixture", () => {
  beforeAll(async () => {
    // Rep A: overdue + low AI, low AI only (EUR), won 100 days ago, lost today, no value + no follow-up.
    const overdue = await prospect(A, "Overdue", { dealValue: 1000 });
    expectOk(await createFollowUpData(A, { prospectId: overdue, dueDate: addDaysToDateString(today, -4), note: "Chase" }));
    expectOk(await addActivityData(A, { prospectId: overdue, type: "call", content: "Discussed pricing tiers." }));
    insight(overdue, USERS.A.id, "Offer a pilot", "low", 60);

    const low = await prospect(A, "Low health", { dealValue: 2000, currency: "EUR" });
    expectOk(await createFollowUpData(A, { prospectId: low, dueDate: addDaysToDateString(today, 2), note: "Check in" }));
    insight(low, USERS.A.id, "Old step", "high", 120);
    insight(low, USERS.A.id, "Share references", "low", 5);

    const wonOld = await prospect(A, "Won long ago", { dealValue: 5000 });
    expectOk(await moveProspectStageData(A, { prospectId: wonOld, toStage: "closed_won", closeReason: "product_fit" }));
    exec(`update public.prospects set closed_at = now() - interval '100 days' where id = '${wonOld}'`);

    const lost = await prospect(A, "Lost", { dealValue: 700 });
    insight(lost, USERS.A.id, "Closed deal step", "medium", 1);
    expectOk(await moveProspectStageData(A, { prospectId: lost, toStage: "closed_lost", closeReason: "price" }));

    const noValue = await prospect(A, "No value");
    expectOk(await addActivityData(A, { prospectId: noValue, type: "note", content: "Waiting for a budget." }));

    // Rep B: GBP deal due today with a healthy insight, won today.
    const today_ = await prospect(B, "Due today", { dealValue: 500, currency: "GBP" });
    expectOk(await createFollowUpData(B, { prospectId: today_, dueDate: today, note: "Send the contract" }));
    expectOk(await addActivityData(B, { prospectId: today_, type: "conversation", content: "Ready to sign." }));
    insight(today_, USERS.B.id, "Send contract", "high", 10);
    const won = await prospect(B, "Won", { dealValue: 900 });
    expectOk(await moveProspectStageData(B, { prospectId: won, toStage: "closed_won", closeReason: "urgent_need" }));
  });

  it("matches hand-written SQL for reps, manager (All) and manager filtered", async () => {
    for (const scope of SCOPES) await compareWithSql(scope);
  });

  it("reflects the fixture", async () => {
    // Seed numbers (see above) + the fixture: 3 more open deals (USD 1,000, EUR 2,000, no value),
    // one more overdue follow-up, one more loss in the window.
    const riley = expectOk(await getDashboardKpisData(A, { today }));
    expect(riley).toMatchObject({ openProspects: 19, dueToday: 2, overdue: 4, stale: 2 });
    expect(riley.pipelineValue).toEqual({
      totals: [
        { currency: "EUR", total: 2000, count: 1 },
        { currency: "USD", total: 166700, count: 13 },
      ],
      withoutValueCount: 5,
      openCount: 19,
    });
    // Seed 3 won / 2 lost + the fixture loss; the 100-day-old win is outside the window.
    expect(riley.winRate).toMatchObject({ won: 3, lost: 3, rate: 0.5 });

    const attention = expectOk(await listDealsNeedingAttentionData(A)).rows.map((row) => [
      row.name.replace(`${PREFIX} `, ""),
      row.reasons,
    ]);
    expect(attention).toEqual([
      ["Overdue", ["overdue_follow_up", "low_health"]],
      ["James O'Connor", ["overdue_follow_up", "stale", "low_health"]],
      ["Owen Fischer", ["overdue_follow_up"]],
      ["Jordan Lee", ["overdue_follow_up"]],
      ["Marcus Chen", ["stale", "no_follow_up"]],
      ["Low health", ["low_health"]],
      ["Ethan Wright", ["no_follow_up"]],
      ["No value", ["no_follow_up"]],
    ]);

    const ai = expectOk(await listLatestAiRecommendationsData(M));
    // Newest first; the closed deal's insight and superseded insights are excluded; then the seed's newest.
    expect(ai.map((row) => row.nextStep)).toEqual([
      "Share references",
      "Send contract",
      "Offer a pilot",
      "Confirm attendees and ask who signs off on the budget during the demo.",
      "Send tiered volume pricing and propose a call with their finance lead.",
    ]);

    const contact = expectOk(await listContactTodayData(A));
    const first = contact.rows[0];
    expect(first.prospect.name).toBe(`${PREFIX} Overdue`);
    expect(first.lastConversation?.snippet).toBe("Discussed pricing tiers.");
    expect(first.aiNextStep).toMatchObject({ text: "Offer a pilot", dealHealth: "low" });
    expect(first.prospect.objections).toEqual(["price"]);

    const feed = expectOk(await listRecentActivityData(B));
    expect(feed.every((row) => row.prospect.ownerId === USERS.B.id)).toBe(true);
    expect(feed.map((row) => row.type)).toContain("conversation");
  });
});
