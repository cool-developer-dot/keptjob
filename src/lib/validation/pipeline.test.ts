import { describe, expect, it } from "vitest";

import { hasActivePipelineFilters, parsePipelineParams, pipelineHref } from "./pipeline";

const OWNER = "11111111-1111-4111-8111-000000000002";

describe("parsePipelineParams", () => {
  it("defaults", () => {
    expect(parsePipelineParams({})).toEqual({ q: "", owner: null });
  });

  it("normalizes search and validates the owner independently", () => {
    expect(parsePipelineParams({ q: "  acme   corp ", owner: "nope" })).toEqual({ q: "acme corp", owner: null });
    expect(parsePipelineParams(new URLSearchParams({ owner: OWNER }))).toEqual({ q: "", owner: OWNER });
    expect(parsePipelineParams({ q: ["a", "b"] }).q).toBe("a");
    expect(parsePipelineParams({ q: "x".repeat(500) }).q).toHaveLength(100);
  });
});

describe("pipelineHref", () => {
  it("serializes non-default values only", () => {
    expect(pipelineHref({ q: "", owner: null })).toBe("/pipeline");
    expect(pipelineHref({ q: "acme co", owner: null })).toBe("/pipeline?q=acme+co");
    expect(pipelineHref({ q: "acme", owner: null }, { owner: OWNER })).toBe(`/pipeline?q=acme&owner=${OWNER}`);
    expect(pipelineHref({ q: "acme", owner: OWNER }, { q: "", owner: null })).toBe("/pipeline");
  });

  it("hasActivePipelineFilters", () => {
    expect(hasActivePipelineFilters({ q: "", owner: null })).toBe(false);
    expect(hasActivePipelineFilters({ q: "a", owner: null })).toBe(true);
    expect(hasActivePipelineFilters({ q: "", owner: OWNER })).toBe(true);
  });
});
