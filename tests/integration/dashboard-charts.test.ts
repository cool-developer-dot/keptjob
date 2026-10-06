/**
 * Dashboard charts (getDashboardChartsData) against local Supabase + seed:
 * shapes, RLS / owner scoping, and the numbers vs hand-written SQL (psql as postgres).
 * Run with: npm run test:integration (needs `npx supabase start` + seed).
 */
import { execFileSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { OPEN_STAGES } from "@/lib/constants";
import type { Database } from "@/lib/supabase/database.types";
import type { ActionResult } from "@/server/actions/types";
import type { DataContext } from "@/server/data/context";
import { DAILY_ACTIVITY_DAYS, getDashboardChartsData, WEEKLY_FLOW_WEEKS } from "@/server/data/dashboard-charts";

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

function sqlValue(query: string): number {
  const out = execFileSync("psql", [DB_URL, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", query], {
    encoding: "utf8",
  });
  return Number(out.trim());
}

const HUMAN = `('call','conversation','note','demo','follow_up','stage_change')`;
const activitySql = (owner: string | null) => `
  select count(*) from activities a join prospects p on p.id = a.prospect_id, org_settings s
  where s.id and a.type in ${HUMAN}
    and (a.occurred_at at time zone s.timezone)::date between org_today() - ${DAILY_ACTIVITY_DAYS - 1} and org_today()
    ${owner ? `and p.owner_id = '${owner}'` : ""}`;

describe("getDashboardChartsData", () => {
  it("rep: own numbers only, no team, shapes are zero-filled", async () => {
    const ctx = await signIn("A");
    const charts = expectOk(await getDashboardChartsData(ctx, { ownerId: USERS.B.id }));
    expect(charts.team).toBeNull();
    expect(charts.activity).toHaveLength(DAILY_ACTIVITY_DAYS);
    expect(charts.flow).toHaveLength(WEEKLY_FLOW_WEEKS);
    expect(charts.stages.map((row) => row.stage)).toEqual([...OPEN_STAGES]);
    // The spoofed owner is ignored: Riley's own activity, matching hand-written SQL.
    const total = charts.activity.reduce((sum, point) => sum + point.count, 0);
    expect(total).toBe(sqlValue(activitySql(USERS.A.id)));
    const open = charts.stages.reduce((sum, row) => sum + row.count, 0);
    expect(open).toBe(
      sqlValue(`select count(*) from prospects where owner_id = '${USERS.A.id}' and stage not in ('closed_won','closed_lost')`),
    );
  });

  it("manager (all): team activity and one card per sales rep", async () => {
    const ctx = await signIn("M");
    const charts = expectOk(await getDashboardChartsData(ctx, {}));
    expect(charts.activity.reduce((sum, point) => sum + point.count, 0)).toBe(sqlValue(activitySql(null)));
    expect(charts.team?.map((member) => member.name).sort()).toEqual(["Riley Rep", "Sam Rep"]);
    for (const member of charts.team ?? []) {
      expect(member.open).toBe(
        sqlValue(
          `select count(*) from prospects where owner_id = '${member.userId}' and stage not in ('closed_won','closed_lost')`,
        ),
      );
      expect(member.overdue).toBe(
        sqlValue(
          `select count(*) from follow_ups where owner_id = '${member.userId}' and status = 'pending' and due_date < org_today()`,
        ),
      );
    }
  });

  it("manager filtered to a rep: that rep's numbers, no team cards", async () => {
    const ctx = await signIn("M");
    const charts = expectOk(await getDashboardChartsData(ctx, { ownerId: USERS.B.id }));
    expect(charts.team).toBeNull();
    expect(charts.activity.reduce((sum, point) => sum + point.count, 0)).toBe(sqlValue(activitySql(USERS.B.id)));
    const won = charts.flow.reduce((sum, week) => sum + week.won, 0);
    expect(won).toBe(
      sqlValue(`select count(*) from prospects p, org_settings s where s.id and p.owner_id = '${USERS.B.id}'
        and p.stage = 'closed_won'
        and (p.closed_at at time zone s.timezone)::date between org_today() - ${WEEKLY_FLOW_WEEKS * 7 - 1} and org_today()`),
    );
  });
});
