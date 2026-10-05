import { describe, expect, it } from "vitest";

import { DEFAULT_FOLLOW_UPS_PARAMS, followUpsHref, parseFollowUpsParams } from "./follow-ups-page";

const OWNER = "11111111-1111-4111-8111-000000000002";

describe("parseFollowUpsParams", () => {
  it("defaults to the overdue tab without an owner", () => {
    expect(parseFollowUpsParams({})).toEqual(DEFAULT_FOLLOW_UPS_PARAMS);
    expect(parseFollowUpsParams(new URLSearchParams())).toEqual({
      tab: "overdue",
      owner: null,
    });
  });

  it("accepts every tab and a uuid owner", () => {
    for (const tab of ["overdue", "today", "upcoming", "completed", "attention"] as const) {
      expect(parseFollowUpsParams({ tab, owner: OWNER })).toEqual({
        tab,
        owner: OWNER,
      });
    }
  });

  it("falls back per key on invalid input", () => {
    expect(parseFollowUpsParams({ tab: "later", owner: "nope" })).toEqual({
      tab: "overdue",
      owner: null,
    });
    expect(parseFollowUpsParams({ tab: ["today", "completed"], owner: [OWNER] })).toEqual({
      tab: "today",
      owner: OWNER,
    });
    expect(parseFollowUpsParams(new URLSearchParams("tab=TODAY&owner=1"))).toEqual({ tab: "overdue", owner: null });
  });
});

describe("followUpsHref", () => {
  it("omits defaults and keeps the owner across tabs", () => {
    expect(followUpsHref(DEFAULT_FOLLOW_UPS_PARAMS)).toBe("/follow-ups");
    expect(followUpsHref(DEFAULT_FOLLOW_UPS_PARAMS, { tab: "today" })).toBe("/follow-ups?tab=today");
    expect(followUpsHref({ tab: "completed", owner: OWNER }, { tab: "attention" })).toBe(
      `/follow-ups?tab=attention&owner=${OWNER}`,
    );
    expect(followUpsHref({ tab: "today", owner: OWNER }, { owner: null })).toBe("/follow-ups?tab=today");
  });

  it("round-trips through the parser", () => {
    const params = { tab: "upcoming", owner: OWNER } as const;
    const href = followUpsHref(params);
    expect(parseFollowUpsParams(new URLSearchParams(href.split("?")[1]))).toEqual(params);
  });
});
