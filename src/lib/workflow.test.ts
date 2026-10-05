import { describe, expect, it } from "vitest";

import { PIPELINE_STAGES, isClosedStage, type PipelineStage } from "@/lib/constants";

import {
  DEFAULT_DEMO_FOLLOW_UP_NOTE,
  decideStageFlow,
  demoAttendedDefaults,
  demoBookedDefaults,
  demoFollowUpDueDate,
  stageNeedsDialog,
  type StageFlow,
} from "./workflow";

const NY = "America/New_York";

describe("decideStageFlow", () => {
  it("same stage is a no-op, for every stage (incl. closed → same closed)", () => {
    for (const stage of PIPELINE_STAGES) {
      expect(decideStageFlow(stage, stage, 3)).toEqual({ kind: "noop" });
    }
  });

  it("forward one step to a non-dialog stage moves immediately", () => {
    expect(decideStageFlow("prospect", "contacted", 0)).toEqual({ kind: "immediate" });
    expect(decideStageFlow("conversation", "qualified", 2)).toEqual({ kind: "immediate" });
    expect(decideStageFlow("demo_attended", "follow_up", 1)).toEqual({ kind: "immediate" });
  });

  it("skipping stages to a non-dialog stage moves immediately", () => {
    expect(decideStageFlow("prospect", "qualified", 0)).toEqual({ kind: "immediate" });
    expect(decideStageFlow("contacted", "follow_up", 0)).toEqual({ kind: "immediate" });
  });

  it("backward moves to a non-dialog stage move immediately", () => {
    expect(decideStageFlow("qualified", "contacted", 0)).toEqual({ kind: "immediate" });
    expect(decideStageFlow("follow_up", "prospect", 4)).toEqual({ kind: "immediate" });
    expect(decideStageFlow("demo_attended", "qualified", 0)).toEqual({ kind: "immediate" });
  });

  it("reopening from a closed stage to a non-dialog stage moves immediately", () => {
    expect(decideStageFlow("closed_won", "follow_up", 0)).toEqual({ kind: "immediate" });
    expect(decideStageFlow("closed_lost", "prospect", 0)).toEqual({ kind: "immediate" });
    expect(decideStageFlow("closed_lost", "qualified", 5)).toEqual({ kind: "immediate" });
  });

  it("into Demo Booked shows its dialog: forward, skipped, backward or reopened", () => {
    for (const from of ["qualified", "prospect", "demo_attended", "follow_up", "closed_lost"] as const) {
      expect(decideStageFlow(from, "demo_booked", 0)).toEqual({ kind: "demo_booked" });
    }
  });

  it("into Demo Attended shows its dialog: forward, skipped, backward or reopened", () => {
    for (const from of ["demo_booked", "contacted", "follow_up", "closed_won"] as const) {
      expect(decideStageFlow(from, "demo_attended", 2)).toEqual({ kind: "demo_attended" });
    }
  });

  it("into Closed Won / Closed Lost shows the close dialog with the right outcome", () => {
    expect(decideStageFlow("follow_up", "closed_won", 0)).toEqual({
      kind: "close",
      outcome: "won",
      pendingFollowUps: 0,
      offerCompleteFollowUps: false,
    });
    expect(decideStageFlow("prospect", "closed_lost", 0)).toEqual({
      kind: "close",
      outcome: "lost",
      pendingFollowUps: 0,
      offerCompleteFollowUps: false,
    });
  });

  it("offers completing follow-ups only when N > 0", () => {
    expect(decideStageFlow("demo_attended", "closed_won", 0)).toMatchObject({ offerCompleteFollowUps: false });
    expect(decideStageFlow("demo_attended", "closed_won", 1)).toMatchObject({
      pendingFollowUps: 1,
      offerCompleteFollowUps: true,
    });
    expect(decideStageFlow("qualified", "closed_lost", 3)).toMatchObject({
      pendingFollowUps: 3,
      offerCompleteFollowUps: true,
    });
  });

  it("normalizes a bad pending count to 0", () => {
    for (const n of [-2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(decideStageFlow("follow_up", "closed_lost", n)).toMatchObject({
        pendingFollowUps: 0,
        offerCompleteFollowUps: false,
      });
    }
    expect(decideStageFlow("follow_up", "closed_lost", 2.7)).toMatchObject({ pendingFollowUps: 2 });
  });

  it("won ↔ lost still requires a reason (close dialog with the new outcome)", () => {
    expect(decideStageFlow("closed_won", "closed_lost", 0)).toMatchObject({ kind: "close", outcome: "lost" });
    expect(decideStageFlow("closed_lost", "closed_won", 2)).toMatchObject({
      kind: "close",
      outcome: "won",
      offerCompleteFollowUps: true,
    });
  });

  it("every from × to pair maps to exactly one rule", () => {
    for (const from of PIPELINE_STAGES) {
      for (const to of PIPELINE_STAGES) {
        const flow: StageFlow = decideStageFlow(from, to, 1);
        const expected =
          from === to
            ? "noop"
            : to === "demo_booked" || to === "demo_attended"
              ? to
              : isClosedStage(to)
                ? "close"
                : "immediate";
        expect(flow.kind, `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it("stageNeedsDialog mirrors the decision", () => {
    const cases: [PipelineStage, PipelineStage, boolean][] = [
      ["prospect", "prospect", false],
      ["prospect", "contacted", false],
      ["closed_won", "prospect", false],
      ["qualified", "demo_booked", true],
      ["demo_booked", "demo_attended", true],
      ["follow_up", "closed_won", true],
      ["closed_won", "closed_lost", true],
    ];
    for (const [from, to, expected] of cases) expect(stageNeedsDialog(from, to)).toBe(expected);
  });
});

describe("dialog defaults", () => {
  it("demo booked: empty without a demo, follow-up on with the default note", () => {
    expect(demoBookedDefaults(null, NY)).toEqual({
      demoDate: "",
      demoTime: "",
      createFollowUp: true,
      followUpDueDate: "",
      followUpNote: DEFAULT_DEMO_FOLLOW_UP_NOTE,
    });
  });

  it("demo booked: prefills an existing demo in the org timezone; follow-up = the day after", () => {
    // 2026-10-09 02:30 UTC = Oct 8, 22:30 in New York (EDT).
    expect(demoBookedDefaults("2026-10-09T02:30:00Z", NY)).toMatchObject({
      demoDate: "2026-10-08",
      demoTime: "22:30",
      followUpDueDate: "2026-10-09",
    });
    expect(demoBookedDefaults("2026-10-09T02:30:00Z", "Pacific/Honolulu")).toMatchObject({
      demoDate: "2026-10-08",
      demoTime: "16:30",
    });
  });

  it("demo follow-up due date = demo date + 1 (month/year boundaries); '' for no/invalid date", () => {
    expect(demoFollowUpDueDate("2026-10-31")).toBe("2026-11-01");
    expect(demoFollowUpDueDate("2026-12-31")).toBe("2027-01-01");
    expect(demoFollowUpDueDate("")).toBe("");
    expect(demoFollowUpDueDate("2026-02-30")).toBe("");
  });

  it("demo attended: next follow-up = org today + 2 days (org timezone, not UTC)", () => {
    // 23:00 in New York on Oct 6 is already Oct 7 in UTC.
    const lateEveningNy = new Date("2026-10-07T03:00:00Z");
    expect(demoAttendedDefaults(NY, lateEveningNy)).toEqual({
      notes: "",
      createFollowUp: true,
      followUpDueDate: "2026-10-08",
      followUpNote: DEFAULT_DEMO_FOLLOW_UP_NOTE,
    });
    expect(demoAttendedDefaults("UTC", lateEveningNy).followUpDueDate).toBe("2026-10-09");
  });
});
