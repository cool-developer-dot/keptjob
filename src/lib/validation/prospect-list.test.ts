import { describe, expect, it } from "vitest";

import {
  clearFiltersHref,
  DEFAULT_PROSPECT_LIST_PARAMS,
  escapeLikePattern,
  hasActiveFilters,
  parseProspectListParams,
  prospectListHref,
  quotePostgrestValue,
  searchOrFilter,
  sortHref,
} from "./prospect-list";

const OWNER = "11111111-1111-4111-8111-000000000002";

describe("parseProspectListParams", () => {
  it("returns defaults for empty params", () => {
    expect(parseProspectListParams({})).toEqual(DEFAULT_PROSPECT_LIST_PARAMS);
  });

  it("parses every valid param", () => {
    expect(
      parseProspectListParams({
        q: "  acme   corp ",
        stage: "qualified",
        owner: OWNER,
        dm: "yes",
        objection: "price",
        overdue: "1",
        stale: "1",
        sort: "name",
        dir: "desc",
        page: "3",
      }),
    ).toEqual({
      q: "acme corp",
      stage: "qualified",
      owner: OWNER,
      dm: "yes",
      objection: "price",
      overdue: true,
      stale: true,
      sort: "name",
      dir: "desc",
      page: 3,
    });
  });

  it("falls back per key for invalid values (never throws)", () => {
    expect(
      parseProspectListParams({
        q: ["first", "second"],
        stage: "nope",
        owner: "not-a-uuid",
        dm: "maybe",
        objection: "PRICE",
        overdue: "yes",
        stale: "0",
        sort: "evil;drop",
        dir: "sideways",
        page: "abc",
      }),
    ).toEqual({ ...DEFAULT_PROSPECT_LIST_PARAMS, q: "first" });
    for (const page of ["0", "-2", "1.5", "99999999", ""]) {
      expect(parseProspectListParams({ page }).page).toBe(1);
    }
  });

  it("uses the column's default direction when dir is absent", () => {
    expect(parseProspectListParams({ sort: "name" }).dir).toBe("asc");
    expect(parseProspectListParams({ sort: "deal_value" }).dir).toBe("desc");
    expect(parseProspectListParams({ sort: "follow_up" }).dir).toBe("asc");
  });

  it("truncates long searches and accepts URLSearchParams", () => {
    const params = new URLSearchParams({ q: "x".repeat(300), stage: "prospect" });
    const parsed = parseProspectListParams(params);
    expect(parsed.q).toHaveLength(100);
    expect(parsed.stage).toBe("prospect");
  });
});

describe("hrefs", () => {
  const base = parseProspectListParams({ stage: "qualified", page: "4" });

  it("keeps URLs clean and resets the page on filter changes", () => {
    expect(prospectListHref(DEFAULT_PROSPECT_LIST_PARAMS)).toBe("/prospects");
    expect(prospectListHref(base)).toBe("/prospects?stage=qualified&page=4");
    expect(prospectListHref(base, { dm: "no" })).toBe("/prospects?stage=qualified&dm=no");
    expect(prospectListHref(base, { page: 5 })).toBe("/prospects?stage=qualified&page=5");
    expect(prospectListHref(base, { overdue: true, q: "a&b" })).toBe(
      "/prospects?q=a%26b&stage=qualified&overdue=1",
    );
  });

  it("toggles sort direction on the active column, else uses the column default", () => {
    expect(sortHref(DEFAULT_PROSPECT_LIST_PARAMS, "last_activity")).toBe(
      "/prospects?sort=last_activity&dir=asc",
    );
    expect(sortHref(DEFAULT_PROSPECT_LIST_PARAMS, "name")).toBe("/prospects?sort=name");
    const byName = parseProspectListParams({ sort: "name" });
    expect(sortHref(byName, "name")).toBe("/prospects?sort=name&dir=desc");
    expect(sortHref(base, "deal_value")).toBe("/prospects?stage=qualified&sort=deal_value");
  });

  it("clears filters but keeps the sort", () => {
    const params = parseProspectListParams({ q: "x", stale: "1", sort: "name", dir: "desc", page: "2" });
    expect(hasActiveFilters(params)).toBe(true);
    expect(clearFiltersHref(params)).toBe("/prospects?sort=name&dir=desc");
    expect(hasActiveFilters(parseProspectListParams({ sort: "name", page: "2" }))).toBe(false);
  });
});

describe("search escaping", () => {
  it("escapes LIKE metacharacters and maps * to a single-char wildcard", () => {
    expect(escapeLikePattern("50%_off\\x*")).toBe("50\\%\\_off\\\\x_");
  });

  it("quotes PostgREST values", () => {
    expect(quotePostgrestValue('a"b\\c,d')).toBe('"a\\"b\\\\c,d"');
  });

  it("builds an or-filter whose clauses can't be broken out of", () => {
    expect(searchOrFilter("acme, inc")).toBe(
      'name.ilike."%acme, inc%",company.ilike."%acme, inc%",email.ilike."%acme, inc%"',
    );
    const evil = searchOrFilter('x"),id.eq.1');
    expect(evil.split(".ilike.")).toHaveLength(4);
    expect(evil).toContain('"%x\\"),id.eq.1%"');
  });
});
