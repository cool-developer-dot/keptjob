// @vitest-environment node
/**
 * generateInsightData with a mocked Supabase client + mocked AI client:
 * order of checks, rate limit, error paths store nothing, never writes the
 * prospect. (DB behaviour itself: tests/integration/ai-insights.test.ts and
 * supabase/tests/ai_insights.test.sql.)
 */
import { APIError } from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiClientResult } from "@/lib/ai/client";
import { AI_MESSAGES } from "@/lib/ai/insights";
import { AI_RATE_LIMIT, FAKE_AI_MODEL } from "@/lib/ai/limits";
import type { AiClient, InsightParseResponse } from "@/lib/ai/types";
import type { AiInsightOutput } from "@/lib/validation/ai";

import type { DataContext } from "./context";
import { generateInsightData } from "./ai-insights";
import { MESSAGES } from "./errors";

const USER_ID = "11111111-1111-4111-8111-000000000002";
const PROSPECT_ID = "22222222-2222-4222-8222-000000000001";

const OUTPUT: AiInsightOutput = {
  summary: "Engaged; pricing is the open question.",
  decision_maker_status: "yes",
  main_objection: "Price",
  recommended_next_step: "Send the pilot quote.",
  deal_health: "medium",
};

const PROSPECT = {
  id: PROSPECT_ID,
  name: "Jordan Lee",
  company: "Acme",
  email: "jordan@acme.test",
  phone: null,
  stage: "qualified",
  decision_maker_status: "unknown",
  objections: ["price"],
  objection_notes: null,
  notes: "Wants a pilot",
  deal_value: 1000,
  currency: "USD",
  demo_at: null,
  follow_up_date: null,
  close_reason: null,
  close_notes: null,
  closed_at: null,
  owner_id: USER_ID,
  created_by: USER_ID,
  created_at: "2026-02-01T15:00:00Z",
  updated_at: "2026-02-01T15:00:00Z",
  last_activity_at: "2026-02-01T15:00:00Z",
  is_stale: false,
  has_overdue_follow_up: false,
};

type Call = { table: string; method: string; args: unknown[] };

/** Chainable PostgREST-like mock that records every call. */
function mockSupabase(opts: {
  prospect?: object | null;
  recentCount?: number | (() => number);
  record?: () => { data: unknown; error: { code: string; message: string } | null };
}) {
  const calls: Call[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const tables: Record<string, unknown> = {
    prospects_with_flags: opts.prospect === undefined ? PROSPECT : opts.prospect,
    org_settings: { default_currency: "USD", timezone: "America/New_York", stale_days: 14 },
    activities: [{ type: "call", content: "Talked pricing", occurred_at: "2026-03-01T15:00:00Z", user_id: USER_ID, metadata: {} }],
    stage_history: [],
    follow_ups: [],
    users: [{ id: USER_ID, full_name: "Riley Rep" }],
  };

  function builder(table: string) {
    const result = () => ({ data: tables[table] ?? null, error: null });
    const b: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "not", "in", "order", "limit", "insert", "update", "upsert", "delete"]) {
      b[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return b;
      };
    }
    b.maybeSingle = async () => result();
    b.single = async () => result();
    b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return b;
  }

  const supabase = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      if (name === "ai_insight_recent_count") {
        const count = typeof opts.recentCount === "function" ? opts.recentCount() : (opts.recentCount ?? 0);
        return { data: count, error: null };
      }
      if (name === "record_ai_insight") {
        if (opts.record) return opts.record();
        const a = args as Record<string, string>;
        return {
          data: {
            id: "44444444-4444-4444-8444-000000000001",
            prospect_id: a.p_prospect_id,
            summary: a.p_summary,
            decision_maker_status: a.p_decision_maker_status,
            main_objection: a.p_main_objection,
            recommended_next_step: a.p_recommended_next_step,
            deal_health: a.p_deal_health,
            model: a.p_model,
            created_by: USER_ID,
            created_at: "2026-03-01T15:00:00Z",
          },
          error: null,
        };
      }
      return { data: null, error: { code: "42883", message: "unknown rpc" } };
    },
  };
  const ctx = { supabase, user: { id: USER_ID, role: "sales_rep" } } as unknown as DataContext;
  const writes = () => calls.filter((c) => ["insert", "update", "upsert", "delete"].includes(c.method));
  return { ctx, calls, rpcCalls, writes };
}

function aiReturning(response: InsightParseResponse | Error) {
  const parse = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const client: AiClient = { responses: { parse } };
  const getAiClient = vi.fn((): AiClientResult => ({ ok: true, client, model: "env-model", fake: false }));
  return { parse, getAiClient };
}

const completed = (parsed: unknown): InsightParseResponse => ({
  status: "completed",
  output_parsed: parsed as AiInsightOutput,
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(parsed) }] }],
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("generateInsightData", () => {
  it("success: one AI call, stored via record_ai_insight with the model, no prospect write", async () => {
    const db = mockSupabase({});
    const ai = aiReturning(completed(OUTPUT));
    const result = await generateInsightData(db.ctx, { prospectId: PROSPECT_ID }, { getAiClient: ai.getAiClient });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({ ...OUTPUT, model: "env-model", prospect_id: PROSPECT_ID, author_name: "Riley Rep" });
    }
    expect(ai.parse).toHaveBeenCalledTimes(1);
    const params = ai.parse.mock.calls[0] as unknown as [{ input: string; model: string }];
    expect(params[0].model).toBe("env-model");
    expect(params[0].input).toContain("- Name: Jordan Lee");
    expect(params[0].input).toContain("Talked pricing");
    expect(params[0].input).not.toContain("jordan@acme.test");

    const records = db.rpcCalls.filter((c) => c.name === "record_ai_insight");
    expect(records).toEqual([
      {
        name: "record_ai_insight",
        args: {
          p_prospect_id: PROSPECT_ID,
          p_summary: OUTPUT.summary,
          p_decision_maker_status: OUTPUT.decision_maker_status,
          p_main_objection: OUTPUT.main_objection,
          p_recommended_next_step: OUTPUT.recommended_next_step,
          p_deal_health: OUTPUT.deal_health,
          p_model: "env-model",
        },
      },
    ]);
    // Never writes the prospect (or anything else) directly.
    expect(db.writes()).toEqual([]);
    expect(db.calls.some((c) => c.table === "prospects")).toBe(false);
  });

  it("works with the fake client (model recorded as fake-ai)", async () => {
    const db = mockSupabase({});
    const result = await generateInsightData(
      db.ctx,
      { prospectId: PROSPECT_ID },
      { getAiClient: () => ({ ok: true, client: { responses: { parse: async () => completed(OUTPUT) } }, model: FAKE_AI_MODEL, fake: true }) },
    );
    expect(result.ok && result.data.model).toBe(FAKE_AI_MODEL);
  });

  it("invalid id → validation error, nothing else runs", async () => {
    const db = mockSupabase({});
    const ai = aiReturning(completed(OUTPUT));
    const result = await generateInsightData(db.ctx, { prospectId: "nope" }, { getAiClient: ai.getAiClient });
    expect(result.ok).toBe(false);
    expect(db.calls).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
    expect(ai.getAiClient).not.toHaveBeenCalled();
  });

  it("no access (RLS hides the prospect) → not found before any count or AI call", async () => {
    const db = mockSupabase({ prospect: null });
    const ai = aiReturning(completed(OUTPUT));
    const result = await generateInsightData(db.ctx, { prospectId: PROSPECT_ID }, { getAiClient: ai.getAiClient });
    expect(result).toEqual({ ok: false, error: MESSAGES.prospectNotFound });
    expect(db.rpcCalls).toEqual([]);
    expect(ai.getAiClient).not.toHaveBeenCalled();
    expect(ai.parse).not.toHaveBeenCalled();
  });

  it(`rate limit: the ${AI_RATE_LIMIT + 1}th call within the window is blocked before the AI call`, async () => {
    let stored = 0;
    const db = mockSupabase({
      recentCount: () => stored,
      record: () => {
        stored += 1;
        return { data: { id: `id-${stored}`, prospect_id: PROSPECT_ID, ...OUTPUT, model: "env-model", created_by: USER_ID, created_at: "x" }, error: null };
      },
    });
    const ai = aiReturning(completed(OUTPUT));
    const results = [];
    for (let i = 0; i < AI_RATE_LIMIT + 1; i++) {
      results.push(await generateInsightData(db.ctx, { prospectId: PROSPECT_ID }, { getAiClient: ai.getAiClient }));
    }
    expect(results.slice(0, AI_RATE_LIMIT).every((r) => r.ok)).toBe(true);
    expect(results[AI_RATE_LIMIT]).toEqual({ ok: false, error: AI_MESSAGES.rateLimited });
    expect(ai.parse).toHaveBeenCalledTimes(AI_RATE_LIMIT);
    expect(stored).toBe(AI_RATE_LIMIT);
  });

  it("rate limit hit inside record_ai_insight (race) → friendly rate-limit error", async () => {
    const db = mockSupabase({ record: () => ({ data: null, error: { code: "P0001", message: "AI insight rate limit reached" } }) });
    const ai = aiReturning(completed(OUTPUT));
    expect(await generateInsightData(db.ctx, { prospectId: PROSPECT_ID }, { getAiClient: ai.getAiClient })).toEqual({
      ok: false,
      error: AI_MESSAGES.rateLimited,
    });
  });

  it("record denied by RLS (42501) → not found; other DB errors → save failed", async () => {
    const denied = mockSupabase({ record: () => ({ data: null, error: { code: "42501", message: "new row violates row-level security" } }) });
    expect(
      await generateInsightData(denied.ctx, { prospectId: PROSPECT_ID }, { getAiClient: aiReturning(completed(OUTPUT)).getAiClient }),
    ).toEqual({ ok: false, error: MESSAGES.prospectNotFound });
    const broken = mockSupabase({ record: () => ({ data: null, error: { code: "XX000", message: "boom" } }) });
    expect(
      await generateInsightData(broken.ctx, { prospectId: PROSPECT_ID }, { getAiClient: aiReturning(completed(OUTPUT)).getAiClient }),
    ).toEqual({ ok: false, error: AI_MESSAGES.saveFailed });
  });

  it("not configured (no key / model) → friendly error, nothing stored", async () => {
    const db = mockSupabase({});
    const result = await generateInsightData(
      db.ctx,
      { prospectId: PROSPECT_ID },
      { getAiClient: () => ({ ok: false, reason: "not_configured", missing: ["OPENAI_API_KEY"] }) },
    );
    expect(result).toEqual({ ok: false, error: AI_MESSAGES.notConfigured });
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["ai_insight_recent_count"]);
    expect(db.writes()).toEqual([]);
  });

  it.each([
    ["429", APIError.generate(429, undefined, "rate limited", new Headers()), AI_MESSAGES.busy],
    ["401", APIError.generate(401, undefined, "bad key", new Headers()), AI_MESSAGES.badCredentials],
    ["refusal", { status: "completed", output_parsed: null, output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }, AI_MESSAGES.refusal],
    ["empty output", completed(null), AI_MESSAGES.invalidOutput],
  ] as const)("AI failure (%s) → friendly error, nothing stored, no prospect write", async (_label, response, message) => {
    const db = mockSupabase({});
    const ai = aiReturning(response as InsightParseResponse | Error);
    const result = await generateInsightData(db.ctx, { prospectId: PROSPECT_ID }, { getAiClient: ai.getAiClient });
    expect(result).toEqual({ ok: false, error: message });
    expect(db.rpcCalls.some((c) => c.name === "record_ai_insight")).toBe(false);
    expect(db.writes()).toEqual([]);
  });
});
