import { z } from "zod";

import { DEAL_HEALTH_VALUES, DECISION_MAKER_STATUSES } from "@/lib/constants";

export const AI_SUMMARY_MAX = 600;

/**
 * Structured output of the AI insight call (SPEC §10). Plain object without
 * transforms/defaults so it can be passed to zodTextFormat (Prompt 11).
 */
export const aiInsightOutputSchema = z.object({
  summary: z.string().max(AI_SUMMARY_MAX),
  decision_maker_status: z.enum(DECISION_MAKER_STATUSES),
  main_objection: z.string(),
  recommended_next_step: z.string(),
  deal_health: z.enum(DEAL_HEALTH_VALUES),
});
export type AiInsightOutput = z.infer<typeof aiInsightOutputSchema>;
