import "server-only";

import { getAiClient, type AiClientResult } from "@/lib/ai/client";
import { buildInsightContext } from "@/lib/ai/context";
import { AI_MESSAGES, requestInsight } from "@/lib/ai/insights";
import { AI_CONTEXT_ACTIVITY_LIMIT, AI_RATE_LIMIT } from "@/lib/ai/limits";
import { DEFAULT_ORG_SETTINGS, toOrgSettings } from "@/lib/org-settings";
import type { Tables } from "@/lib/supabase/database.types";
import { generateInsightSchema, type GenerateInsightInput } from "@/lib/validation/ai";
import { prospectIdSchema } from "@/lib/validation/prospects";
import type { ActionResult } from "@/server/actions/types";

import type { DataContext } from "./context";
import { dbFailure, MESSAGES, ok, validationFailure } from "./errors";
import { getProspectDetailData } from "./prospect-detail";

export type AiInsightRow = Tables<"ai_insights">;
export type AiInsightWithAuthor = AiInsightRow & { author_name: string | null };

/** Insights shown on the detail page (latest + previous). */
export const INSIGHT_HISTORY_LIMIT = 20;

export type GenerateInsightDeps = {
  /** AI client factory (default: getAiClient(); tests inject a mock). */
  getAiClient?: () => AiClientResult;
  /** Clock for "today" in the context (default: new Date()). The rate limit uses the DB clock. */
  now?: () => Date;
};

/**
 * Generates an AI insight for a prospect (SPEC §10, manual only):
 * 1. reads the prospect through RLS (no access → not found, nothing else runs);
 * 2. rate limit on the DB clock (≤ AI_RATE_LIMIT per user per 10 minutes);
 * 3. AI client configured? (OPENAI_API_KEY + OPENAI_MODEL, or the dev/test fake);
 * 4. builds the context and calls the model once (structured output);
 * 5. stores the insight + its ai_insight activity atomically (record_ai_insight RPC).
 * Never writes prospect fields. Any failure before step 5 stores nothing.
 */
export async function generateInsightData(
  ctx: DataContext,
  input: GenerateInsightInput,
  deps: GenerateInsightDeps = {},
): Promise<ActionResult<AiInsightWithAuthor>> {
  const parsed = generateInsightSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { prospectId } = parsed.data;

  const prospectResult = await getProspectDetailData(ctx, prospectId);
  if (!prospectResult.ok) return prospectResult;
  const prospect = prospectResult.data;
  if (!prospect) return { ok: false, error: MESSAGES.prospectNotFound };

  const { data: recentCount, error: countError } = await ctx.supabase.rpc("ai_insight_recent_count");
  if (countError) return dbFailure("aiInsightRecentCount", countError, AI_MESSAGES.unavailable);
  if ((recentCount ?? 0) >= AI_RATE_LIMIT) return { ok: false, error: AI_MESSAGES.rateLimited };

  const ai = (deps.getAiClient ?? getAiClient)();
  if (!ai.ok) {
    console.warn("AI insight: not configured", { missing: ai.missing });
    return { ok: false, error: AI_MESSAGES.notConfigured };
  }

  const [settingsRes, activitiesRes, historyRes, followUpsRes, usersRes] = await Promise.all([
    ctx.supabase.from("org_settings").select("default_currency, timezone, stale_days").eq("id", true).maybeSingle(),
    ctx.supabase
      .from("activities")
      .select("type, content, occurred_at, user_id, metadata")
      .eq("prospect_id", prospectId)
      .not("type", "in", "(ai_insight,stage_change)")
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(AI_CONTEXT_ACTIVITY_LIMIT),
    ctx.supabase
      .from("stage_history")
      .select("from_stage, to_stage, changed_at, changed_by, close_reason, note")
      .eq("prospect_id", prospectId)
      .order("changed_at", { ascending: true }),
    ctx.supabase
      .from("follow_ups")
      .select("due_date, note")
      .eq("prospect_id", prospectId)
      .eq("status", "pending")
      .order("due_date", { ascending: true }),
    ctx.supabase.from("users").select("id, full_name"),
  ]);
  const loadError = activitiesRes.error ?? historyRes.error ?? followUpsRes.error ?? usersRes.error;
  if (loadError) return dbFailure("generateInsight (context)", loadError, AI_MESSAGES.unavailable);
  const settings = settingsRes.data ? toOrgSettings(settingsRes.data) : DEFAULT_ORG_SETTINGS;
  const users = new Map((usersRes.data ?? []).map((u) => [u.id, u.full_name] as const));

  const context = buildInsightContext({
    now: (deps.now ?? (() => new Date()))(),
    timezone: settings.timezone,
    prospect,
    activities: activitiesRes.data ?? [],
    stageHistory: historyRes.data ?? [],
    pendingFollowUps: followUpsRes.data ?? [],
    users,
  });

  const result = await requestInsight(ai.client, ai.model, context);
  if (!result.ok) return result;
  const out = result.data;

  const { data: row, error: saveError } = await ctx.supabase.rpc("record_ai_insight", {
      p_prospect_id: prospectId,
      p_summary: out.summary,
      p_decision_maker_status: out.decision_maker_status,
      p_main_objection: out.main_objection,
      p_recommended_next_step: out.recommended_next_step,
      p_deal_health: out.deal_health,
      p_model: ai.model,
    });
  if (saveError || !row) {
    if (saveError?.code === "P0001" && /rate limit/i.test(saveError.message ?? "")) {
      return { ok: false, error: AI_MESSAGES.rateLimited };
    }
    if (saveError?.code === "42501") return { ok: false, error: MESSAGES.prospectNotFound };
    return dbFailure("recordAiInsight", saveError, AI_MESSAGES.saveFailed);
  }
  return ok({ ...row, author_name: users.get(ctx.user.id) ?? null });
}

/** A prospect's insights through RLS, newest first, with the author's name. */
export async function listProspectInsightsData(
  ctx: DataContext,
  prospectId: string,
  { limit = INSIGHT_HISTORY_LIMIT }: { limit?: number } = {},
): Promise<ActionResult<AiInsightWithAuthor[]>> {
  const parsed = prospectIdSchema.safeParse({ prospectId });
  if (!parsed.success) return validationFailure(parsed.error);

  const { data, error } = await ctx.supabase
    .from("ai_insights")
    .select("*, author:users!created_by(full_name)")
    .eq("prospect_id", parsed.data.prospectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) return dbFailure("listProspectInsights", error, "Could not load AI insights.");
  return ok(
    (data ?? []).map(({ author, ...row }) => ({
      ...row,
      author_name: author?.full_name ?? null,
    })),
  );
}
