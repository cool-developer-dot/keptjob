import { describe, expect, it } from "vitest";

import { PIPELINE_STAGES } from "@/lib/constants";

import { applyOverrides, groupByStage, initials, reconcileOverrides, summarizeColumn } from "./pipeline";

describe("summarizeColumn", () => {
  it("empty column → count 0, no totals", () => {
    expect(summarizeColumn([])).toEqual({ count: 0, totals: [] });
  });

  it("counts every card but sums only the ones with a value", () => {
    expect(
      summarizeColumn([
        { deal_value: 1000, currency: "USD" },
        { deal_value: null, currency: "USD" },
        { deal_value: 250.5, currency: "USD" },
      ]),
    ).toEqual({ count: 3, totals: [{ currency: "USD", total: 1250.5 }] });
  });

  it("never sums across currencies (sorted by code, codes normalized)", () => {
    expect(
      summarizeColumn([
        { deal_value: 100, currency: "usd" },
        { deal_value: 50, currency: "EUR" },
        { deal_value: 25, currency: "USD " },
      ]).totals,
    ).toEqual([
      { currency: "EUR", total: 50 },
      { currency: "USD", total: 125 },
    ]);
  });

  it("adds in cents (no float drift)", () => {
    expect(
      summarizeColumn([
        { deal_value: 0.1, currency: "USD" },
        { deal_value: 0.2, currency: "USD" },
      ]).totals,
    ).toEqual([{ currency: "USD", total: 0.3 }]);
  });
});

describe("groupByStage", () => {
  it("returns every stage in SPEC order and keeps input order", () => {
    const columns = groupByStage([
      { id: "a", stage: "qualified" as const },
      { id: "b", stage: "prospect" as const },
      { id: "c", stage: "qualified" as const },
    ]);
    expect(Object.keys(columns)).toEqual([...PIPELINE_STAGES]);
    expect(columns.qualified.map((c) => c.id)).toEqual(["a", "c"]);
    expect(columns.prospect.map((c) => c.id)).toEqual(["b"]);
    expect(columns.closed_won).toEqual([]);
  });
});

describe("initials", () => {
  it.each([
    ["Riley Rep", "RR"],
    ["Morgan  de la Cruz", "MC"],
    ["madonna", "MA"],
    ["  ", "?"],
  ])("%s → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe("optimistic overrides", () => {
  const cards = [
    { id: "a", stage: "prospect" as const },
    { id: "b", stage: "contacted" as const },
  ];

  it("applyOverrides moves the overridden cards only", () => {
    const result = applyOverrides(cards, { a: { from: "prospect", to: "qualified", settled: false } });
    expect(result).toEqual([
      { id: "a", stage: "qualified" },
      { id: "b", stage: "contacted" },
    ]);
    expect(result[1]).toBe(cards[1]);
  });

  it("an in-flight (unsettled) override survives a stale snapshot", () => {
    const overrides = { a: { from: "prospect" as const, to: "qualified" as const, settled: false } };
    expect(reconcileOverrides(cards, overrides)).toBe(overrides);
  });

  it("a settled override stays while the server still shows the old stage", () => {
    const overrides = { a: { from: "prospect" as const, to: "qualified" as const, settled: true } };
    expect(reconcileOverrides(cards, overrides)).toBe(overrides);
  });

  it("a settled override is dropped once the server shows another stage", () => {
    const overrides = { a: { from: "prospect" as const, to: "qualified" as const, settled: true } };
    expect(reconcileOverrides([{ id: "a", stage: "qualified" }], overrides)).toEqual({});
    // Someone else moved it elsewhere meanwhile: the server wins.
    expect(reconcileOverrides([{ id: "a", stage: "follow_up" }], overrides)).toEqual({});
  });

  it("overrides of cards that disappeared are dropped", () => {
    const overrides = {
      a: { from: "prospect" as const, to: "qualified" as const, settled: false },
      gone: { from: "prospect" as const, to: "qualified" as const, settled: false },
    };
    expect(reconcileOverrides(cards, overrides)).toEqual({ a: overrides.a });
  });
});
