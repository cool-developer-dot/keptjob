import { describe, expect, it } from "vitest";

import {
  FOLLOW_UP_PAGE_TABS,
  FOLLOW_UP_TAB_LABELS,
  dueRelativeLabel,
  isFollowUpListTab,
  needsAttentionReasonLabel,
  needsAttentionReasons,
  truncateSnippet,
} from "./follow-ups";

describe("tabs", () => {
  it("are in display order with labels", () => {
    expect(FOLLOW_UP_PAGE_TABS).toEqual(["overdue", "today", "upcoming", "completed", "attention"]);
    expect(FOLLOW_UP_PAGE_TABS.map((tab) => FOLLOW_UP_TAB_LABELS[tab])).toEqual([
      "Overdue",
      "Today",
      "Upcoming",
      "Completed",
      "Needs attention",
    ]);
    expect(isFollowUpListTab("today")).toBe(true);
    expect(isFollowUpListTab("attention")).toBe(false);
    expect(isFollowUpListTab("later")).toBe(false);
  });
});

describe("needsAttentionReasons", () => {
  it("lists stale and/or missing follow-up", () => {
    expect(needsAttentionReasons({ is_stale: true, follow_up_date: null })).toEqual(["stale", "no_follow_up"]);
    expect(needsAttentionReasons({ is_stale: true, follow_up_date: "2026-10-01" })).toEqual(["stale"]);
    expect(needsAttentionReasons({ is_stale: false, follow_up_date: null })).toEqual(["no_follow_up"]);
    expect(needsAttentionReasons({ is_stale: false, follow_up_date: "2026-10-01" })).toEqual([]);
  });

  it("labels reasons with the org stale_days", () => {
    expect(needsAttentionReasonLabel("stale", 14)).toBe("No activity for 14+ days");
    expect(needsAttentionReasonLabel("no_follow_up", 14)).toBe("No follow-up scheduled");
  });
});

describe("dueRelativeLabel", () => {
  it("is relative to the org today", () => {
    expect(dueRelativeLabel("2026-10-05", "2026-10-05")).toBe("Due today");
    expect(dueRelativeLabel("2026-10-06", "2026-10-05")).toBe("Due tomorrow");
    expect(dueRelativeLabel("2026-10-09", "2026-10-05")).toBe("In 4 days");
    expect(dueRelativeLabel("2026-10-04", "2026-10-05")).toBe("1 day overdue");
    expect(dueRelativeLabel("2026-09-28", "2026-10-05")).toBe("7 days overdue");
  });
});

describe("truncateSnippet", () => {
  it("keeps short text, collapsing whitespace", () => {
    expect(truncateSnippet("  Called   about\nthe proposal ")).toBe("Called about the proposal");
  });

  it("cuts long text on a word boundary with an ellipsis", () => {
    const text = "Discussed pricing for the annual plan and the volume discount they asked for last week";
    const out = truncateSnippet(text, 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out).toBe("Discussed pricing for the annual plan…");
  });

  it("adds an ellipsis when the server already shortened the text", () => {
    expect(truncateSnippet("short", 140, 500)).toBe("short…");
    expect(truncateSnippet("short", 140, 5)).toBe("short");
  });

  it("hard-cuts a single long word", () => {
    expect(truncateSnippet("x".repeat(50), 10)).toBe(`${"x".repeat(10)}…`);
  });
});
