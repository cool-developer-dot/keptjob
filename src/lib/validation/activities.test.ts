import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { activityCreateSchema } from "./activities";
import { CLOCK_SKEW_MS } from "./common";

const ID = "11111111-1111-4111-8111-000000000002";
const NOW = new Date("2026-10-06T15:00:00.000Z");

describe("activityCreateSchema", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("accepts manual types with content; occurredAt optional", () => {
    for (const type of ["call", "conversation", "note", "demo"]) {
      const data = activityCreateSchema.parse({ prospectId: ID, type, content: "  Talked about pricing " });
      expect(data).toEqual({ prospectId: ID, type, content: "Talked about pricing" });
    }
  });

  it("rejects system-written types", () => {
    for (const type of ["follow_up", "stage_change", "owner_change", "ai_insight", "email"]) {
      expect(activityCreateSchema.safeParse({ prospectId: ID, type, content: "x" }).success, type).toBe(false);
    }
  });

  it("requires content", () => {
    expect(activityCreateSchema.safeParse({ prospectId: ID, type: "note", content: "   " }).success).toBe(false);
    expect(activityCreateSchema.safeParse({ prospectId: ID, type: "note" }).success).toBe(false);
    expect(activityCreateSchema.safeParse({ prospectId: ID, type: "note", content: "x".repeat(10_001) }).success).toBe(
      false,
    );
  });

  it("normalises occurredAt to UTC ISO and accepts past times and Dates", () => {
    const withOffset = activityCreateSchema.parse({
      prospectId: ID,
      type: "call",
      content: "x",
      occurredAt: "2026-10-06T09:30:00-04:00",
    });
    expect(withOffset.occurredAt).toBe("2026-10-06T13:30:00.000Z");
    const asDate = activityCreateSchema.parse({
      prospectId: ID,
      type: "call",
      content: "x",
      occurredAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(asDate.occurredAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects occurredAt in the future beyond the clock-skew tolerance", () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    const parse = (occurredAt: string) =>
      activityCreateSchema.safeParse({ prospectId: ID, type: "call", content: "x", occurredAt });
    expect(parse(at(60 * 60 * 1000)).success).toBe(false); // +1h
    expect(parse(at(CLOCK_SKEW_MS + 1000)).success).toBe(false);
    expect(parse(at(60 * 1000)).success).toBe(true); // +1 min: clock skew
    expect(parse(at(0)).success).toBe(true);
    const future = parse(at(24 * 60 * 60 * 1000));
    expect(future.success ? "" : future.error.issues[0].message).toMatch(/future/);
  });

  it("rejects malformed timestamps", () => {
    for (const occurredAt of ["yesterday", "2026-10-06", "2026-10-06T09:30", ""]) {
      expect(
        activityCreateSchema.safeParse({ prospectId: ID, type: "call", content: "x", occurredAt }).success,
        occurredAt,
      ).toBe(false);
    }
  });
});
