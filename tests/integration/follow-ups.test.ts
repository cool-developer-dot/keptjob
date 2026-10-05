/**
 * Follow-ups page reads (Prompt 10) against local Supabase with RLS, as the
 * seed users Riley (rep A), Sam (rep B) and Morgan (manager M): tab counts and
 * lists match the seed (hand-computed from supabase/seed.sql), counts = list lengths, the SQL bucket (view
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
  // Seed (supabase/seed.sql), due dates relative to org_today(). Pending tabs:
  // due date asc, then created_at; completed: newest completion first.
  it("rep A (Riley): 3 overdue, 2 today, 8 upcoming, 6 completed in the last 30 days", async () => {
    expect(expectOk(await getFollowUpCountsData(A))).toEqual({
      overdue: 3,
      today: 2,
      upcoming: 8,
      completed: 6,
    });
    expect(await notes(A, "overdue")).toEqual([
      "James O'Connor: Call back about budget approval",
      "Owen Fischer: Chase the signed order form",
      "Jordan Lee: Send the volume pricing",
    ]);
    expect(await notes(A, "today")).toEqual(["Grace Kim: Send the proposal draft", "Priya Shah: Confirm demo attendees"]);
    expect(await notes(A, "upcoming")).toEqual([
      "Noah Patel: Send a quote for both wineries",
      "Olivia Novak: Call Olivia for a decision",
      "Ryan Cooper: Intro call",
      "Hannah Brooks: Send case study and book a discovery call",
      "Chloe Martin: Book the demo",
      "Tom Becker: Intro call",
      "Ava Thompson: Follow up after demo",
      "Zoe Clarke: Send the mobile walkthrough video", // today + 7: last upcoming day
    ]);
    // Completed 5–25 days ago; Benjamin's (45 days ago) is outside the 30-day window.
    expect(await notes(A, "completed")).toEqual([
      "Elena García: Chase the signed order form",
      "Priya Shah: Send the clinic case study",
      "Jordan Lee: Book a discovery call",
      "Lucas Silva: Follow up on the prepay offer",
      "Elena García: Send proposal and order form",
      "Olivia Novak: Send the proposal",
    ]);
    const priya = (await tab(A, "today")).rows[1];
    expect(priya.prospect.company).toBe("Contoso Health");
    expect(priya.dueDate).toBe(orgToday(timezone));
    // Diego's follow-up (today + 12) is "later": in no tab.
    for (const name of FOLLOW_UP_LIST_TABS) {
      expect((await tab(A, name)).rows.some((row) => row.prospect.name === "Diego Alvarez")).toBe(false);
    }
  });

  it("rep B (Sam): own follow-ups only; a rep's owner param is ignored", async () => {
    expect(expectOk(await getFollowUpCountsData(B))).toEqual({
      overdue: 3,
      today: 2,
      upcoming: 6,
      completed: 3,
    });
    expect(await notes(B, "overdue")).toEqual([
      "Kenji Tanaka: Return the security questionnaire",
      "Aisha Khan: Compare with the competitor offer",
      "Leah Cohen: Share the dental practice case study",
    ]);
    expect(await notes(B, "today")).toEqual([
      "Ahmed Saleh: Send the next-quarter start proposal",
      "Fatima Haddad: Intro call",
    ]);
    expect(await notes(B, "upcoming")).toEqual([
      "Liam O'Brien: Send the EUR proposal",
      "Sophie Laurent: Send the ROI comparison",
      "Laura Bianchi: Follow up after demo",
      "Megan Lewis: Rebook the demo with the CTO",
      "Daniel Weber: Send an overview for the dean",
      "Rachel Adler: Negotiate multi-year terms",
    ]);
    expect(await notes(B, "completed")).toEqual([
      "Thomas Berg: Send the contract",
      "Victor Ivanov: Send the order form",
      "Rachel Adler: Send the proposal",
    ]);
    expect(expectOk(await getFollowUpCountsData(B, { ownerId: USERS.A.id }))).toEqual(
      expectOk(await getFollowUpCountsData(B)),
    );
    expect(await notes(B, "today", USERS.A.id)).toEqual(await notes(B, "today"));
  });

  it("manager sees everyone (most overdue first) and can filter by owner", async () => {
    expect(expectOk(await getFollowUpCountsData(M))).toEqual({
      overdue: 6,
      today: 4,
      upcoming: 14,
      completed: 9,
    });
    expect(await notes(M, "overdue")).toEqual([
      "Kenji Tanaka: Return the security questionnaire",
      "Aisha Khan: Compare with the competitor offer",
      "James O'Connor: Call back about budget approval",
      "Owen Fischer: Chase the signed order form",
      "Leah Cohen: Share the dental practice case study",
      "Jordan Lee: Send the volume pricing",
    ]);
    expect(expectOk(await getFollowUpCountsData(M, { ownerId: USERS.A.id }))).toEqual({
      overdue: 3,
      today: 2,
      upcoming: 8,
      completed: 6,
    });
    expect(await notes(M, "overdue", USERS.B.id)).toEqual(await notes(B, "overdue"));
    expect(await notes(M, "upcoming", USERS.A.id)).toEqual(await notes(A, "upcoming"));
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
    expect(expectOk(await getFollowUpBadgeCountData(A))).toBe(5);
    expect(expectOk(await getFollowUpBadgeCountData(B))).toBe(5);
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
  it("rep A: Marcus (stale + no follow-up), James (stale), Ethan (no follow-up)", async () => {
    const { rows, total } = expectOk(await listNeedsAttentionData(A));
    expect(rows.map((row) => [row.name, row.reasons])).toEqual([
      ["Marcus Chen", ["stale", "no_follow_up"]],
      ["James O'Connor", ["stale"]],
      ["Ethan Wright", ["no_follow_up"]],
    ]);
    expect(total).toBe(3);
    expect(expectOk(await countNeedsAttentionData(A))).toBe(3);
  });

  it("rep B: stale deals (with or without a follow-up) and no-follow-up deals; closed deals never appear", async () => {
    const { rows } = expectOk(await listNeedsAttentionData(B));
    expect(rows.map((row) => [row.name, row.reasons])).toEqual([
      ["Hiro Sato", ["stale", "no_follow_up"]],
      ["Aisha Khan", ["stale"]],
      ["Leah Cohen", ["stale"]],
      ["Paul Schneider", ["no_follow_up"]],
    ]);
    expect(rows[1].followUpDate).not.toBeNull();
    expect(rows.every((row) => !row.stage.startsWith("closed"))).toBe(true);
  });

  it("manager: everyone, least recently active first; owner filter", async () => {
    const { rows } = expectOk(await listNeedsAttentionData(M));
    expect(rows.map((row) => row.name)).toEqual([
      "Marcus Chen",
      "Hiro Sato",
      "Aisha Khan",
      "James O'Connor",
      "Leah Cohen",
      "Ethan Wright",
      "Paul Schneider",
    ]);
    expect(expectOk(await countNeedsAttentionData(M))).toBe(7);
    const sam = expectOk(await listNeedsAttentionData(M, { ownerId: USERS.B.id }));
    expect(sam.rows.map((row) => row.name)).toEqual(["Hiro Sato", "Aisha Khan", "Leah Cohen", "Paul Schneider"]);
    expect(expectOk(await countNeedsAttentionData(M, { ownerId: USERS.B.id }))).toBe(4);
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
    expect(expectOk(await getFollowUpBadgeCountData(A))).toBe(6);
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
      overdue: 3,
      today: 2,
      upcoming: 8,
      completed: 7,
    });
    expect(expectOk(await getFollowUpBadgeCountData(A))).toBe(5);
    // Rep B never sees it; the manager does.
    const samCompleted = (await tab(B, "completed")).rows;
    expect(samCompleted.map((row) => row.id)).not.toContain(followUp.id);
    expect(samCompleted.every((row) => row.ownerId === USERS.B.id)).toBe(true);
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
