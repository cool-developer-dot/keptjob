/**
 * Prospects list query (Prompt 7) against local Supabase with RLS, as the seed
 * users: rep A (Riley), rep B (Sam) and manager M (Morgan). Relies on the seed
 * giving Riley at least one prospect with an overdue follow-up and one stale
 * prospect. Run: `npm run test:integration`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";
import { parseProspectListParams, type RawSearchParams } from "@/lib/validation/prospect-list";
import type { ActionResult } from "@/server/actions/types";
import type { DataContext } from "@/server/data/context";
import { listProspectsData, type ProspectListResult } from "@/server/data/prospect-list";
import { createProspectData } from "@/server/data/prospects";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides env vars directly.
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "Password123!";
const USERS = {
  M: { id: "11111111-1111-4111-8111-000000000001", email: "morgan.manager@example.com", role: "manager" },
  A: { id: "11111111-1111-4111-8111-000000000002", email: "riley.rep@example.com", role: "sales_rep" },
  B: { id: "11111111-1111-4111-8111-000000000003", email: "sam.rep@example.com", role: "sales_rep" },
} as const;
const PREFIX = `itest-list-${Date.now()}`;

async function signIn(key: keyof typeof USERS): Promise<DataContext> {
  const supabase = createClient<Database>(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: USERS[key].email, password: PASSWORD });
  if (error) throw new Error(`sign in ${key}: ${error.message}`);
  return { supabase: supabase as SupabaseClient<Database>, user: { id: USERS[key].id, role: USERS[key].role } };
}

function expectOk<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.data;
}

let A: DataContext;
let B: DataContext;
let M: DataContext;
const created: string[] = [];

async function list(ctx: DataContext, raw: RawSearchParams): Promise<ProspectListResult> {
  return expectOk(await listProspectsData(ctx, parseProspectListParams(raw)));
}

async function newProspect(ctx: DataContext, input: Parameters<typeof createProspectData>[1]) {
  const row = expectOk(await createProspectData(ctx, input));
  created.push(row.id);
  return row;
}

beforeAll(async () => {
  [A, B, M] = await Promise.all([signIn("A"), signIn("B"), signIn("M")]);
  // Search fixtures (rep A): literal %, _ and , in names/companies.
  await newProspect(A, { name: `${PREFIX} 50% off`, company: "Acme, Inc.", email: "pct@list.example" });
  await newProspect(A, { name: `${PREFIX} 50X off`, company: "A_b (co)" });
  await newProspect(A, {
    name: `${PREFIX} objection`,
    objections: ["competitor", "timing"],
    decisionMakerStatus: "no",
    dealValue: 777,
  });
  // Pagination fixtures (rep B): 27 rows.
  for (let i = 0; i < 27; i += 1) {
    await newProspect(B, { name: `${PREFIX} page ${String(i).padStart(2, "0")}` });
  }
});

afterAll(async () => {
  if (created.length > 0) await M.supabase.from("prospects").delete().in("id", created);
});

describe("listProspectsData: RLS scoping", () => {
  it("a rep only sees their own prospects; the owner param is ignored for reps", async () => {
    const own = await list(A, {});
    expect(own.total).toBeGreaterThan(0);
    expect(own.rows.every((row) => row.owner_id === USERS.A.id)).toBe(true);

    const spoofed = await list(A, { owner: USERS.B.id });
    expect(spoofed.total).toBe(own.total);
    expect(spoofed.rows.every((row) => row.owner_id === USERS.A.id)).toBe(true);

    const b = await list(B, { q: PREFIX });
    expect(b.rows.every((row) => row.owner_id === USERS.B.id)).toBe(true);
    expect((await list(B, { q: `${PREFIX} 50%` })).total).toBe(0);
  });

  it("a manager sees everyone and can filter by owner", async () => {
    const all = await list(M, { q: PREFIX, sort: "name" });
    expect(all.total).toBe(30);
    expect(new Set(all.rows.map((row) => row.owner_id))).toEqual(new Set([USERS.A.id, USERS.B.id]));

    const onlyA = await list(M, { q: PREFIX, owner: USERS.A.id });
    expect(onlyA.total).toBe(3);
    expect(onlyA.rows.every((row) => row.owner_id === USERS.A.id)).toBe(true);
  });
});

describe("listProspectsData: search", () => {
  it("treats %, _ and , literally and searches name, company and email", async () => {
    const names = async (q: string) => (await list(A, { q })).rows.map((row) => row.name).sort();
    expect(await names(`${PREFIX} 50%`)).toEqual([`${PREFIX} 50% off`]);
    expect(await names(`${PREFIX} 50_`)).toEqual([]);
    expect(await names("acme, inc")).toEqual([`${PREFIX} 50% off`]);
    expect(await names("a_b (co")).toEqual([`${PREFIX} 50X off`]);
    expect(await names("PCT@LIST.example")).toEqual([`${PREFIX} 50% off`]);
    expect(await names('x"),name.eq.foo')).toEqual([]);
  });
});

describe("listProspectsData: filters", () => {
  it("stage, decision maker and objection (array contains)", async () => {
    const byObjection = await list(A, { q: PREFIX, objection: "competitor" });
    expect(byObjection.rows.map((row) => row.name)).toEqual([`${PREFIX} objection`]);
    const byDm = await list(A, { q: PREFIX, dm: "no" });
    expect(byDm.rows.map((row) => row.name)).toEqual([`${PREFIX} objection`]);
    expect((await list(A, { q: PREFIX, stage: "prospect" })).total).toBe(3);
    expect((await list(A, { q: PREFIX, stage: "qualified" })).total).toBe(0);

    const qualified = await list(M, { stage: "qualified" });
    expect(qualified.rows.every((row) => row.stage === "qualified")).toBe(true);
  });

  it("overdue follow-up and stale flags (seed)", async () => {
    const overdue = await list(A, { overdue: "1" });
    expect(overdue.total).toBeGreaterThan(0);
    expect(overdue.rows.every((row) => row.has_overdue_follow_up && row.follow_up_date)).toBe(true);

    const stale = await list(A, { stale: "1" });
    expect(stale.total).toBeGreaterThan(0);
    expect(stale.rows.every((row) => row.is_stale && !row.stage.startsWith("closed"))).toBe(true);
  });
});

describe("listProspectsData: sort + pagination", () => {
  it("sorts by the whitelisted column in both directions", async () => {
    const asc = (await list(M, { q: `${PREFIX} page`, sort: "name", dir: "asc" })).rows.map((r) => r.name);
    expect(asc).toEqual([...asc].sort());
    const desc = (await list(M, { q: `${PREFIX} page`, sort: "name", dir: "desc" })).rows.map((r) => r.name);
    expect(desc[0]).toBe(`${PREFIX} page 26`);

    const values = (await list(A, { sort: "deal_value", dir: "desc" })).rows.map((r) => r.deal_value);
    const firstNull = values.indexOf(null);
    if (firstNull >= 0) expect(values.slice(firstNull).every((v) => v === null)).toBe(true);
    const numbers = values.filter((v): v is number => v !== null);
    expect(numbers).toEqual([...numbers].sort((x, y) => y - x));
  });

  it("pages 25 at a time with an exact count; past the end → last page", async () => {
    const q = `${PREFIX} page`;
    const page1 = await list(B, { q, sort: "name" });
    expect(page1).toMatchObject({ total: 27, page: 1, pageSize: 25, pageCount: 2 });
    expect(page1.rows).toHaveLength(25);

    const page2 = await list(B, { q, sort: "name", page: "2" });
    expect(page2.rows.map((r) => r.name)).toEqual([`${PREFIX} page 25`, `${PREFIX} page 26`]);

    const past = await list(B, { q, sort: "name", page: "99" });
    expect(past.page).toBe(2);
    expect(past.rows).toHaveLength(2);

    const none = await list(B, { q: `${PREFIX} nothing`, page: "3" });
    expect(none).toMatchObject({ total: 0, page: 1, pageCount: 1, rows: [] });
  });
});
