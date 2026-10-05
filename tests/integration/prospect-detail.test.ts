/**
 * Prospect detail reads (Prompt 8) against local Supabase with RLS, as Riley
 * (rep A), Sam (rep B) and Morgan (manager M). Run: `npm run test:integration`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";
import { buildTimeline } from "@/lib/timeline";
import type { ActionResult } from "@/server/actions/types";
import { addActivityData } from "@/server/data/activities";
import type { DataContext } from "@/server/data/context";
import { completeFollowUpData, createFollowUpData } from "@/server/data/follow-ups";
import {
  getProspectDetailData,
  listProspectActivitiesData,
  listProspectFollowUpsData,
  listProspectStageHistoryData,
  listTeamData,
} from "@/server/data/prospect-detail";
import { createProspectData, moveProspectStageData, reassignProspectData } from "@/server/data/prospects";

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
const PREFIX = `itest-detail-${Date.now()}`;

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

let A: DataContext;
let B: DataContext;
let M: DataContext;
let prospectId: string;

beforeAll(async () => {
  [A, B, M] = await Promise.all([signIn("A"), signIn("B"), signIn("M")]);
  const row = expectOk(await createProspectData(A, { name: `${PREFIX} Detail` }));
  prospectId = row.id;
});

afterAll(async () => {
  if (prospectId) await M.supabase.from("prospects").delete().eq("id", prospectId);
});

describe("prospect detail reads", () => {
  it("owner and manager see the prospect (with flags); another rep gets null; bad ids → null", async () => {
    const own = expectOk(await getProspectDetailData(A, prospectId));
    expect(own).toMatchObject({ id: prospectId, stage: "prospect", is_stale: false, has_overdue_follow_up: false });
    expect(expectOk(await getProspectDetailData(M, prospectId))?.id).toBe(prospectId);
    expect(expectOk(await getProspectDetailData(B, prospectId))).toBeNull();
    expect(expectOk(await getProspectDetailData(A, "not-a-uuid"))).toBeNull();
    expect(expectOk(await getProspectDetailData(A, "99999999-9999-4999-8999-999999999999"))).toBeNull();
  });

  it("another rep reads no activities, history or follow-ups (RLS)", async () => {
    expect(expectOk(await listProspectActivitiesData(B, prospectId)).rows).toEqual([]);
    expect(expectOk(await listProspectStageHistoryData(B, prospectId))).toEqual([]);
    expect(expectOk(await listProspectFollowUpsData(B, prospectId))).toEqual({ pending: [], completed: [] });
  });

  it("timeline: stage moves (incl. close + reopen), reassignment and activities with authors", async () => {
    expectOk(await moveProspectStageData(A, { prospectId, toStage: "qualified" })); // skip
    expectOk(await moveProspectStageData(A, { prospectId, toStage: "contacted", note: "Back a step" })); // backward
    expectOk(await moveProspectStageData(A, { prospectId, toStage: "closed_lost", closeReason: "price" }));
    expectOk(await moveProspectStageData(A, { prospectId, toStage: "follow_up" })); // reopen
    expectOk(await addActivityData(A, { prospectId, type: "call", content: "Called about pricing" }));
    expectOk(await reassignProspectData(M, { prospectId, ownerId: USERS.B.id }));

    // Riley lost access after the reassignment; Sam (new owner) and Morgan see everything.
    expect(expectOk(await getProspectDetailData(A, prospectId))).toBeNull();
    const [activities, history, team] = await Promise.all([
      listProspectActivitiesData(B, prospectId),
      listProspectStageHistoryData(B, prospectId),
      listTeamData(B),
    ]);
    const { rows, truncated } = expectOk(activities);
    expect(truncated).toBe(false);
    const entries = buildTimeline({ activities: rows, stageHistory: expectOk(history), users: expectOk(team) });

    expect(entries.map((e) => e.type)).toEqual([
      "owner_change",
      "call",
      "stage_change",
      "stage_change",
      "stage_change",
      "stage_change",
      "created",
    ]);
    expect(entries[0]).toMatchObject({
      authorName: "Morgan Manager",
      detail: { kind: "owner_change", fromName: "Riley Rep", toName: "Sam Rep" },
    });
    expect(entries[1]).toMatchObject({ authorName: "Riley Rep", content: "Called about pricing" });
    expect(entries.slice(2, 6).map((e) => e.detail)).toEqual([
      { kind: "stage_change", from: "closed_lost", to: "follow_up", closeReason: null },
      { kind: "stage_change", from: "contacted", to: "closed_lost", closeReason: "Price" },
      { kind: "stage_change", from: "qualified", to: "contacted", closeReason: null },
      { kind: "stage_change", from: "prospect", to: "qualified", closeReason: null },
    ]);
    expect(entries[4].content).toBe("Back a step");
    expect(entries.slice(2, 7).every((e) => e.authorName === "Riley Rep")).toBe(true);
  });

  it("follow-ups split into pending (due asc) and completed", async () => {
    const later = expectOk(await createFollowUpData(M, { prospectId, dueDate: "2099-01-02", note: "Later" }));
    const sooner = expectOk(await createFollowUpData(M, { prospectId, dueDate: "2099-01-01", note: "Sooner" }));
    const done = expectOk(await createFollowUpData(M, { prospectId, dueDate: "2099-01-03", note: "Done" }));
    expectOk(await completeFollowUpData(B, { followUpId: done.id }));

    const { pending, completed } = expectOk(await listProspectFollowUpsData(B, prospectId));
    expect(pending.map((f) => f.id)).toEqual([sooner.id, later.id]);
    expect(completed.map((f) => f.id)).toEqual([done.id]);
    expect(completed[0].completed_by).toBe(USERS.B.id);
    expect(expectOk(await getProspectDetailData(B, prospectId))?.follow_up_date).toBe("2099-01-01");
  });
});
