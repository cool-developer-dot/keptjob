import "server-only";

/**
 * The single AI insight call (SPEC §10): OpenAI Responses API with structured
 * output (zodTextFormat + output_parsed). Every failure becomes a friendly
 * { ok: false } — the caller stores nothing in that case.
 */
import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { aiInsightOutputSchema, type AiInsightOutput } from "@/lib/validation/ai";
import type { ActionResult } from "@/server/actions/types";

import { INSIGHT_INSTRUCTIONS } from "./instructions";
import { AI_RATE_LIMIT, AI_RATE_WINDOW_MINUTES, AI_SCHEMA_NAME, AI_TIMEOUT_MS } from "./limits";
import type { AiClient, InsightParseResponse } from "./types";

export const AI_MESSAGES = {
  notConfigured: "AI is not configured. Ask an admin to set OPENAI_API_KEY and OPENAI_MODEL.",
  rateLimited: `You've generated ${AI_RATE_LIMIT} AI insights in the last ${AI_RATE_WINDOW_MINUTES} minutes. Please wait a few minutes and try again.`,
  timeout: "The AI took too long to respond. Please try again.",
  refusal: "The AI declined to answer for this prospect. Try again after adding more details.",
  incomplete: "The AI returned an incomplete answer. Please try again.",
  invalidOutput: "The AI returned an answer in an unexpected format. Please try again.",
  badCredentials: "AI is not configured correctly (the API key was rejected). Ask an admin to check OPENAI_API_KEY.",
  modelNotFound: "AI is not configured correctly (model not found). Ask an admin to check OPENAI_MODEL.",
  busy: "The AI service is busy or over its quota. Please try again in a minute.",
  unavailable: "The AI service is unavailable right now. Please try again.",
  saveFailed: "The insight was generated but could not be saved. Please try again.",
} as const;

/** Strict JSON schema for the Responses API; the SDK parses + validates the answer with the Zod schema. */
export const insightTextFormat = zodTextFormat(aiInsightOutputSchema, AI_SCHEMA_NAME);

/** Re-validates the parsed output and rejects blank fields. null → invalid. */
export function normalizeInsightOutput(raw: unknown): AiInsightOutput | null {
  const parsed = aiInsightOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const out = {
    ...parsed.data,
    summary: parsed.data.summary.trim(),
    main_objection: parsed.data.main_objection.trim(),
    recommended_next_step: parsed.data.recommended_next_step.trim(),
  };
  if (!out.summary || !out.main_objection || !out.recommended_next_step) return null;
  return out;
}

function findRefusal(response: InsightParseResponse): string | null {
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "refusal") return content.refusal ?? "";
    }
  }
  return null;
}

function isTimeout(error: unknown): boolean {
  if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) return true;
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError";
}

/** Maps a thrown SDK/parse error to a friendly message (and logs the raw error server-side). */
export function aiErrorMessage(error: unknown): string {
  if (isTimeout(error)) return AI_MESSAGES.timeout;
  if (error instanceof APIError && typeof error.status === "number") {
    if (error.status === 401 || error.status === 403) return AI_MESSAGES.badCredentials;
    if (error.status === 404) return AI_MESSAGES.modelNotFound;
    if (error.status === 429) return AI_MESSAGES.busy;
    return AI_MESSAGES.unavailable;
  }
  if (error instanceof APIConnectionError) return AI_MESSAGES.unavailable;
  // Structured-output parsing failures (invalid JSON / schema mismatch) thrown by responses.parse.
  const name = error instanceof Error ? error.name : "";
  if (error instanceof SyntaxError || name === "ZodError" || name === "$ZodError") return AI_MESSAGES.invalidOutput;
  if (name === "LengthFinishReasonError") return AI_MESSAGES.incomplete;
  if (name === "ContentFilterFinishReasonError") return AI_MESSAGES.refusal;
  return AI_MESSAGES.unavailable;
}

function logAiError(error: unknown): void {
  // Never log the API key or the prompt (prospect data): only the error class/status/message.
  const status = error instanceof APIError ? error.status : undefined;
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  console.error("AI insight request failed", { name, status, message: message.slice(0, 300) });
}

/**
 * One Responses API call → validated insight output. The overall deadline is
 * AI_TIMEOUT_MS (30 s) including the SDK retry.
 */
export async function requestInsight(
  client: AiClient,
  model: string,
  context: string,
  options: { timeoutMs?: number } = {},
): Promise<ActionResult<AiInsightOutput>> {
  let response: InsightParseResponse;
  try {
    response = await client.responses.parse(
      {
        model,
        instructions: INSIGHT_INSTRUCTIONS,
        input: context,
        text: { format: insightTextFormat },
        store: false,
      },
      { signal: AbortSignal.timeout(options.timeoutMs ?? AI_TIMEOUT_MS) },
    );
  } catch (error) {
    logAiError(error);
    return { ok: false, error: aiErrorMessage(error) };
  }

  if (findRefusal(response) !== null) {
    console.warn("AI insight refused");
    return { ok: false, error: AI_MESSAGES.refusal };
  }
  if (response.status && response.status !== "completed") {
    console.warn("AI insight incomplete", { status: response.status, reason: response.incomplete_details?.reason });
    return { ok: false, error: AI_MESSAGES.incomplete };
  }
  if (response.output_parsed == null) {
    console.warn("AI insight without parsed output");
    return { ok: false, error: AI_MESSAGES.invalidOutput };
  }
  const output = normalizeInsightOutput(response.output_parsed);
  if (!output) {
    console.warn("AI insight output failed validation");
    return { ok: false, error: AI_MESSAGES.invalidOutput };
  }
  return { ok: true, data: output };
}
