import { describe, expect, it } from "vitest";

import {
  closedOutcomeQuerySchema,
  dashboardHref,
  dashboardKpiQuerySchema,
  dashboardListQuerySchema,
  parseDashboardParams,
} from "./dashboard";

const ID = "11111111-1111-4111-8111-000000000002";

describe("parseDashboardParams / dashboardHref", () => {
  it("parses a valid owner and ignores junk", () => {
    expect(parseDashboardParams({ owner: ID })).toEqual({ owner: ID });
    expect(parseDashboardParams({ owner: [ID, "x"] })).toEqual({ owner: ID });
    expect(parseDashboardParams({ owner: "not-a-uuid" })).toEqual({ owner: null });
    expect(parseDashboardParams({})).toEqual({ owner: null });
    expect(parseDashboardParams(new URLSearchParams(`owner=${ID}&x=1`))).toEqual({ owner: ID });
  });

  it("builds hrefs with the owner only when set", () => {
    expect(dashboardHref({ owner: null })).toBe("/dashboard");
    expect(dashboardHref({ owner: null }, { owner: ID })).toBe(`/dashboard?owner=${ID}`);
    expect(dashboardHref({ owner: ID }, { owner: null })).toBe("/dashboard");
  });
});

describe("data-function schemas", () => {
  it("KPI query needs a valid org-local date", () => {
    expect(dashboardKpiQuerySchema.safeParse({ today: "2026-10-06" }).success).toBe(true);
    expect(dashboardKpiQuerySchema.safeParse({ today: "2026-02-30" }).success).toBe(false);
    expect(dashboardKpiQuerySchema.safeParse({ today: "2026-10-06", extra: 1 }).success).toBe(false);
  });

  it("list query bounds the limit", () => {
    expect(dashboardListQuerySchema.safeParse({ limit: 15 }).success).toBe(true);
    expect(dashboardListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(dashboardListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(dashboardListQuerySchema.safeParse({ ownerId: "x" }).success).toBe(false);
  });

  it("closed outcome period must be ordered", () => {
    expect(closedOutcomeQuerySchema.safeParse({ from: "2026-07-09", to: "2026-10-06" }).success).toBe(true);
    expect(closedOutcomeQuerySchema.safeParse({ from: "2026-10-06", to: "2026-10-06" }).success).toBe(true);
    expect(closedOutcomeQuerySchema.safeParse({ from: "2026-10-07", to: "2026-10-06" }).success).toBe(false);
  });
});
