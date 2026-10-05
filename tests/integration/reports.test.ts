/**
 * Reports data (Prompt 13) vs local Supabase, through the real app paths:
 * prospects are created and moved through the data layer as Riley (A) and
 * Sam (B) — so stage_history is written by the triggers — then their
 * created_at / closed_at / completed_at are shifted with psql (postgres) into
 * a far-past period that nothing else uses. Period metrics are asserted as
 * literal numbers; "now" metrics (stage counts, pipeline value, overdue /
 * today) against hand-written SQL. Run: `npm run test:integration`.
 */
import { execFileSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";
import { orgToday } from "@/lib/time";
import type { ActionResult } from "@/server/actions/types";
import type { DataContext } from "@/server/data/context";
import { completeFollowUpData, createFollowUpData } from "@/server/data/follow-ups";
import { createProspectData, moveProspectStageData } from "@/server/data/prospects";
import { getReportData, type ReportData } from "@/server/data/reports";

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
const PREFIX = `itest-reports-${Date.now()}`;
/** A March far in the past (org tz), used by nothing else. */
const PERIOD = { from: "2024-03-01", to: "2024-03-31" } as const;

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
const created: string[] = [];

async function newProspect(ctx: DataContext, name: string, dealValue: number | null, currency = "USD"): Promise<string> {
  const prospect = expectOk(
    await createProspectData(ctx, { name: `${PREFIX} ${name}`, dealValue: dealValue ?? undefined, currency }),
  );
  created.push(prospect.id);
  return prospect.id;
}

async function move(ctx: DataContext, prospectId: string, toStage: string, closeReason?: string): Promise<void> {
  expectOk(
    await moveProspectStageData(ctx, {
      prospectId,
      toStage: toStage as never,
      ...(closeReason ? { closeReason: closeReason as never } : {}),
    }),
  );
}

/**
 * Org-local wall time → stored instant (psql does the tz conversion).
 * created_at is immutable through the prospects trigger, so triggers are
 * bypassed for this privileged fixture write (session_replication_role).
 */
function pin(id: string, column: "created_at" | "closed_at", local: string): void {
  exec(
    `set session_replication_role = replica; update public.prospects set ${column} = ('${local}'::timestamp at time zone (select timezone from public.org_settings where id)) where id = '${id}'`,
  );
}

beforeAll(async () => {
  [A, B, M] = await Promise.all([signIn("A"), signIn("B"), signIn("M")]);

  // A: x1 skip forward + backward move, then won (USD 1,000)
  const x1 = await newProspect(A, "x1", 1000);
  await move(A, x1, "contacted");
  await move(A, x1, "qualified");
  await move(A, x1, "conversation");
  await move(A, x1, "closed_won", "product_fit");
  // A: x2 contacted → lost (no value)
  const x2 = await newProspect(A, "x2", null);
  await move(A, x2, "contacted");
  await move(A, x2, "closed_lost", "price");
  // A: x3 open at demo booked (EUR 200) + a follow-up completed in the period
  const x3 = await newProspect(A, "x3", 200, "EUR");
  await move(A, x3, "demo_booked");
  const followUp = expectOk(await createFollowUpData(A, { prospectId: x3, dueDate: orgToday("UTC"), note: "call" }));
  expectOk(await completeFollowUpData(A, { followUpId: followUp.id }));
  exec(`update public.follow_ups set completed_at = '2024-03-15 15:00+00' where id = '${followUp.id}'`);
  // B: y1 skip to demo attended → lost (USD 300)
  const y1 = await newProspect(B, "y1", 300);
  await move(B, y1, "demo_attended");
  await move(B, y1, "closed_lost", "timing");

  pin(x1, "created_at", "2024-03-02 09:00");
  pin(x2, "created_at", "2024-03-03 09:00");
  pin(x3, "created_at", "2024-03-04 09:00");
  pin(y1, "created_at", "2024-03-01 00:00"); // first instant of the period
  pin(x1, "closed_at", "2024-03-20 12:00");
  pin(x2, "closed_at", "2024-03-31 23:59"); // last minute of the period
  pin(y1, "closed_at", "2024-03-22 12:00");
});

afterAll(async () => {
  if (created.length > 0) await M.supabase.from("prospects").delete().in("id", created);
});

function funnelOf(data: ReportData) {
  return data.funnel.map((step) => [step.stage, step.count, step.stepConversionPct, step.overallConversionPct]);
}

/** Hand-written "now" numbers (no RLS; owners spelled out). */
function expectedNow(owner: string | null) {
  const own = owner ? `p.owner_id = '${owner}'` : "true";
  const stages = sql<{ stage: string; n: number }>(`
    select s.stage::text as stage, count(p.id)::int as n
    from unnest(enum_range(null::public.pipeline_stage)) with ordinality s(stage, ord)
    left join public.prospects p on p.stage = s.stage and ${own}
    group by s.stage, s.ord order by s.ord`);
  const totals = sql<{ currency: string; total: string; count: number }>(`
    select p.currency::text as currency, sum(p.deal_value)::text as total, count(*)::int as count
    from public.prospects p
    where p.stage not in ('closed_won', 'closed_lost') and p.deal_value is not null and ${own}
    group by 1 order by 1`);
  const [withoutValue] = sql<{ n: number }>(`
    select count(*)::int as n from public.prospects p
    where p.stage not in ('closed_won', 'closed_lost') and p.deal_value is null and ${own}`);
  const [followUps] = sql<{ overdue: number; today: number }>(`
    select
      count(*) filter (where f.due_date < t.today)::int as overdue,
      count(*) filter (where f.due_date = t.today)::int as today
    from public.follow_ups f
    cross join (select (now() at time zone s.timezone)::date as today from public.org_settings s where s.id) t
    where f.status = 'pending' and ${owner ? `f.owner_id = '${owner}'` : "true"}`);
  return {
    stageCounts: stages.map((row) => [row.stage, row.n]),
    totals: totals.map((row) => ({ currency: row.currency, total: Number(row.total), count: row.count })),
    withoutValue: withoutValue.n,
    overdue: followUps.overdue,
    today: followUps.today,
  };
}

function expectNow(data: ReportData, owner: string | null) {
  const expected = expectedNow(owner);
  expect(data.stageCounts.map((row) => [row.stage, row.count])).toEqual(expected.stageCounts);
  expect(data.totalProspects).toBe(expected.stageCounts.reduce((sum, [, n]) => sum + Number(n), 0));
  expect(data.pipelineValue.totals).toEqual(expected.totals);
  expect(data.pipelineValue.withoutValueCount).toBe(expected.withoutValue);
  expect(data.followUps.overdue).toBe(expected.overdue);
  expect(data.followUps.dueToday).toBe(expected.today);
}

const A_FUNNEL = [
  ["prospect", 3, null, 100],
  ["contacted", 3, 100, 100],
  ["conversation", 2, 66.7, 66.7],
  ["qualified", 2, 100, 66.7],
  ["demo_booked", 2, 100, 66.7],
  ["demo_attended", 1, 50, 33.3],
  ["closed_won", 1, 100, 33.3],
];

describe("getReportData", () => {
  it("rep A: own funnel, outcomes, follow-ups and now-metrics", async () => {
    const data = expectOk(await getReportData(A, PERIOD));
    expect(funnelOf(data)).toEqual(A_FUNNEL);
    expect(data.reached.follow_up).toBe(1);
    expect(data.outcomes).toMatchObject({
      won: 1,
      lost: 1,
      winRatePct: 50,
      wonValue: [{ currency: "USD", total: 1000, count: 1 }],
      wonWithoutValue: 0,
    });
    expect(data.outcomes.lostReasons[0]).toEqual({ reason: "price", label: "Price", count: 1 });
    expect(data.followUps.completed).toBe(1);
    expectNow(data, USERS.A.id);
  });

  it("rep A passing Sam's id is ignored (own numbers, never Sam's)", async () => {
    const own = expectOk(await getReportData(A, PERIOD));
    const spoofed = expectOk(await getReportData(A, { ...PERIOD, ownerId: USERS.B.id }));
    expect(spoofed).toEqual(own);
  });

  it("rep B: own numbers only", async () => {
    const data = expectOk(await getReportData(B, PERIOD));
    expect(data.funnel.map((step) => step.count)).toEqual([1, 1, 1, 1, 1, 1, 0]);
    expect(data.funnel[6].stepConversionPct).toBe(0);
    expect(data.outcomes).toMatchObject({ won: 0, lost: 1, winRatePct: 0, wonValue: [] });
    expect(data.outcomes.lostReasons[0]).toMatchObject({ reason: "timing", count: 1 });
    expect(data.followUps.completed).toBe(0);
    expectNow(data, USERS.B.id);
  });

  it("manager: whole team, then filtered to each rep", async () => {
    const all = expectOk(await getReportData(M, PERIOD));
    expect(all.funnel.map((step) => step.count)).toEqual([4, 4, 3, 3, 3, 2, 1]);
    expect(all.funnel[6].overallConversionPct).toBe(25);
    expect(all.outcomes).toMatchObject({ won: 1, lost: 2, winRatePct: 33.3 });
    expectNow(all, null);

    const onlyA = expectOk(await getReportData(M, { ...PERIOD, ownerId: USERS.A.id }));
    expect(funnelOf(onlyA)).toEqual(A_FUNNEL);
    expectNow(onlyA, USERS.A.id);

    const onlyB = expectOk(await getReportData(M, { ...PERIOD, ownerId: USERS.B.id }));
    expect(onlyB.outcomes).toMatchObject({ won: 0, lost: 1 });
    expectNow(onlyB, USERS.B.id);
  });

  it("an empty period has zero steps and undefined conversions", async () => {
    const data = expectOk(await getReportData(M, { from: "2023-01-01", to: "2023-01-31" }));
    expect(data.funnel.map((step) => [step.count, step.stepConversionPct, step.overallConversionPct])).toEqual(
      Array.from({ length: 7 }, () => [0, null, null]),
    );
    expect(data.outcomes).toMatchObject({ won: 0, lost: 0, winRatePct: null });
  });

  it("rejects a reversed period", async () => {
    const result = await getReportData(M, { from: "2024-03-31", to: "2024-03-01" });
    expect(result.ok).toBe(false);
  });
});
