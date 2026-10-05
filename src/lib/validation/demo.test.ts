import { describe, expect, it } from "vitest";

import { logDemoAttendedSchema, setDemoDetailsSchema } from "./demo";

const ID = "11111111-1111-4111-8111-000000000002";

describe("setDemoDetailsSchema", () => {
  it("accepts org-local date + time and an optional follow-up", () => {
    expect(setDemoDetailsSchema.safeParse({ prospectId: ID, demoDate: "2026-10-08", demoTime: "14:30" }).success).toBe(
      true,
    );
    const data = setDemoDetailsSchema.parse({
      prospectId: ID,
      demoDate: "2026-10-08",
      demoTime: "09:05",
      followUp: { dueDate: "2026-10-09", note: " Follow up after demo " },
    });
    expect(data.followUp).toEqual({ dueDate: "2026-10-09", note: "Follow up after demo" });
  });

  it("rejects bad dates/times and incomplete follow-ups", () => {
    const base = { prospectId: ID, demoDate: "2026-10-08", demoTime: "14:30" };
    for (const patch of [
      { demoDate: "2026-02-30" },
      { demoDate: "" },
      { demoTime: "24:00" },
      { demoTime: "2:30 PM" },
      { demoTime: "14:30:00" },
      { followUp: { dueDate: "2026-10-09" } },
      { followUp: { dueDate: "nope", note: "x" } },
      { prospectId: "x" },
    ]) {
      expect(setDemoDetailsSchema.safeParse({ ...base, ...patch }).success, JSON.stringify(patch)).toBe(false);
    }
  });
});

describe("logDemoAttendedSchema", () => {
  it("notes and follow-up are optional", () => {
    expect(logDemoAttendedSchema.parse({ prospectId: ID })).toEqual({ prospectId: ID });
    expect(logDemoAttendedSchema.parse({ prospectId: ID, notes: " Went well " }).notes).toBe("Went well");
    expect(
      logDemoAttendedSchema.safeParse({ prospectId: ID, followUp: { dueDate: "2026-10-10", note: "Send proposal" } })
        .success,
    ).toBe(true);
  });

  it("rejects invalid follow-ups and overlong notes", () => {
    expect(logDemoAttendedSchema.safeParse({ prospectId: ID, followUp: { dueDate: "x", note: "y" } }).success).toBe(false);
    expect(logDemoAttendedSchema.safeParse({ prospectId: ID, notes: "x".repeat(10_001) }).success).toBe(false);
  });
});
