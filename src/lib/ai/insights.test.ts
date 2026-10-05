// @vitest-environment node
import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { aiInsightOutputSchema, AI_SUMMARY_MAX, type AiInsightOutput } from "@/lib/validation/ai";

import { INSIGHT_INSTRUCTIONS } from "./instructions";
import { AI_MESSAGES, aiErrorMessage, insightTextFormat, normalizeInsightOutput, requestInsight } from "./insights";
import { AI_SCHEMA_NAME } from "./limits";
import type { AiClient, InsightParseResponse } from "./types";

const OUTPUT: AiInsightOutput = {
  summary: "Engaged; pricing is the open question.",
  decision_maker_status: "unknown",
  main_objection: "Price",
  recommended_next_step: "Send the 5-seat pilot quote and book a call for Thursday.",
  deal_health: "medium",
};

function completed(parsed: unknown, extra: Partial<InsightParseResponse> = {}): InsightParseResponse {
  return {
    status: "completed",
    output_parsed: parsed as AiInsightOutput,
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(parsed) }] }],
    ...extra,
  };
}

function clientReturning(response: InsightParseResponse) {
  const parse = vi.fn(async () => response);
  return { client: { responses: { parse } } satisfies AiClient, parse };
}

function clientThrowing(error: unknown) {
  const parse = vi.fn(async () => {
    throw error;
  });
  return { client: { responses: { parse } } satisfies AiClient, parse };
}

const headers = new Headers();

beforeEach(() => {
  // Error paths log server-side; keep the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("insightTextFormat (structured output)", () => {
  it("is a strict JSON schema with the five SPEC fields", () => {
    expect(insightTextFormat.type).toBe("json_schema");
    expect(insightTextFormat.name).toBe(AI_SCHEMA_NAME);
    expect(insightTextFormat.strict).toBe(true);
    const schema = insightTextFormat.schema as Record<string, unknown> & { properties: Record<string, Record<string, unknown>> };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
      "summary",
      "decision_maker_status",
      "main_objection",
      "recommended_next_step",
      "deal_health",
    ]);
    expect(schema.properties.decision_maker_status.enum).toEqual(["yes", "no", "unknown"]);
    expect(schema.properties.deal_health.enum).toEqual(["high", "medium", "low"]);
    expect(schema.properties.summary.maxLength).toBe(AI_SUMMARY_MAX);
  });

  it("parses + validates the model's JSON with the Zod schema", () => {
    expect(insightTextFormat.$parseRaw(JSON.stringify(OUTPUT))).toEqual(OUTPUT);
    expect(() => insightTextFormat.$parseRaw(JSON.stringify({ ...OUTPUT, deal_health: "great" }))).toThrow();
    expect(() => insightTextFormat.$parseRaw("not json")).toThrow();
  });
});

describe("normalizeInsightOutput", () => {
  it("trims strings and rejects blank or invalid fields", () => {
    expect(normalizeInsightOutput({ ...OUTPUT, summary: `  ${OUTPUT.summary}  ` })).toEqual(OUTPUT);
    expect(normalizeInsightOutput({ ...OUTPUT, summary: "   " })).toBeNull();
    expect(normalizeInsightOutput({ ...OUTPUT, recommended_next_step: "" })).toBeNull();
    expect(normalizeInsightOutput({ ...OUTPUT, main_objection: " " })).toBeNull();
    expect(normalizeInsightOutput({ ...OUTPUT, decision_maker_status: "maybe" })).toBeNull();
    expect(normalizeInsightOutput({ ...OUTPUT, summary: "x".repeat(AI_SUMMARY_MAX + 1) })).toBeNull();
    expect(normalizeInsightOutput(null)).toBeNull();
  });
});

describe("requestInsight", () => {
  it("makes one Responses API call with the instructions, context and structured format", async () => {
    const { client, parse } = clientReturning(completed(OUTPUT));
    const result = await requestInsight(client, "env-model", "CONTEXT");
    expect(result).toEqual({ ok: true, data: OUTPUT });
    expect(parse).toHaveBeenCalledTimes(1);
    const [params, options] = parse.mock.calls[0] as unknown as Parameters<AiClient["responses"]["parse"]>;
    expect(params).toMatchObject({ model: "env-model", instructions: INSIGHT_INSTRUCTIONS, input: "CONTEXT", store: false });
    expect(params.text.format).toBe(insightTextFormat);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("instructions forbid invented facts and say 'unknown' when evidence is missing", () => {
    expect(INSIGHT_INSTRUCTIONS).toMatch(/only the facts/i);
    expect(INSIGHT_INSTRUCTIONS).toMatch(/"unknown"/);
    expect(INSIGHT_INSTRUCTIONS).toMatch(/never invent dates, names/i);
    expect(INSIGHT_INSTRUCTIONS).toMatch(/advice for the salesperson, not a decision/i);
  });

  it("refusal → friendly error", async () => {
    const { client } = clientReturning({
      status: "completed",
      output_parsed: null,
      output: [{ type: "message", content: [{ type: "refusal", refusal: "I can't help with that." }] }],
    });
    expect(await requestInsight(client, "m", "c")).toEqual({ ok: false, error: AI_MESSAGES.refusal });
  });

  it("incomplete response → friendly error", async () => {
    const { client } = clientReturning(
      completed(null, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
    );
    expect(await requestInsight(client, "m", "c")).toEqual({ ok: false, error: AI_MESSAGES.incomplete });
  });

  it("empty / invalid output_parsed → friendly error", async () => {
    expect(await requestInsight(clientReturning(completed(null)).client, "m", "c")).toEqual({
      ok: false,
      error: AI_MESSAGES.invalidOutput,
    });
    expect(await requestInsight(clientReturning(completed({ ...OUTPUT, summary: " " })).client, "m", "c")).toEqual({
      ok: false,
      error: AI_MESSAGES.invalidOutput,
    });
    expect(await requestInsight(clientReturning(completed({ ...OUTPUT, deal_health: "great" })).client, "m", "c")).toEqual({
      ok: false,
      error: AI_MESSAGES.invalidOutput,
    });
  });

  it("parse errors thrown by the SDK (bad JSON / schema mismatch) → invalid output", async () => {
    const zodError = aiInsightOutputSchema.safeParse({}).error;
    expect(await requestInsight(clientThrowing(zodError).client, "m", "c")).toEqual({ ok: false, error: AI_MESSAGES.invalidOutput });
    expect(await requestInsight(clientThrowing(new SyntaxError("Unexpected token")).client, "m", "c")).toEqual({
      ok: false,
      error: AI_MESSAGES.invalidOutput,
    });
  });

  it.each([
    [401, AI_MESSAGES.badCredentials],
    [403, AI_MESSAGES.badCredentials],
    [404, AI_MESSAGES.modelNotFound],
    [429, AI_MESSAGES.busy],
    [500, AI_MESSAGES.unavailable],
    [400, AI_MESSAGES.unavailable],
  ])("API error %i → friendly error", async (status, message) => {
    const error = APIError.generate(status, { message: "raw provider message" }, "raw provider message", headers);
    const result = await requestInsight(clientThrowing(error).client, "m", "c");
    expect(result).toEqual({ ok: false, error: message });
  });

  it("timeouts and connection errors → friendly error", async () => {
    expect(await requestInsight(clientThrowing(new APIConnectionTimeoutError()).client, "m", "c")).toEqual({
      ok: false,
      error: AI_MESSAGES.timeout,
    });
    expect(await requestInsight(clientThrowing(new APIUserAbortError()).client, "m", "c")).toEqual({
      ok: false,
      error: AI_MESSAGES.timeout,
    });
    expect(
      await requestInsight(clientThrowing(new APIConnectionError({ message: "ECONNRESET" })).client, "m", "c"),
    ).toEqual({ ok: false, error: AI_MESSAGES.unavailable });
    expect(aiErrorMessage(new Error("weird"))).toBe(AI_MESSAGES.unavailable);
  });

  it("enforces the overall deadline with an abort signal", async () => {
    const parse = vi.fn(
      (_params: unknown, options?: { signal?: AbortSignal }) =>
        new Promise<InsightParseResponse>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
        }),
    );
    const result = await requestInsight({ responses: { parse } }, "m", "c", { timeoutMs: 20 });
    expect(result).toEqual({ ok: false, error: AI_MESSAGES.timeout });
  });

  it("never leaks raw provider messages", async () => {
    const error = APIError.generate(401, { message: "Incorrect API key provided: sk-abc" }, "Incorrect API key provided: sk-abc", headers);
    const result = await requestInsight(clientThrowing(error).client, "m", "c");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("sk-abc");
  });
});
