/**
 * Data layer (Prompt 5) against local Supabase with RLS, as the seed users:
 * rep A (Riley), rep B (Sam) and manager M (Morgan). Run: `npm run test:integration`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";
import { orgLocalToUtc } from "@/lib/time";
import type { ActionResult } from "@/server/actions/types";
import { addActivityData } from "@/server/data/activities";
import type { DataContext } from "@/server/data/context";
import { logDemoAttendedData, setDemoDetailsData } from "@/server/data/demo";
import {
  completeAllPendingFollowUpsData,
  completeFollowUpData,
  createFollowUpData,
  deleteFollowUpData,
  rescheduleFollowUpData,
} from "@/server/data/follow-ups";
import {
  createProspectData,
  deleteProspectData,
  moveProspectStageData,
  reassignProspectData,
  updateProspectData,
} from "@/server/data/prospects";

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
const PREFIX = `itest-${Date.now()}`;

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

function expectErr<T>(result: ActionResult<T>, pattern?: RegExp): string {
  expect(result.ok).toBe(false);
  const error = result.ok ? "" : result.error;
  if (pattern) expect(error).toMatch(pattern);
  return error;
}

let A: DataContext;
let B: DataContext;
let M: DataContext;
let timezone: string;
let defaultCurrency: string;
const created: string[] = [];

beforeAll(async () => {
  [A, B, M] = await Promise.all([signIn("A"), signIn("B"), signIn("M")]);
  const { data, error } = await A.supabase.from("org_settings").select("timezone, default_currency").single();
  if (error) throw error;
  timezone = data.timezone;
  defaultCurrency = data.default_currency.trim();
});

afterAll(async () => {
  if (created.length > 0) await M.supabase.from("prospects").delete().in("id", created);
});

async function newProspect(ctx: DataContext, name: string, extra: Record<string, unknown> = {}) {
  const row = expectOk(await createProspectData(ctx, { name: `${PREFIX} ${name}`, ...extra }));
  created.push(row.id);
  return row;
}

describe("prospects", () => {
  it("createProspect: owner defaults to the current user, currency to the org default", async () => {
    const row = await newProspect(A, "defaults", { objections: ["price", "price", "timing"], dealValue: "1000.5" });
    expect(row.owner_id).toBe(USERS.A.id);
    expect(row.created_by).toBe(USERS.A.id);
    expect(row.currency.trim()).toBe(defaultCurrency);
    expect(row.stage).toBe("prospect");
    expect(row.objections).toEqual(["price", "timing"]);
    expect(Number(row.deal_value)).toBe(1000.5);
  });

  it("createProspect: reps can't assign another owner, managers can", async () => {
    expectErr(await createProspectData(A, { name: `${PREFIX} x`, ownerId: USERS.B.id }), /only managers/i);
    const own = await newProspect(A, "own owner id", { ownerId: USERS.A.id });
    expect(own.owner_id).toBe(USERS.A.id);
    const forB = await newProspect(M, "manager → B", { ownerId: USERS.B.id, currency: "eur" });
    expect(forB.owner_id).toBe(USERS.B.id);
    expect(forB.currency).toBe("EUR");
    expectErr(
      await createProspectData(M, { name: `${PREFIX} ghost`, ownerId: "22222222-2222-4222-8222-222222222222" }),
      /owner not found/i,
    );
  });

  it("updateProspect: edits allowed fields, rejects stage/owner/derived fields, RLS hides other reps' rows", async () => {
    const row = await newProspect(A, "update");
    const updated = expectOk(
      await updateProspectData(A, { prospectId: row.id, email: "Buyer@Acme.com", decisionMakerStatus: "yes", notes: "n" }),
    );
    expect(updated).toMatchObject({ email: "buyer@acme.com", decision_maker_status: "yes", notes: "n" });
    const cleared = expectOk(await updateProspectData(A, { prospectId: row.id, notes: "" }));
    expect(cleared.notes).toBeNull();
    expect(cleared.email).toBe("buyer@acme.com"); // untouched

    for (const key of ["stage", "ownerId", "closeReason", "lastActivityAt", "followUpDate"]) {
      expectErr(await updateProspectData(A, { prospectId: row.id, name: "x", [key]: "x" } as never));
    }
    expectErr(await updateProspectData(B, { prospectId: row.id, notes: "hijack" }), /not found/i);
  });

  it("moveProspectStage: forward, skip, backward, same-stage no-op, close with note, reopen", async () => {
    const row = await newProspect(A, "stages");
    const step = async (input: Parameters<typeof moveProspectStageData>[1]) =>
      expectOk(await moveProspectStageData(A, input));

    expect((await step({ prospectId: row.id, toStage: "contacted" })).changed).toBe(true);
    expect((await step({ prospectId: row.id, toStage: "demo_booked", note: "skip ahead" })).changed).toBe(true);
    expect((await step({ prospectId: row.id, toStage: "conversation" })).changed).toBe(true); // backward
    const same = await step({ prospectId: row.id, toStage: "conversation" });
    expect(same.changed).toBe(false);

    expectErr(
      await moveProspectStageData(A, { prospectId: row.id, toStage: "closed_lost", closeReason: "product_fit" }),
      /lost reason/i,
    );
    expectErr(await moveProspectStageData(A, { prospectId: row.id, toStage: "closed_won" }), /close reason/i);

    const won = await step({
      prospectId: row.id,
      toStage: "closed_won",
      closeReason: "product_fit",
      closeNotes: "Signed",
      note: "Great call",
    });
    expect(won.prospect).toMatchObject({ stage: "closed_won", close_reason: "product_fit", close_notes: "Signed" });
    expect(won.prospect.closed_at).not.toBeNull();

    const reopened = await step({ prospectId: row.id, toStage: "follow_up" });
    expect(reopened.prospect).toMatchObject({ stage: "follow_up", close_reason: null, close_notes: null, closed_at: null });

    const { data: history } = await A.supabase
      .from("stage_history")
      .select("from_stage, to_stage, changed_by, close_reason, note")
      .eq("prospect_id", row.id)
      .order("changed_at");
    expect(history?.map((h) => h.to_stage)).toEqual([
      "prospect",
      "contacted",
      "demo_booked",
      "conversation",
      "closed_won",
      "follow_up",
    ]);
    expect(history?.[2].note).toBe("skip ahead");
    expect(history?.[4]).toMatchObject({ close_reason: "product_fit", note: "Great call", changed_by: USERS.A.id });

    const { data: activities } = await A.supabase
      .from("activities")
      .select("type, content, user_id")
      .eq("prospect_id", row.id)
      .eq("type", "stage_change");
    expect(activities).toHaveLength(5);
    expect(activities?.some((a) => a.content === "Great call" && a.user_id === USERS.A.id)).toBe(true);

    expectErr(await moveProspectStageData(B, { prospectId: row.id, toStage: "qualified" }), /not found/i);
  });

  it("reassignProspect: managers only; logs owner_change and moves pending follow-ups", async () => {
    const row = await newProspect(A, "reassign");
    const fu = expectOk(await createFollowUpData(A, { prospectId: row.id, dueDate: "2030-01-01", note: "call" }));
    expect(fu.owner_id).toBe(USERS.A.id);

    expectErr(await reassignProspectData(A, { prospectId: row.id, ownerId: USERS.B.id }), /only managers/i);
    // Even bypassing the role check, the DB refuses a rep's owner change.
    const { error } = await A.supabase.from("prospects").update({ owner_id: USERS.B.id }).eq("id", row.id);
    expect(error?.code).toBe("42501");

    expectErr(
      await reassignProspectData(M, { prospectId: row.id, ownerId: "22222222-2222-4222-8222-222222222222" }),
      /user not found/i,
    );
    const moved = expectOk(await reassignProspectData(M, { prospectId: row.id, ownerId: USERS.B.id }));
    expect(moved.owner_id).toBe(USERS.B.id);
    expectOk(await reassignProspectData(M, { prospectId: row.id, ownerId: USERS.B.id })); // same owner: no-op

    const { data: fuAfter } = await B.supabase.from("follow_ups").select("owner_id").eq("id", fu.id).single();
    expect(fuAfter?.owner_id).toBe(USERS.B.id);
    const { data: ownerChanges } = await M.supabase
      .from("activities")
      .select("user_id, metadata")
      .eq("prospect_id", row.id)
      .eq("type", "owner_change");
    expect(ownerChanges).toHaveLength(1);
    expect(ownerChanges?.[0].user_id).toBe(USERS.M.id);
    // A no longer sees it.
    expectErr(await updateProspectData(A, { prospectId: row.id, notes: "x" }), /not found/i);
  });

  it("deleteProspect: managers only", async () => {
    const row = await newProspect(A, "delete");
    expectErr(await deleteProspectData(A, { prospectId: row.id }), /only managers/i);
    // RLS also blocks a direct rep delete (0 rows).
    const { data } = await A.supabase.from("prospects").delete().eq("id", row.id).select("id");
    expect(data).toEqual([]);
    expect(expectOk(await deleteProspectData(M, { prospectId: row.id })).id).toBe(row.id);
    expectErr(await deleteProspectData(M, { prospectId: row.id }), /not found/i);
  });
});

describe("activities", () => {
  it("addActivity: manual types, bumps last_activity_at, rejects the future and other reps' prospects", async () => {
    const row = await newProspect(A, "activities");
    const before = new Date(row.last_activity_at).getTime();
    const activity = expectOk(await addActivityData(A, { prospectId: row.id, type: "call", content: "Intro call" }));
    expect(activity).toMatchObject({ type: "call", content: "Intro call", user_id: USERS.A.id });
    const { data: after } = await A.supabase.from("prospects").select("last_activity_at").eq("id", row.id).single();
    expect(new Date(after!.last_activity_at).getTime()).toBeGreaterThanOrEqual(before);

    const past = expectOk(
      await addActivityData(A, { prospectId: row.id, type: "note", content: "old", occurredAt: "2026-01-01T12:00:00Z" }),
    );
    expect(past.occurred_at).toMatch(/^2026-01-01T12:00:00/);

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expectErr(await addActivityData(A, { prospectId: row.id, type: "note", content: "x", occurredAt: future }), /future/i);
    expectErr(await addActivityData(A, { prospectId: row.id, type: "stage_change" as never, content: "x" }));
    expectErr(await addActivityData(B, { prospectId: row.id, type: "note", content: "x" }), /not found/i);
  });
});

describe("follow-ups", () => {
  it("create (owner = prospect owner), reschedule, complete (+ activity), delete", async () => {
    const row = await newProspect(M, "follow-ups for A", { ownerId: USERS.A.id });
    // Manager creates it; the owner is still the prospect's owner (A).
    const fu = expectOk(await createFollowUpData(M, { prospectId: row.id, dueDate: "2030-01-10", note: "Send deck" }));
    expect(fu).toMatchObject({ owner_id: USERS.A.id, status: "pending", created_by: USERS.M.id });
    const { data: p1 } = await A.supabase.from("prospects").select("follow_up_date").eq("id", row.id).single();
    expect(p1?.follow_up_date).toBe("2030-01-10");

    expectErr(await createFollowUpData(B, { prospectId: row.id, dueDate: "2030-01-10", note: "x" }), /not found/i);

    const moved = expectOk(await rescheduleFollowUpData(A, { followUpId: fu.id, dueDate: "2030-01-05" }));
    expect(moved.due_date).toBe("2030-01-05");
    expectErr(await rescheduleFollowUpData(B, { followUpId: fu.id, dueDate: "2030-01-06" }), /not found/i);

    const done = expectOk(await completeFollowUpData(A, { followUpId: fu.id, note: "Deck sent" }));
    expect(done).toMatchObject({ status: "completed", completed_by: USERS.A.id });
    expect(done.completed_at).not.toBeNull();
    expectErr(await completeFollowUpData(A, { followUpId: fu.id }), /already completed/i);
    expectErr(await rescheduleFollowUpData(A, { followUpId: fu.id, dueDate: "2030-02-01" }), /already completed/i);

    const { data: logged } = await A.supabase
      .from("activities")
      .select("type, content, user_id, metadata")
      .eq("prospect_id", row.id)
      .eq("type", "follow_up");
    expect(logged).toHaveLength(1);
    expect(logged?.[0]).toMatchObject({ content: "Deck sent", user_id: USERS.A.id });
    const { data: p2 } = await A.supabase.from("prospects").select("follow_up_date").eq("id", row.id).single();
    expect(p2?.follow_up_date).toBeNull();

    const fu2 = expectOk(await createFollowUpData(A, { prospectId: row.id, dueDate: "2030-03-01", note: "Check in" }));
    expectErr(await deleteFollowUpData(B, { followUpId: fu2.id }), /not found/i);
    expect(expectOk(await deleteFollowUpData(A, { followUpId: fu2.id })).prospectId).toBe(row.id);
  });

  it("completeAllPendingFollowUps (close flow)", async () => {
    const row = await newProspect(A, "complete all");
    for (const dueDate of ["2030-04-01", "2030-04-02"]) {
      expectOk(await createFollowUpData(A, { prospectId: row.id, dueDate, note: `task ${dueDate}` }));
    }
    expectErr(await completeAllPendingFollowUpsData(B, { prospectId: row.id }), /not found/i);
    expect(expectOk(await completeAllPendingFollowUpsData(A, { prospectId: row.id })).completed).toBe(2);
    expect(expectOk(await completeAllPendingFollowUpsData(A, { prospectId: row.id })).completed).toBe(0);
    const { data: pending } = await A.supabase
      .from("follow_ups")
      .select("id")
      .eq("prospect_id", row.id)
      .eq("status", "pending");
    expect(pending).toEqual([]);
    const { data: logged } = await A.supabase
      .from("activities")
      .select("content")
      .eq("prospect_id", row.id)
      .eq("type", "follow_up");
    expect(logged?.map((a) => a.content).sort()).toEqual(["task 2030-04-01", "task 2030-04-02"]);
  });
});

describe("demo", () => {
  it("setDemoDetails converts org-local date + time to UTC and adds a follow-up", async () => {
    const row = await newProspect(A, "demo");
    const result = expectOk(
      await setDemoDetailsData(
        A,
        { prospectId: row.id, demoDate: "2030-01-15", demoTime: "14:30", followUp: { dueDate: "2030-01-16", note: "Follow up after demo" } },
        timezone,
      ),
    );
    expect(new Date(result.prospect.demo_at!).toISOString()).toBe(
      orgLocalToUtc("2030-01-15", "14:30", timezone).toISOString(),
    );
    expect(result.prospect.stage).toBe("prospect"); // never changes the stage
    expect(result.followUp).toMatchObject({ due_date: "2030-01-16", owner_id: USERS.A.id });

    expectErr(
      await setDemoDetailsData(B, { prospectId: row.id, demoDate: "2030-01-15", demoTime: "10:00" }, timezone),
      /not found/i,
    );
  });

  it("logDemoAttended creates a demo activity and an optional follow-up", async () => {
    const row = await newProspect(A, "demo attended");
    const result = expectOk(
      await logDemoAttendedData(A, {
        prospectId: row.id,
        notes: "Loved the reporting",
        followUp: { dueDate: "2030-02-01", note: "Send proposal" },
      }),
    );
    expect(result.activity).toMatchObject({ type: "demo", content: "Loved the reporting", user_id: USERS.A.id });
    expect(result.followUp?.owner_id).toBe(USERS.A.id);
    const empty = expectOk(await logDemoAttendedData(A, { prospectId: row.id }));
    expect(empty.activity.content).toBe("Demo attended");
    expectErr(await logDemoAttendedData(B, { prospectId: row.id, notes: "x" }), /not found/i);
  });
});
