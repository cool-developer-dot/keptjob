import { describe, expect, it } from "vitest";

import {
  DEFAULT_REPORTS_PARAMS,
  isValidCustomRange,
  parseReportsParams,
  reportQuerySchema,
  reportRangeFor,
  reportsHref,
} from "./reports";

const OWNER = "11111111-1111-4111-8111-000000000002";

describe("parseReportsParams", () => {
  it("defaults to the last 30 days", () => {
    expect(parseReportsParams({})).toEqual(DEFAULT_REPORTS_PARAMS);
    expect(parseReportsParams({ range: "bogus", owner: "not-a-uuid" })).toEqual(DEFAULT_REPORTS_PARAMS);
  });

  it("parses presets and ignores from/to for them", () => {
    expect(parseReportsParams({ range: "this_quarter", from: "2025-01-01", to: "2025-02-01", owner: OWNER })).toEqual({
      range: "this_quarter",
      from: null,
      to: null,
      owner: OWNER,
    });
  });

  it("parses a valid custom range (URLSearchParams too)", () => {
    expect(parseReportsParams(new URLSearchParams("range=custom&from=2025-09-01&to=2025-09-30"))).toEqual({
      range: "custom",
      from: "2025-09-01",
      to: "2025-09-30",
      owner: null,
    });
  });

  it("falls back to the default preset for an invalid custom range, keeping the owner", () => {
    for (const query of [
      "range=custom",
      "range=custom&from=2025-09-30&to=2025-09-01",
      "range=custom&from=2025-02-30&to=2025-03-01",
      "range=custom&from=2020-01-01&to=2025-01-01",
    ]) {
      expect(parseReportsParams(new URLSearchParams(`${query}&owner=${OWNER}`))).toEqual({
        ...DEFAULT_REPORTS_PARAMS,
        owner: OWNER,
      });
    }
  });

  it("validates custom spans", () => {
    expect(isValidCustomRange("2025-09-01", "2025-09-01")).toBe(true);
    expect(isValidCustomRange("2024-01-01", "2025-12-31")).toBe(true); // 731 days
    expect(isValidCustomRange("2024-01-01", "2026-01-01")).toBe(false);
    expect(isValidCustomRange(null, "2025-09-01")).toBe(false);
  });
});

describe("reportsHref / reportRangeFor", () => {
  it("writes non-default values only", () => {
    expect(reportsHref(DEFAULT_REPORTS_PARAMS)).toBe("/reports");
    expect(reportsHref(DEFAULT_REPORTS_PARAMS, { range: "this_month", owner: OWNER })).toBe(
      `/reports?range=this_month&owner=${OWNER}`,
    );
    expect(reportsHref(DEFAULT_REPORTS_PARAMS, { range: "custom", from: "2025-09-01", to: "2025-09-30" })).toBe(
      "/reports?range=custom&from=2025-09-01&to=2025-09-30",
    );
    // from/to dropped when leaving custom
    expect(
      reportsHref({ range: "custom", from: "2025-09-01", to: "2025-09-30", owner: null }, { range: "last_90" }),
    ).toBe("/reports?range=last_90");
  });

  it("round-trips through the parser", () => {
    const params = { range: "custom" as const, from: "2025-09-01", to: "2025-09-30", owner: OWNER };
    expect(parseReportsParams(new URLSearchParams(reportsHref(params).split("?")[1]))).toEqual(params);
  });

  it("resolves the period", () => {
    expect(reportRangeFor(DEFAULT_REPORTS_PARAMS, "2026-10-06")).toEqual({ from: "2026-09-07", to: "2026-10-06" });
    expect(reportRangeFor({ range: "custom", from: "2025-09-01", to: "2025-09-30", owner: null }, "2026-10-06")).toEqual({
      from: "2025-09-01",
      to: "2025-09-30",
    });
  });
});

describe("reportQuerySchema", () => {
  it("accepts a period and rejects reversed / invalid input", () => {
    expect(reportQuerySchema.safeParse({ from: "2025-09-01", to: "2025-09-30", ownerId: OWNER }).success).toBe(true);
    expect(reportQuerySchema.safeParse({ from: "2025-09-30", to: "2025-09-01" }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ from: "2025-09-01", to: "2025-09-30", extra: 1 }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ from: "2025-09-01", to: "2025-09-30", ownerId: "x" }).success).toBe(false);
  });
});
