import { describe, expect, it } from "vitest";

import {
  activityWeekOverWeek,
  barShare,
  openStageCounts,
  outcomeSegments,
  wholeWinRate,
  workloadShare,
  type TeamMemberSummary,
} from "./dashboard-charts";

const days = (counts: number[]) =>
  counts.map((count, index) => ({ day: `2026-10-${String(index + 1).padStart(2, "0")}`, count }));

describe("activityWeekOverWeek", () => {
  it("compares the last 7 days with the 7 before", () => {
    expect(activityWeekOverWeek(days([1, 1, 1, 1, 1, 1, 4, 2, 2, 2, 2, 2, 2, 2]))).toEqual({
      thisWeek: 14,
      lastWeek: 10,
      changePct: 40,
    });
  });
  it("has no change % when last week was empty", () => {
    expect(activityWeekOverWeek(days([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2]))).toEqual({
      thisWeek: 3,
      lastWeek: 0,
      changePct: null,
    });
  });
});

describe("barShare", () => {
  it("scales to the busiest day and stays flat for zeros", () => {
    expect(barShare(5, 10)).toBe(0.5);
    expect(barShare(0, 10)).toBe(0);
    expect(barShare(3, 0)).toBe(0);
    expect(barShare(12, 10)).toBe(1);
  });
});

describe("openStageCounts", () => {
  it("keeps open stages in SPEC order, zero-filled, without closed ones", () => {
    const result = openStageCounts([
      { stage: "qualified", count: 3 },
      { stage: "closed_won", count: 9 },
      { stage: "prospect", count: 2 },
    ]);
    expect(result.map((row) => row.stage)).toEqual([
      "prospect",
      "contacted",
      "conversation",
      "qualified",
      "demo_booked",
      "demo_attended",
      "follow_up",
    ]);
    expect(result.find((row) => row.stage === "qualified")?.count).toBe(3);
    expect(result.find((row) => row.stage === "contacted")?.count).toBe(0);
  });
});

describe("outcomeSegments", () => {
  it("splits the arc between won and lost, matching the win rate", () => {
    const segments = outcomeSegments(3, 1);
    expect(segments).toEqual({ won: 0.75, lost: 0.25 });
    expect(segments.won + segments.lost).toBe(1);
  });
  it("is empty when nothing closed", () => {
    expect(outcomeSegments(0, 0)).toEqual({ won: 0, lost: 0 });
  });
});

describe("workloadShare / wholeWinRate", () => {
  const member = (open: number): TeamMemberSummary => ({
    userId: String(open),
    name: "x",
    open,
    stale: 0,
    overdue: 0,
    won: 0,
    lost: 0,
  });
  it("scales open deals to the busiest rep", () => {
    expect(workloadShare(5, [member(5), member(10)])).toBe(0.5);
    expect(workloadShare(0, [member(0)])).toBe(0);
  });
  it("rounds the win rate and returns null when nothing closed", () => {
    expect(wholeWinRate(2, 1)).toBe(67);
    expect(wholeWinRate(0, 0)).toBeNull();
  });
});
