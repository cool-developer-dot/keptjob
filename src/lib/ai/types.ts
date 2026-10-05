/**
 * The minimal OpenAI surface the insight code uses (one Responses API call
 * with structured output). The real SDK client is adapted to it in
 * client.ts; unit tests and the dev/test fake implement it directly.
 */
import type { zodTextFormat } from "openai/helpers/zod";

import type { AiInsightOutput, aiInsightOutputSchema } from "@/lib/validation/ai";

export type InsightTextFormat = ReturnType<typeof zodTextFormat<typeof aiInsightOutputSchema>>;

export type InsightParseParams = {
  model: string;
  instructions: string;
  input: string;
  text: { format: InsightTextFormat };
  store: boolean;
};

/** The parts of a parsed Responses API response we read. */
export type InsightParseResponse = {
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
  output_parsed: AiInsightOutput | null;
  output: ReadonlyArray<{
    type: string;
    content?: ReadonlyArray<{ type: string; refusal?: string; text?: string }>;
  }>;
};

export type AiClient = {
  responses: {
    parse(params: InsightParseParams, options?: { signal?: AbortSignal }): Promise<InsightParseResponse>;
  };
};
