import { describe, expect, it } from "vitest";

import { AI_NEXT_STEP_MAX, AI_OBJECTION_MAX, AI_SUMMARY_MAX, aiInsightOutputSchema, generateInsightSchema } from "./ai";

const valid = {
  summary: "Interested, budget pending approval.",
  decision_maker_status: "unknown",
  main_objection: "Budget",
  recommended_next_step: "Call the CFO on Thursday to confirm the budget.",
  deal_health: "medium",
};

describe("aiInsightOutputSchema", () => {
  it("accepts the SPEC §10 output", () => {
    expect(aiInsightOutputSchema.parse(valid)).toEqual(valid);
  });

  it("rejects unknown enum values, a long summary and missing fields", () => {
    expect(aiInsightOutputSchema.safeParse({ ...valid, decision_maker_status: "maybe" }).success).toBe(false);
    expect(aiInsightOutputSchema.safeParse({ ...valid, deal_health: "great" }).success).toBe(false);
    expect(aiInsightOutputSchema.safeParse({ ...valid, summary: "x".repeat(AI_SUMMARY_MAX + 1) }).success).toBe(false);
    const { recommended_next_step: _omit, ...missing } = valid;
    void _omit;
    expect(aiInsightOutputSchema.safeParse(missing).success).toBe(false);
  });
});

describe("aiInsightOutputSchema bounds + generateInsightSchema", () => {
  it("bounds main objection and next step", () => {
    expect(aiInsightOutputSchema.safeParse({ ...valid, main_objection: "x".repeat(AI_OBJECTION_MAX + 1) }).success).toBe(false);
    expect(
      aiInsightOutputSchema.safeParse({ ...valid, recommended_next_step: "x".repeat(AI_NEXT_STEP_MAX + 1) }).success,
    ).toBe(false);
    expect(aiInsightOutputSchema.safeParse({ ...valid, summary: "x".repeat(AI_SUMMARY_MAX) }).success).toBe(true);
  });

  it("generateInsight takes a prospect uuid only", () => {
    expect(generateInsightSchema.safeParse({ prospectId: "22222222-2222-4222-8222-000000000001" }).success).toBe(true);
    expect(generateInsightSchema.safeParse({ prospectId: "nope" }).success).toBe(false);
    expect(generateInsightSchema.safeParse({}).success).toBe(false);
  });
});
