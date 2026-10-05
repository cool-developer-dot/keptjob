import { z } from "zod";

import { DEAL_HEALTH_VALUES, DECISION_MAKER_STATUSES } from "@/lib/constants";

import { uuidSchema } from "./common";

export const AI_SUMMARY_MAX = 600;
export const AI_OBJECTION_MAX = 300;
export const AI_NEXT_STEP_MAX = 500;

/**
 * Structured output of the AI insight call (SPEC §10). Plain object without
 * transforms/defaults so it can be passed to zodTextFormat (strict JSON schema;
 * the descriptions are model-visible). The SDK validates the model's answer
 * with this schema; `normalizeInsightOutput()` (src/lib/ai/insights.ts) also
 * rejects blank strings.
 */
export const aiInsightOutputSchema = z.object({
  summary: z
    .string()
    .max(AI_SUMMARY_MAX)
    .describe(`Short factual summary of where the deal stands (at most ${AI_SUMMARY_MAX} characters).`),
  decision_maker_status: z
    .enum(DECISION_MAKER_STATUSES)
    .describe('Is the contact the decision maker? "unknown" when the facts do not say.'),
  main_objection: z
    .string()
    .max(AI_OBJECTION_MAX)
    .describe('The main objection in a few words, or "Unknown" when none is recorded.'),
  recommended_next_step: z
    .string()
    .max(AI_NEXT_STEP_MAX)
    .describe("One concrete, actionable next step for the salesperson, based only on the facts."),
  deal_health: z
    .enum(DEAL_HEALTH_VALUES)
    .describe("high = engaged and progressing; medium = some risk or open questions; low = stalled, negative or at risk."),
});
export type AiInsightOutput = z.infer<typeof aiInsightOutputSchema>;

/** generateInsight({ prospectId }) input. */
export const generateInsightSchema = z.object({ prospectId: uuidSchema });
export type GenerateInsightInput = z.input<typeof generateInsightSchema>;
