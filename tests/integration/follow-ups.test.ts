/**
 * Follow-ups page reads (Prompt 10) against local Supabase with RLS, as the
 * seed users Riley (rep A), Sam (rep B) and Morgan (manager M): tab counts and
 * lists match the seed, counts = list lengths, the SQL bucket (view
 * follow_up_buckets) equals the TS mirror followUpViewBucket(), needs
 * attention, sidebar badge, latest conversation snippet, and a complete →
 * completed-tab lifecycle. Run: `npm run test:integration`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FOLLOW_UP_LIST_TABS, type FollowUpListTab } from "@/lib/follow-ups";
import type { Database } from "@/lib/supabase/database.types";
import { addDaysToDateString, followUpViewBucket, orgToday } from "@/lib/time";
import type { ActionResult } from "@/server/actions/types";
import { addActivityData } from "@/server/data/activities";
import type { DataContext } from "@/server/data/context";
import {
  countNeedsAttentionData,
  getFollowUpBadgeCountData,
  getFollowUpCountsData,
  listFollowUpsData,
  listNeedsAttentionData,
} from "@/server/data/follow-up-views";
import { completeFollowUpData, createFollowUpData, rescheduleFollowUpData } from "@/server/data/follow-ups";
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
  M: {
    id: "11111111-1111-4111-8111-000000000001",
    email: "morgan.manager@example.com",
    role: "manager",
  },
  A: {
    id: "11111111-1111-4111-8111-000000000002",
    email: "riley.rep@example.com",
    role: "sales_rep",
  },
  B: {
    id: "11111111-1111-4111-8111-000000000003",
    email: "sam.rep@example.com",
    role: "sales_rep",
  },
} as const;
const PREFIX = `itest-fu-${Date.now()}`;

async function signIn(key: keyof typeof USERS): Promise<DataContext> {
  const supabase = createClient<Database>(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({
    email: USERS[key].email,
    password: PASSWORD,
  });
  if (error) throw new Error(`sign in ${key}: ${error.message}`);
  return {
    supabase: supabase as SupabaseClient<Database>,
    user: { id: USERS[key].id, role: USERS[key].role },
  };
}

function expectOk<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.data;
}

let A: DataContext;
let B: DataContext;
let M: DataContext;
let timezone: string;
const created: string[] = [];

beforeAll(async () => {
  [A, B, M] = await Promise.all([signIn("A"), signIn("B"), signIn("M")]);
  const { data } = await M.supabase.from("org_settings").select("timezone").single();
  timezone = data!.timezone;
});

afterAll(async () => {
  if (created.length > 0) await M.supabase.from("prospects").delete().in("id", created);
});

async function tab(ctx: DataContext, name: FollowUpListTab, ownerId?: string) {
  return expectOk(await listFollowUpsData(ctx, { tab: name, ownerId }));
}

async function notes(ctx: DataContext, name: FollowUpListTab, ownerId?: string) {
  return (await tab(ctx, name, ownerId)).rows.map((row) => `${row.prospect.name}: ${row.note}`);
}

describe("follow-up tabs match the seed", () => {
  it("rep A (Riley): overdue Jordan, today Priya, upcoming Tom, nothing completed", async () => {
    expect(expectOk(await getFollowUpCountsData(A))).toEqual({
      overdue: 1,
      today: 1,
      upcoming: 1,
      completed: 0,
    });
    expect(await notes(A, "overdue")).toEqual(["Jordan Lee: Send the volume pricing"]);
    expect(await notes(A, "today")).toEqual(["Priya Shah: Confirm demo attendees"]);
    expect(await notes(A, "upcoming")).toEqual(["Tom Becker: Intro call"]);
    expect(await notes(A, "completed")).toEqual([]);
    const today = (await tab(A, "today")).rows[0];
    expect(today.prospect.company).toBe("Contoso Health");
    expect(today.dueDate).toBe(orgToday(timezone));
  });

  it("rep B (Sam): overdue Aisha, upcoming Liam; a rep's owner param is ignored", async () => {
    expect(expectOk(await getFollowUpCountsData(B))).toEqual({
      overdue: 1,
      today: 0,
      upcoming: 1,
      completed: 0,
    });
    expect(await notes(B, "overdue")).toEqual(["Aisha Khan: Compare with the competitor offer"]);
    expect(await notes(B, "upcoming")).toEqual(["Liam O'Brien: Send the EUR proposal"]);
    expect(expectOk(await getFollowUpCountsData(B, { ownerId: USERS.A.id }))).toEqual(
      expectOk(await getFollowUpCountsData(B)),
    );
    expect(await notes(B, "today", USERS.A.id)).toEqual([]);
  });

  it("manager sees everyone (most overdue first) and can filter by owner", async () => {
    expect(expectOk(await getFollowUpCountsData(M))).toEqual({
      overdue: 2,
      today: 1,
      upcoming: 2,
      completed: 0,
    });
    expect(await notes(M, "overdue")).toEqual([
      "Aisha Khan: Compare with the competitor offer",
      "Jordan Lee: Send the volume pricing",
    ]);
    expect(await notes(M, "upcoming")).toEqual(["Liam O'Brien: Send the EUR proposal", "Tom Becker: Intro call"]);
    expect(expectOk(await getFollowUpCountsData(M, { ownerId: USERS.A.id }))).toEqual({
      overdue: 1,
      today: 1,
      upcoming: 1,
      completed: 0,
    });
    expect(await notes(M, "overdue", USERS.B.id)).toEqual(["Aisha Khan: Compare with the competitor offer"]);
  });

  it("counts equal the list lengths for every tab and user", async () => {
    for (const ctx of [A, B, M]) {
      const counts = expectOk(await getFollowUpCountsData(ctx));
      for (const name of FOLLOW_UP_LIST_TABS) {
        expect((await tab(ctx, name)).rows).toHaveLength(counts[name]);
      }
    }
  });

  it("sidebar badge = own overdue + today (manager: own only)", async () => {
    expect(expectOk(await getFollowUpBadgeCountData(A))).toBe(2);
    expect(expectOk(await getFollowUpBadgeCountData(B))).toBe(1);
    expect(expectOk(await getFollowUpBadgeCountData(M))).toBe(0);
  });

  it("rejects invalid input", async () => {
    const result = await listFollowUpsData(A, {
      tab: "later" as FollowUpListTab,
    });
    expect(result.ok).toBe(false);
    expect((await getFollowUpCountsData(M, { ownerId: "nope" })).ok).toBe(false);
  });
});

describe("needs attention matches the seed", () => {
  it("rep A: Marcus (stale + no follow-up)", async () => {
    const { rows, total } = expectOk(await listNeedsAttentionData(A));
    expect(rows.map((row) => [row.name, row.reasons])).toEqual([["Marcus Chen", ["stale", "no_follow_up"]]]);
    expect(total).toBe(1);
    expect(expectOk(await countNeedsAttentionData(A))).toBe(1);
  });

  it("rep B: Aisha (stale, has an overdue follow-up); closed deals never appear", async () => {
    const { rows } = expectOk(await listNeedsAttentionData(B));
    expect(rows.map((row) => [row.name, row.reasons])).toEqual([["Aisha Khan", ["stale"]]]);
    expect(rows[0].followUpDate).not.toBeNull();
  });

  it("manager: both, least recently active first; owner filter", async () => {
    const { rows } = expectOk(await listNeedsAttentionData(M));
    expect(rows.map((row) => row.name)).toEqual(["Marcus Chen", "Aisha Khan"]);
    expect(expectOk(await countNeedsAttentionData(M))).toBe(2);
    const sam = expectOk(await listNeedsAttentionData(M, { ownerId: USERS.B.id }));
    expect(sam.rows.map((row) => row.name)).toEqual(["Aisha Khan"]);
    expect(expectOk(await countNeedsAttentionData(M, { ownerId: USERS.B.id }))).toBe(1);
  });
});

describe("lifecycle + SQL/TS parity", () => {
  it("snippet, reschedule, complete → completed tab, badge, needs attention", async () => {
    const today = orgToday(timezone);
    const prospect = expectOk(
      await createProspectData(A, {
        name: `${PREFIX} Lifecycle`,
        company: "Itest Co",
      }),
    );
    created.push(prospect.id);

    // No follow-up yet → needs attention ("no_follow_up").
    let attention = expectOk(await listNeedsAttentionData(A)).rows.find((row) => row.id === prospect.id);
    expect(attention?.reasons).toEqual(["no_follow_up"]);

    expectOk(
      await addActivityData(A, {
        prospectId: prospect.id,
        type: "note",
        content: "Older note",
      }),
    );
    expectOk(
      await addActivityData(A, {
        prospectId: prospect.id,
        type: "call",
        content: "Called about the proposal",
      }),
    );
    const followUp = expectOk(
      await createFollowUpData(A, {
        prospectId: prospect.id,
        dueDate: today,
        note: "Call back",
      }),
    );

    const todayRow = (await tab(A, "today")).rows.find((row) => row.id === followUp.id);
    expect(todayRow?.lastConversation).toMatchObject({
      type: "call",
      snippet: "Called about the proposal",
    });
    expect(expectOk(await getFollowUpBadgeCountData(A))).toBe(3);
    attention = expectOk(await listNeedsAttentionData(A)).rows.find((row) => row.id === prospect.id);
    expect(attention).toBeUndefined();

    // Reschedule into the upcoming window, then back to today.
    expectOk(
      await rescheduleFollowUpData(A, {
        followUpId: followUp.id,
        dueDate: addDaysToDateString(today, 7),
      }),
    );
    expect((await tab(A, "upcoming")).rows.some((row) => row.id === followUp.id)).toBe(true);
    expectOk(
      await rescheduleFollowUpData(A, {
        followUpId: followUp.id,
        dueDate: addDaysToDateString(today, 8),
      }),
    );
    for (const name of FOLLOW_UP_LIST_TABS) {
      expect((await tab(A, name)).rows.some((row) => row.id === followUp.id)).toBe(false); // "later": no tab
    }
    expectOk(
      await rescheduleFollowUpData(A, {
        followUpId: followUp.id,
        dueDate: today,
      }),
    );

    expectOk(await completeFollowUpData(A, { followUpId: followUp.id, note: "Done" }));
    const completed = (await tab(A, "completed")).rows;
    expect(completed.map((row) => row.id)).toContain(followUp.id);
    expect(completed.find((row) => row.id === followUp.id)?.completedBy).toBe(USERS.A.id);
    expect(expectOk(await getFollowUpCountsData(A))).toEqual({
      overdue: 1,
      today: 1,
      upcoming: 1,
      completed: 1,
    });
    expect(expectOk(await getFollowUpBadgeCountData(A))).toBe(2);
    // Rep B never sees it; the manager does.
    expect((await tab(B, "completed")).rows).toEqual([]);
    expect((await tab(M, "completed")).rows.map((row) => row.id)).toContain(followUp.id);
  });

  it("the SQL bucket equals followUpViewBucket() for every visible follow-up", async () => {
    const { data, error } = await M.supabase
      .from("follow_up_buckets")
      .select("id, status, due_date, completed_at, bucket");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    const now = new Date();
    for (const row of data!) {
      expect(
        followUpViewBucket(
          {
            status: row.status!,
            dueDate: row.due_date!,
            completedAt: row.completed_at,
          },
          timezone,
          now,
        ),
      ).toBe(row.bucket);
    }
  });
});
