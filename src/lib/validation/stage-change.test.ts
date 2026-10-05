import { describe, expect, it } from "vitest";

import { setDemoDetailsSchema, logDemoAttendedSchema } from "./demo";
import { stageChangeSchema } from "./prospects";
import {
  closeFormSchema,
  demoAttendedFormSchema,
  demoBookedFormSchema,
  toCloseStageInput,
  toLogDemoAttendedInput,
  toSetDemoDetailsInput,
} from "./stage-change";

const ID = "6f1d3c1e-2b1a-4c5d-9e8f-0a1b2c3d4e5f";

function issuePaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

describe("demoBookedFormSchema", () => {
  const base = {
    demoDate: "2026-10-08",
    demoTime: "14:30",
    createFollowUp: true,
    followUpDueDate: "2026-10-09",
    followUpNote: "Follow up after demo",
  };

  it("accepts a demo with a follow-up", () => {
    expect(demoBookedFormSchema.safeParse(base).success).toBe(true);
  });

  it("requires a valid demo date and time", () => {
    const result = demoBookedFormSchema.safeParse({ ...base, demoDate: "", demoTime: "25:00" });
    expect(issuePaths(result)).toEqual(expect.arrayContaining(["demoDate", "demoTime"]));
    const empty = demoBookedFormSchema.safeParse({ ...base, demoDate: "", demoTime: "", followUpDueDate: "" });
    expect(empty.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining(["Choose the demo date.", "Choose the demo time.", "Choose a due date."]),
    );
  });

  it("validates the follow-up only when it is checked", () => {
    const invalid = { ...base, followUpDueDate: "", followUpNote: "  " };
    expect(issuePaths(demoBookedFormSchema.safeParse(invalid))).toEqual(
      expect.arrayContaining(["followUpDueDate", "followUpNote"]),
    );
    expect(demoBookedFormSchema.safeParse({ ...invalid, createFollowUp: false }).success).toBe(true);
  });

  it("maps to a valid setDemoDetails input (follow-up omitted when unchecked)", () => {
    const input = toSetDemoDetailsInput(ID, { ...base, followUpNote: "  Call back  " });
    expect(input).toEqual({
      prospectId: ID,
      demoDate: "2026-10-08",
      demoTime: "14:30",
      followUp: { dueDate: "2026-10-09", note: "Call back" },
    });
    expect(setDemoDetailsSchema.safeParse(input).success).toBe(true);
    expect(toSetDemoDetailsInput(ID, { ...base, createFollowUp: false }).followUp).toBeUndefined();
  });
});

describe("demoAttendedFormSchema", () => {
  const base = {
    notes: "",
    createFollowUp: true,
    followUpDueDate: "2026-10-08",
    followUpNote: "Follow up after demo",
  };

  it("notes are optional; the follow-up is validated when checked", () => {
    expect(demoAttendedFormSchema.safeParse(base).success).toBe(true);
    expect(issuePaths(demoAttendedFormSchema.safeParse({ ...base, followUpDueDate: "2026-13-01" }))).toEqual([
      "followUpDueDate",
    ]);
    expect(
      demoAttendedFormSchema.safeParse({ ...base, createFollowUp: false, followUpDueDate: "" }).success,
    ).toBe(true);
  });

  it("limits note length", () => {
    expect(issuePaths(demoAttendedFormSchema.safeParse({ ...base, notes: "x".repeat(10_001) }))).toEqual([
      "notes",
    ]);
  });

  it("maps to a valid logDemoAttended input", () => {
    const input = toLogDemoAttendedInput(ID, { ...base, notes: "  Loved it " });
    expect(input).toEqual({
      prospectId: ID,
      notes: "Loved it",
      followUp: { dueDate: "2026-10-08", note: "Follow up after demo" },
    });
    expect(logDemoAttendedSchema.safeParse(input).success).toBe(true);
    expect(toLogDemoAttendedInput(ID, { ...base, createFollowUp: false }).notes).toBeNull();
  });
});

describe("closeFormSchema", () => {
  it("requires a reason", () => {
    const result = closeFormSchema("won").safeParse({
      closeReason: "",
      closeNotes: "",
      completePendingFollowUps: true,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["closeReason"], message: "Choose a close reason." });
  });

  it("only accepts reasons from the outcome's list", () => {
    const won = closeFormSchema("won");
    const lost = closeFormSchema("lost");
    const values = (closeReason: string) => ({ closeReason, closeNotes: "", completePendingFollowUps: false });
    expect(won.safeParse(values("product_fit")).success).toBe(true);
    expect(won.safeParse(values("no_budget")).success).toBe(false);
    expect(lost.safeParse(values("no_budget")).success).toBe(true);
    expect(lost.safeParse(values("product_fit")).success).toBe(false);
    expect(won.safeParse(values("other")).success).toBe(true);
    expect(lost.safeParse(values("other")).success).toBe(true);
  });

  it("maps to a valid moveProspectStage input", () => {
    const won = toCloseStageInput(ID, "won", {
      closeReason: "relationship",
      closeNotes: "  Signed  ",
      completePendingFollowUps: true,
    });
    expect(won).toEqual({ prospectId: ID, toStage: "closed_won", closeReason: "relationship", closeNotes: "Signed" });
    expect(stageChangeSchema.safeParse(won).success).toBe(true);
    const lost = toCloseStageInput(ID, "lost", {
      closeReason: "price",
      closeNotes: "",
      completePendingFollowUps: false,
    });
    expect(lost).toMatchObject({ toStage: "closed_lost", closeNotes: null });
    expect(stageChangeSchema.safeParse(lost).success).toBe(true);
  });
});
