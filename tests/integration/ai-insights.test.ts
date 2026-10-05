/**
 * AI insights (Prompt 11) against local Supabase with RLS, using the
 * deterministic fake AI client (no OpenAI key needed). Riley (rep A), Sam
 * (rep B), Morgan (manager M). Run: `npm run test:integration`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getAiClient } from "@/lib/ai/client";
import { AI_MESSAGES } from "@/lib/ai/insights";
import { AI_RATE_LIMIT, FAKE_AI_MODEL } from "@/lib/ai/limits";
import type { Database } from "@/lib/supabase/database.types";
import type { ActionResult } from "@/server/actions/types";
import { addActivityData } from "@/server/data/activities";
import { generateInsightData, listProspectInsightsData, type GenerateInsightDeps } from "@/server/data/ai-insights";
import type { DataContext } from "@/server/data/context";
import { MESSAGES } from "@/server/data/errors";
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
const PREFIX = `itest-ai-${Date.now()}`;

/** The fake client, selected exactly like the app does with AI_FAKE=1 outside production. */
const FAKE: GenerateInsightDeps = { getAiClient: () => getAiClient({ AI_FAKE: "1", NODE_ENV: "test" }) };

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
const created: string[] = [];
let prospectId: string;

beforeAll(async () => {
  [A, B, M] = await Promise.all([signIn("A"), signIn("B"), signIn("M")]);
  const row = expectOk(
    await createProspectData(A, {
      name: `${PREFIX} Jordan`,
      company: "Acme",
      objections: ["price"],
      notes: "Wants a 5-seat pilot.",
    }),
  );
  prospectId = row.id;
  created.push(row.id);
  expectOk(await addActivityData(A, { prospectId, type: "call", content: "Discussed pricing for the pilot." }));
});

afterAll(async () => {
  // Deleting the prospects cascades their insights (so the reps' rate-limit windows are freed too).
  if (created.length > 0) await M.supabase.from("prospects").delete().in("id", created);
});

describe("generateInsightData (fake AI, local Supabase)", () => {
  it("rep generates on own prospect: ai_insights row + ai_insight activity; prospect untouched", async () => {
    const before = (await A.supabase.from("prospects").select("*").eq("id", prospectId).single()).data!;

    const insight = expectOk(await generateInsightData(A, { prospectId }, FAKE));
    expect(insight).toMatchObject({
      prospect_id: prospectId,
      model: FAKE_AI_MODEL,
      created_by: USERS.A.id,
      decision_maker_status: "yes", // fake: recorded Unknown → suggests Yes
      main_objection: "Price",
      author_name: "Riley Rep",
    });
    expect(insight.summary).toContain(`${PREFIX} Jordan`);

    const { data: activities } = await A.supabase
      .from("activities")
      .select("type, content, metadata, user_id")
      .eq("prospect_id", prospectId)
      .eq("type", "ai_insight");
    expect(activities).toEqual([
      {
        type: "ai_insight",
        content: insight.summary,
        metadata: { insight_id: insight.id, deal_health: insight.deal_health },
        user_id: USERS.A.id,
      },
    ]);

    // Nothing written to the prospect: every column (incl. last_activity_at, updated_at) unchanged.
    const after = (await A.supabase.from("prospects").select("*").eq("id", prospectId).single()).data!;
    expect(after).toEqual(before);
  });

  it("another rep can't generate for it (not found, nothing stored) or read its insights", async () => {
    const count = async () =>
      (await M.supabase.from("ai_insights").select("id", { count: "exact", head: true }).eq("prospect_id", prospectId)).count;
    const before = await count();
    expect(await generateInsightData(B, { prospectId }, FAKE)).toEqual({ ok: false, error: MESSAGES.prospectNotFound });
    expect(await count()).toBe(before);
    expect(expectOk(await listProspectInsightsData(B, prospectId))).toEqual([]);
  });

  it("manager can generate; history is newest first with author names", async () => {
    const insight = expectOk(await generateInsightData(M, { prospectId }, FAKE));
    expect(insight.created_by).toBe(USERS.M.id);
    const list = expectOk(await listProspectInsightsData(A, prospectId));
    expect(list.map((i) => i.author_name)).toEqual(["Morgan Manager", "Riley Rep"]);
    expect(list[0]!.id).toBe(insight.id);
  });

  it("without AI configuration → friendly error, nothing stored", async () => {
    const result = await generateInsightData(A, { prospectId }, { getAiClient: () => getAiClient({ NODE_ENV: "test" }) });
    expect(result).toEqual({ ok: false, error: AI_MESSAGES.notConfigured });
    expect(expectOk(await listProspectInsightsData(A, prospectId))).toHaveLength(2);
  });

  it(`rate limit: ${AI_RATE_LIMIT} per user per 10 minutes (DB clock), the next one is blocked`, async () => {
    const own = expectOk(await createProspectData(B, { name: `${PREFIX} Sam rate limit` }));
    created.push(own.id);
    const { data: already } = await B.supabase.rpc("ai_insight_recent_count");
    const results: ActionResult<unknown>[] = [];
    for (let i = (already ?? 0); i < AI_RATE_LIMIT + 1; i++) {
      results.push(await generateInsightData(B, { prospectId: own.id }, FAKE));
    }
    expect(results.slice(0, -1).every((r) => r.ok)).toBe(true);
    expect(results.at(-1)).toEqual({ ok: false, error: AI_MESSAGES.rateLimited });
    const { data: count } = await B.supabase.rpc("ai_insight_recent_count");
    expect(count).toBe(AI_RATE_LIMIT);
  });
});
