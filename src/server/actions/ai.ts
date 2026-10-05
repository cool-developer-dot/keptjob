"use server";

import type { GenerateInsightInput } from "@/lib/validation/ai";
import { generateInsightData, type AiInsightWithAuthor } from "@/server/data/ai-insights";
import { MESSAGES } from "@/server/data/errors";

import { getActionContext, revalidateProspect } from "./helpers";
import type { ActionResult } from "./types";

/**
 * Generates and stores an AI insight for a prospect (manual only, SPEC §10).
 * Never writes prospect fields; the user applies suggestions with separate
 * clicks (updateProspect / createFollowUp).
 */
export async function generateInsight(input: GenerateInsightInput): Promise<ActionResult<AiInsightWithAuthor>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: MESSAGES.sessionExpired };
  const result = await generateInsightData(ctx, input);
  if (result.ok) revalidateProspect(result.data.prospect_id);
  return result;
}
