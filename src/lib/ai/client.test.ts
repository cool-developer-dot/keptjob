// @vitest-environment node
import { describe, expect, it } from "vitest";

import { getAiClient, isFakeAiEnabled } from "./client";
import { fakeInsightFor } from "./fake";
import { FAKE_AI_MODEL } from "./limits";

describe("isFakeAiEnabled", () => {
  it("is on only with AI_FAKE=1 outside production", () => {
    expect(isFakeAiEnabled({ AI_FAKE: "1", NODE_ENV: "development" })).toBe(true);
    expect(isFakeAiEnabled({ AI_FAKE: "1", NODE_ENV: "test" })).toBe(true);
    expect(isFakeAiEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(isFakeAiEnabled({ AI_FAKE: "true", NODE_ENV: "development" })).toBe(false);
    expect(isFakeAiEnabled({ AI_FAKE: "0", NODE_ENV: "development" })).toBe(false);
  });

  it("can never activate in production builds or Vercel deployments", () => {
    expect(isFakeAiEnabled({ AI_FAKE: "1", NODE_ENV: "production" })).toBe(false);
    expect(isFakeAiEnabled({ AI_FAKE: "1", NODE_ENV: "development", VERCEL_ENV: "production" })).toBe(false);
    expect(isFakeAiEnabled({ AI_FAKE: "1", NODE_ENV: "development", VERCEL_ENV: "preview" })).toBe(false);
  });
});

describe("getAiClient", () => {
  it("requires OPENAI_API_KEY and OPENAI_MODEL (no hardcoded model)", () => {
    expect(getAiClient({ NODE_ENV: "test" })).toEqual({
      ok: false,
      reason: "not_configured",
      missing: ["OPENAI_API_KEY", "OPENAI_MODEL"],
    });
    expect(getAiClient({ NODE_ENV: "test", OPENAI_API_KEY: "sk-test" })).toMatchObject({ ok: false, missing: ["OPENAI_MODEL"] });
    expect(getAiClient({ NODE_ENV: "test", OPENAI_MODEL: "some-model" })).toMatchObject({ ok: false, missing: ["OPENAI_API_KEY"] });
    expect(getAiClient({ NODE_ENV: "test", OPENAI_API_KEY: "  ", OPENAI_MODEL: "some-model" })).toMatchObject({ ok: false });
  });

  it("returns the real client + the env model when configured", () => {
    const result = getAiClient({ NODE_ENV: "test", OPENAI_API_KEY: "sk-test", OPENAI_MODEL: " some-model " });
    expect(result).toMatchObject({ ok: true, model: "some-model", fake: false });
    if (result.ok) expect(typeof result.client.responses.parse).toBe("function");
  });

  it("returns the fake client with AI_FAKE=1 (dev/test), never in production", () => {
    expect(getAiClient({ NODE_ENV: "test", AI_FAKE: "1" })).toMatchObject({ ok: true, model: FAKE_AI_MODEL, fake: true });
    expect(getAiClient({ NODE_ENV: "production", AI_FAKE: "1" })).toMatchObject({ ok: false, reason: "not_configured" });
    expect(
      getAiClient({ NODE_ENV: "production", AI_FAKE: "1", OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "m" }),
    ).toMatchObject({ ok: true, fake: false, model: "m" });
  });
});

describe("fake AI client", () => {
  const context = [
    "- Name: Jordan Lee",
    "- Current stage: Qualified",
    "- Decision maker (recorded): Unknown",
    "- Objections: Price, Timing",
    "- Next follow-up date: 2026-03-11",
  ].join("\n");

  it("is deterministic and valid", async () => {
    const result = getAiClient({ NODE_ENV: "test", AI_FAKE: "1" });
    if (!result.ok) throw new Error("expected fake client");
    const response = await result.client.responses.parse({
      model: FAKE_AI_MODEL,
      instructions: "",
      input: context,
      text: { format: {} as never },
      store: false,
    });
    expect(response.status).toBe("completed");
    expect(response.output_parsed).toEqual(fakeInsightFor(context));
    expect(response.output_parsed).toMatchObject({
      decision_maker_status: "yes",
      main_objection: "Price",
      deal_health: "medium",
    });
    expect(response.output_parsed?.recommended_next_step).toContain("Jordan Lee");
  });

  it("keeps a known decision-maker status and handles closed lost", () => {
    const out = fakeInsightFor(
      context.replace("Decision maker (recorded): Unknown", "Decision maker (recorded): No").replace("Qualified", "Closed Lost"),
    );
    expect(out.decision_maker_status).toBe("no");
    expect(out.deal_health).toBe("low");
  });
});
