import { describe, expect, it } from "vitest";

import {
  attentionRank,
  attentionReasonLabel,
  attentionReasons,
  compareAttention,
  firstName,
  formatWinRate,
  greetingFor,
  instantMicros,
  rankDealsNeedingAttention,
  summarizePipelineValue,
  winRate,
  winRateWindow,
  type RankableDeal,
} from "./dashboard";

const NONE = { hasOverdueFollowUp: false, isStale: false, lowHealth: false, noFollowUp: false };

function deal(id: string, overrides: Partial<RankableDeal> = {}): RankableDeal {
  return { ...NONE, id, followUpDate: "2026-10-10", lastActivityAt: "2026-10-01T12:00:00+00:00", ...overrides };
}

describe("attentionReasons / attentionRank", () => {
  it("lists every reason in priority order", () => {
    expect(attentionReasons({ hasOverdueFollowUp: true, isStale: true, lowHealth: true, noFollowUp: false })).toEqual([
      "overdue_follow_up",
      "stale",
      "low_health",
    ]);
    expect(attentionReasons({ ...NONE, noFollowUp: true, lowHealth: true })).toEqual(["low_health", "no_follow_up"]);
    expect(attentionReasons(NONE)).toEqual([]);
  });

  it("ranks by the most urgent reason", () => {
    expect(attentionRank({ ...NONE, hasOverdueFollowUp: true, noFollowUp: true })).toBe(1);
    expect(attentionRank({ ...NONE, isStale: true, lowHealth: true, noFollowUp: true })).toBe(2);
    expect(attentionRank({ ...NONE, lowHealth: true, noFollowUp: true })).toBe(3);
    expect(attentionRank({ ...NONE, noFollowUp: true })).toBe(4);
    expect(attentionRank(NONE)).toBeNull();
  });

  it("labels reasons", () => {
    expect(attentionReasonLabel("overdue_follow_up", 14)).toBe("Overdue follow-up");
    expect(attentionReasonLabel("stale", 21)).toBe("No activity for 21+ days");
    expect(attentionReasonLabel("low_health", 14)).toBe("AI health: Low");
    expect(attentionReasonLabel("no_follow_up", 14)).toBe("No follow-up scheduled");
  });
});

describe("rankDealsNeedingAttention", () => {
  it("orders overdue > stale > AI health low > no follow-up and drops healthy deals", () => {
    const rows = [
      deal("noFollowUp", { noFollowUp: true, followUpDate: null }),
      deal("healthy"),
      deal("low", { lowHealth: true }),
      deal("stale", { isStale: true }),
      deal("overdue", { hasOverdueFollowUp: true, followUpDate: "2026-10-01" }),
    ];
    expect(rankDealsNeedingAttention(rows).map((row) => row.id)).toEqual(["overdue", "stale", "low", "noFollowUp"]);
  });

  it("a deal with several reasons ranks by its most urgent one", () => {
    const rows = [
      deal("staleOnly", { isStale: true, lastActivityAt: "2026-01-01T00:00:00Z" }),
      deal("everything", {
        hasOverdueFollowUp: true,
        isStale: true,
        lowHealth: true,
        followUpDate: "2026-10-01",
        lastActivityAt: "2026-10-05T00:00:00Z",
      }),
    ];
    expect(rankDealsNeedingAttention(rows).map((row) => row.id)).toEqual(["everything", "staleOnly"]);
  });

  it("within overdue: most overdue first, then least recently active, then id", () => {
    const rows = [
      deal("b", { hasOverdueFollowUp: true, followUpDate: "2026-10-03", lastActivityAt: "2026-10-01T00:00:00Z" }),
      deal("c", { hasOverdueFollowUp: true, followUpDate: "2026-10-01", lastActivityAt: "2026-10-04T00:00:00Z" }),
      deal("a", { hasOverdueFollowUp: true, followUpDate: "2026-10-03", lastActivityAt: "2026-10-01T00:00:00Z" }),
      deal("d", { hasOverdueFollowUp: true, followUpDate: "2026-10-03", lastActivityAt: "2026-09-01T00:00:00Z" }),
    ];
    expect(rankDealsNeedingAttention(rows).map((row) => row.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("within a tier, a scheduled follow-up sorts before none (nulls last), then oldest activity", () => {
    const rows = [
      deal("noneOld", { isStale: true, noFollowUp: true, followUpDate: null, lastActivityAt: "2026-01-01T00:00:00Z" }),
      deal("scheduled", { isStale: true, followUpDate: "2026-12-01", lastActivityAt: "2026-09-01T00:00:00Z" }),
      deal("noneNew", { isStale: true, noFollowUp: true, followUpDate: null, lastActivityAt: "2026-02-01T00:00:00Z" }),
    ];
    expect(rankDealsNeedingAttention(rows).map((row) => row.id)).toEqual(["scheduled", "noneOld", "noneNew"]);
  });

  it("compares Postgres timestamps to the microsecond", () => {
    const older = deal("z", { noFollowUp: true, followUpDate: null, lastActivityAt: "2026-10-05T22:02:24.726293+00:00" });
    const newer = deal("a", { noFollowUp: true, followUpDate: null, lastActivityAt: "2026-10-05T22:02:24.726294+00:00" });
    expect(rankDealsNeedingAttention([newer, older]).map((row) => row.id)).toEqual(["z", "a"]);
    expect(instantMicros("2026-10-05T22:02:24.7263+00:00")).toBeLessThan(instantMicros("2026-10-05T22:02:24.72631+00:00"));
    expect(instantMicros("2026-10-05T22:02:24+00:00")).toBe(Date.parse("2026-10-05T22:02:24Z") * 1000);
    expect(instantMicros("2026-10-05T18:02:24.5-04:00")).toBe(Date.parse("2026-10-05T22:02:24Z") * 1000 + 500_000);
  });

  it("applies the limit after ranking and does not mutate the input", () => {
    const rows = [deal("x", { noFollowUp: true }), deal("y", { hasOverdueFollowUp: true }), deal("w", { isStale: true })];
    const copy = [...rows];
    expect(rankDealsNeedingAttention(rows, 2).map((row) => row.id)).toEqual(["y", "w"]);
    expect(rows).toEqual(copy);
    expect(rankDealsNeedingAttention([], 10)).toEqual([]);
  });

  it("compareAttention is antisymmetric and 0 only for identical keys", () => {
    const a = deal("a", { isStale: true });
    const b = deal("b", { isStale: true });
    expect(compareAttention(a, b)).toBeLessThan(0);
    expect(compareAttention(b, a)).toBeGreaterThan(0);
    expect(compareAttention(a, { ...a })).toBe(0);
  });
});

describe("win rate", () => {
  it("is won / (won + lost), null without closed deals", () => {
    expect(winRate(1, 1)).toBe(0.5);
    expect(winRate(2, 1)).toBeCloseTo(2 / 3);
    expect(winRate(0, 3)).toBe(0);
    expect(winRate(0, 0)).toBeNull();
  });

  it("formats as a rounded percentage or an em dash", () => {
    expect(formatWinRate(2 / 3)).toBe("67%");
    expect(formatWinRate(1)).toBe("100%");
    expect(formatWinRate(0)).toBe("0%");
    expect(formatWinRate(null)).toBe("—");
  });

  it("covers the 90 org calendar days ending today", () => {
    expect(winRateWindow("2026-10-06")).toEqual({ from: "2026-07-09", to: "2026-10-06" });
    expect(winRateWindow("2026-03-01", 1)).toEqual({ from: "2026-03-01", to: "2026-03-01" });
  });
});

describe("summarizePipelineValue", () => {
  it("keeps currencies apart and counts prospects without a value", () => {
    expect(
      summarizePipelineValue([
        { currency: "USD", total_value: "38500.00", prospect_count: 4 },
        { currency: null, total_value: null, prospect_count: 2 },
        { currency: "EUR", total_value: 4200, prospect_count: 1 },
      ]),
    ).toEqual({
      totals: [
        { currency: "EUR", total: 4200, count: 1 },
        { currency: "USD", total: 38500, count: 4 },
      ],
      withoutValueCount: 2,
      openCount: 7,
    });
  });

  it("handles no open prospects / only unvalued ones", () => {
    expect(summarizePipelineValue([])).toEqual({ totals: [], withoutValueCount: 0, openCount: 0 });
    expect(summarizePipelineValue([{ currency: null, total_value: null, prospect_count: 3 }])).toEqual({
      totals: [],
      withoutValueCount: 3,
      openCount: 3,
    });
  });
});

describe("greeting", () => {
  it("uses the org-local hour, not UTC", () => {
    // 15:30 UTC = 11:30 am New York (EDT) = 5:30 am Honolulu.
    const now = new Date("2026-10-06T15:30:00Z");
    expect(greetingFor("America/New_York", now)).toBe("Good morning");
    expect(greetingFor("Pacific/Honolulu", now)).toBe("Good morning");
    // 03:00 UTC = 11 pm New York (previous day).
    expect(greetingFor("America/New_York", new Date("2026-10-06T03:00:00Z"))).toBe("Good evening");
    expect(greetingFor("America/Los_Angeles", new Date("2026-10-06T20:00:00Z"))).toBe("Good afternoon");
    // 04:59 local → evening; 05:00 → morning; 12:00 → afternoon; 18:00 → evening.
    expect(greetingFor("America/New_York", new Date("2026-10-06T08:59:00Z"))).toBe("Good evening");
    expect(greetingFor("America/New_York", new Date("2026-10-06T09:00:00Z"))).toBe("Good morning");
    expect(greetingFor("America/New_York", new Date("2026-10-06T16:00:00Z"))).toBe("Good afternoon");
    expect(greetingFor("America/New_York", new Date("2026-10-06T22:00:00Z"))).toBe("Good evening");
  });

  it("first name", () => {
    expect(firstName("Riley Rep")).toBe("Riley");
    expect(firstName("  Morgan  ")).toBe("Morgan");
    expect(firstName("")).toBe("there");
    expect(firstName(null)).toBe("there");
  });
});
