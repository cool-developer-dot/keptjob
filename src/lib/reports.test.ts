import { describe, expect, it } from "vitest";

import {
  formatPct,
  formatReportRange,
  resolveReportRange,
  toFunnelSteps,
  toOutcomes,
  toReachedCounts,
  toStageCounts,
  zeroFillLostReasons,
} from "./reports";
import { orgToday } from "./time";

describe("resolveReportRange", () => {
  const today = "2026-10-06";

  it("resolves every preset ending on the org-local today", () => {
    expect(resolveReportRange("this_month", today)).toEqual({ from: "2026-10-01", to: today });
    expect(resolveReportRange("last_30", today)).toEqual({ from: "2026-09-07", to: today });
    expect(resolveReportRange("last_90", today)).toEqual({ from: "2026-07-09", to: today });
    expect(resolveReportRange("this_quarter", today)).toEqual({ from: "2026-10-01", to: today });
  });

  it("finds the quarter start for every month", () => {
    const starts = Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, "0");
      return resolveReportRange("this_quarter", `2026-${month}-15`).from;
    });
    expect(starts).toEqual([
      "2026-01-01", "2026-01-01", "2026-01-01",
      "2026-04-01", "2026-04-01", "2026-04-01",
      "2026-07-01", "2026-07-01", "2026-07-01",
      "2026-10-01", "2026-10-01", "2026-10-01",
    ]);
  });

  it("crosses month and year boundaries for rolling windows", () => {
    expect(resolveReportRange("last_30", "2026-03-01")).toEqual({ from: "2026-01-31", to: "2026-03-01" });
    expect(resolveReportRange("last_90", "2026-01-15")).toEqual({ from: "2025-10-18", to: "2026-01-15" });
  });

  it("uses the org timezone's today (11 pm New York is already tomorrow in UTC)", () => {
    const now = new Date("2026-10-01T03:30:00Z"); // Sep 30, 11:30 pm EDT
    const today = orgToday("America/New_York", now);
    expect(resolveReportRange("this_month", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolveReportRange("this_quarter", today)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(resolveReportRange("this_month", orgToday("UTC", now))).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });

  it("returns the custom range and requires one", () => {
    expect(resolveReportRange("custom", "2026-10-06", { from: "2025-09-01", to: "2025-09-30" })).toEqual({
      from: "2025-09-01",
      to: "2025-09-30",
    });
    expect(() => resolveReportRange("custom", "2026-10-06")).toThrow(RangeError);
  });
});

describe("formatting", () => {
  it("formats percentages from SQL", () => {
    expect(formatPct(37.5)).toBe("37.5%");
    expect(formatPct("100.0")).toBe("100%");
    expect(formatPct(0)).toBe("0%");
    expect(formatPct(null)).toBe("—");
    expect(formatPct("abc")).toBe("—");
  });

  it("formats periods", () => {
    expect(formatReportRange({ from: "2025-09-01", to: "2025-09-30" })).toBe("Sep 1 – Sep 30, 2025");
    expect(formatReportRange({ from: "2025-12-01", to: "2026-01-31" })).toBe("Dec 1, 2025 – Jan 31, 2026");
    expect(formatReportRange({ from: "2026-10-06", to: "2026-10-06" })).toBe("Oct 6, 2026");
  });
});

describe("RPC mappers", () => {
  it("maps funnel rows with labels and nullable percentages", () => {
    const steps = toFunnelSteps([
      { step: 2, stage: "contacted", prospect_count: 7, step_conversion_pct: "87.5", overall_conversion_pct: 87.5 },
      { step: 1, stage: "prospect", prospect_count: 8, step_conversion_pct: null, overall_conversion_pct: 100 },
    ]);
    expect(steps).toEqual([
      { step: 1, stage: "prospect", label: "Prospects", count: 8, stepConversionPct: null, overallConversionPct: 100 },
      { step: 2, stage: "contacted", label: "Contacted", count: 7, stepConversionPct: 87.5, overallConversionPct: 87.5 },
    ]);
  });

  it("zero-fills stage counts in SPEC order", () => {
    const counts = toStageCounts([{ stage: "closed_won", prospect_count: 4 }]);
    expect(counts).toHaveLength(9);
    expect(counts[0]).toEqual({ stage: "prospect", label: "Prospect", count: 0 });
    expect(counts[7]).toEqual({ stage: "closed_won", label: "Closed Won", count: 4 });
  });

  it("maps reached counts for every ranked stage", () => {
    const reached = toReachedCounts([
      { stage: "follow_up", prospect_count: 4 },
      { stage: "closed_lost", prospect_count: 9 },
    ]);
    expect(reached.follow_up).toBe(4);
    expect(reached.prospect).toBe(0);
    expect("closed_lost" in reached).toBe(false);
  });

  it("zero-fills lost reasons, most frequent first, SPEC order on ties", () => {
    expect(zeroFillLostReasons([{ reason: "price", count: 1 }, { reason: "no_budget", count: 2 }]).map((r) => [r.reason, r.count])).toEqual([
      ["no_budget", 2],
      ["price", 1],
      ["timing", 0],
      ["competitor", 0],
      ["no_response", 0],
      ["not_a_fit", 0],
      ["other", 0],
    ]);
    expect(zeroFillLostReasons([{ reason: "weird", count: 3 }]).find((r) => r.reason === "other")?.count).toBe(3);
  });

  it("maps outcomes (jsonb parsed, currencies sorted, never summed)", () => {
    const outcomes = toOutcomes({
      won: 4,
      lost: 3,
      win_rate_pct: 57.1,
      won_value: [
        { currency: "USD", total: 1700, count: 2 },
        { currency: "GBP", total: "400.00", count: 1 },
      ],
      won_without_value: 1,
      lost_reasons: [{ reason: "competitor", count: 1 }],
    });
    expect(outcomes.winRatePct).toBe(57.1);
    expect(outcomes.wonValue).toEqual([
      { currency: "GBP", total: 400, count: 1 },
      { currency: "USD", total: 1700, count: 2 },
    ]);
    expect(outcomes.wonWithoutValue).toBe(1);
    expect(outcomes.lostReasons[0]).toEqual({ reason: "competitor", label: "Competitor", count: 1 });
  });

  it("handles no outcome row and rejects malformed jsonb", () => {
    expect(toOutcomes(null)).toMatchObject({ won: 0, lost: 0, winRatePct: null, wonValue: [] });
    expect(() =>
      toOutcomes({ won: 1, lost: 0, win_rate_pct: 100, won_value: [{ nope: 1 }], won_without_value: 0, lost_reasons: [] }),
    ).toThrow();
  });
});
