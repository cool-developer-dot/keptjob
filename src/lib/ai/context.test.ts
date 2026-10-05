import { describe, expect, it } from "vitest";

import {
  buildInsightContext,
  clip,
  CONTEXT_FIELD_MAX,
  NOT_RECORDED,
  type InsightContextActivity,
  type InsightContextInput,
} from "./context";
import { AI_CONTEXT_ACTIVITY_LIMIT } from "./limits";

const RILEY = "11111111-1111-4111-8111-000000000002";
const MORGAN = "11111111-1111-4111-8111-000000000001";
const TZ = "America/New_York";
// 11:30 pm in New York on Mon 2026-03-09 (already 2026-03-10 in UTC).
const NOW = "2026-03-10T03:30:00Z";

function base(overrides: Partial<InsightContextInput> = {}): InsightContextInput {
  return {
    now: NOW,
    timezone: TZ,
    prospect: {
      name: "Jordan Lee",
      company: "Acme Inc",
      stage: "qualified",
      decision_maker_status: "unknown",
      objections: ["price", "timing"],
      objection_notes: "Thinks we're 20% too expensive.",
      notes: "Met at the expo. Wants a pilot for 5 seats.",
      deal_value: 12000,
      currency: "USD",
      demo_at: "2026-03-12T18:30:00Z",
      follow_up_date: "2026-03-11",
      close_reason: null,
      close_notes: null,
      closed_at: null,
      created_at: "2026-02-01T15:00:00Z",
      last_activity_at: "2026-03-08T16:00:00Z",
    },
    activities: [
      { type: "call", content: "Second call, budget discussed.", occurred_at: "2026-03-08T16:00:00Z", user_id: RILEY },
      { type: "ai_insight", content: "Old AI summary", occurred_at: "2026-03-07T12:00:00Z", user_id: RILEY },
      { type: "stage_change", content: null, occurred_at: "2026-03-06T12:00:00Z", user_id: RILEY },
      { type: "note", content: "First contact via email.", occurred_at: "2026-03-01T14:00:00Z", user_id: MORGAN },
    ],
    stageHistory: [
      { from_stage: "contacted", to_stage: "qualified", changed_at: "2026-03-06T12:00:00Z", changed_by: RILEY, close_reason: null, note: "Budget confirmed" },
      { from_stage: null, to_stage: "prospect", changed_at: "2026-02-01T15:00:00Z", changed_by: null, close_reason: null, note: null },
      { from_stage: "prospect", to_stage: "contacted", changed_at: "2026-02-02T15:00:00Z", changed_by: "99999999-9999-4999-8999-999999999999", close_reason: null, note: null },
    ],
    pendingFollowUps: [
      { due_date: "2026-03-20", note: "Send pricing" },
      { due_date: "2026-03-11", note: "Call about pilot" },
    ],
    users: new Map([
      [RILEY, "Riley Rep"],
      [MORGAN, "Morgan Manager"],
    ]),
    ...overrides,
  };
}

describe("buildInsightContext", () => {
  it("is deterministic (same input → same string)", () => {
    expect(buildInsightContext(base())).toBe(buildInsightContext(base()));
  });

  it("uses the org-timezone today (11:30 pm New York = next day UTC)", () => {
    const text = buildInsightContext(base());
    expect(text).toContain("Today (org timezone America/New_York): 2026-03-09 (Monday)");
    const honolulu = buildInsightContext(base({ timezone: "Pacific/Honolulu" }));
    expect(honolulu).toContain("2026-03-09");
  });

  it("includes prospect fields, labels, money, demo in org tz and follow-ups sorted", () => {
    const text = buildInsightContext(base());
    expect(text).toContain("- Name: Jordan Lee");
    expect(text).toContain("- Company: Acme Inc");
    expect(text).toContain("- Current stage: Qualified");
    expect(text).toContain("- Decision maker (recorded): Unknown");
    expect(text).toContain("- Objections: Price, Timing");
    expect(text).toContain("- Objection notes: Thinks we're 20% too expensive.");
    expect(text).toContain("- Conversation notes: Met at the expo. Wants a pilot for 5 seats.");
    expect(text).toContain("- Deal value: $12,000.00");
    expect(text).toContain("- Demo: 2026-03-12 14:30 (upcoming)");
    expect(text).toContain("- Next follow-up date: 2026-03-11");
    expect(text.indexOf("due 2026-03-11: Call about pilot")).toBeLessThan(text.indexOf("due 2026-03-20: Send pricing"));
    expect(text).not.toContain("Close reason");
  });

  it("never sends email / phone", () => {
    const input = base();
    const prospect = { ...input.prospect, email: "jordan@acme.test", phone: "+1 555 0100" };
    const text = buildInsightContext({ ...input, prospect });
    expect(text).not.toContain("jordan@acme.test");
    expect(text).not.toContain("555 0100");
  });

  it("says 'not recorded' / 'none' when data is missing", () => {
    const input = base();
    const text = buildInsightContext({
      ...input,
      prospect: {
        ...input.prospect,
        company: null,
        objections: [],
        objection_notes: "  ",
        notes: null,
        deal_value: null,
        demo_at: null,
        follow_up_date: null,
        last_activity_at: null,
      },
      activities: [],
      stageHistory: [],
      pendingFollowUps: [],
    });
    expect(text).toContain(`- Company: ${NOT_RECORDED}`);
    expect(text).toContain("- Objections: none recorded");
    expect(text).toContain(`- Objection notes: ${NOT_RECORDED}`);
    expect(text).toContain(`- Conversation notes: ${NOT_RECORDED}`);
    expect(text).toContain(`- Deal value: ${NOT_RECORDED}`);
    expect(text).toContain(`- Demo: ${NOT_RECORDED}`);
    expect(text).toContain("- Next follow-up date: none scheduled");
    expect(text.match(/^- none$/gm)).toHaveLength(3);
  });

  it("renders activities oldest first in the org tz (EST → EDT on Mar 8), excludes ai_insight + stage_change, names authors", () => {
    const text = buildInsightContext(base());
    expect(text).not.toContain("Old AI summary");
    expect(text).toContain("- 2026-03-01 09:00 · Note by Morgan Manager: First contact via email.");
    expect(text).toContain("- 2026-03-08 12:00 · Call by Riley Rep: Second call, budget discussed.");
    expect(text.indexOf("First contact")).toBeLessThan(text.indexOf("Second call"));
    expect(text).not.toMatch(/· Stage change by/);
  });

  it(`caps activities at the newest ${AI_CONTEXT_ACTIVITY_LIMIT} (after exclusions)`, () => {
    const activities: InsightContextActivity[] = [
      { type: "ai_insight", content: "skip me", occurred_at: "2026-03-09T12:00:00Z", user_id: RILEY },
      ...Array.from({ length: 35 }, (_, i) => ({
        type: "note" as const,
        content: `note #${i + 1}`,
        // #1 is the newest.
        occurred_at: new Date(Date.UTC(2026, 2, 9, 12) - (i + 1) * 3_600_000).toISOString(),
        user_id: RILEY,
      })),
    ];
    const text = buildInsightContext(base({ activities }));
    expect(text).toContain("note #1\n");
    expect(text).toContain(`note #${AI_CONTEXT_ACTIVITY_LIMIT}\n`);
    expect(text).not.toContain(`note #${AI_CONTEXT_ACTIVITY_LIMIT + 1}`);
    expect(text.match(/· Note by/g)).toHaveLength(AI_CONTEXT_ACTIVITY_LIMIT);
    expect(text.indexOf(`note #${AI_CONTEXT_ACTIVITY_LIMIT}\n`)).toBeLessThan(text.indexOf("note #1\n"));
  });

  it("describes follow-up and owner-change activities from metadata", () => {
    const text = buildInsightContext(
      base({
        activities: [
          { type: "follow_up", content: "Left a voicemail", occurred_at: "2026-03-05T15:00:00Z", user_id: RILEY, metadata: { task: "Call back", due_date: "2026-03-05" } },
          { type: "owner_change", content: null, occurred_at: "2026-03-04T15:00:00Z", user_id: MORGAN, metadata: { from_owner: MORGAN, to_owner: RILEY } },
        ],
      }),
    );
    expect(text).toContain("Follow-up completed (task: Call back, due 2026-03-05) by Riley Rep: Left a voicemail");
    expect(text).toContain("Owner changed from Morgan Manager to Riley Rep by Morgan Manager");
  });

  it("renders the full stage history oldest first with System / Former user", () => {
    const text = buildInsightContext(base());
    const created = text.indexOf("(none) → Prospect by System");
    const contacted = text.indexOf("Prospect → Contacted by Former user");
    const qualified = text.indexOf("Contacted → Qualified by Riley Rep: Budget confirmed");
    expect(created).toBeGreaterThan(-1);
    expect(created).toBeLessThan(contacted);
    expect(contacted).toBeLessThan(qualified);
  });

  it("includes close info for closed deals (reason label from the right list)", () => {
    const input = base();
    const text = buildInsightContext({
      ...input,
      prospect: {
        ...input.prospect,
        stage: "closed_lost",
        close_reason: "no_budget",
        close_notes: "Budget frozen until Q3",
        closed_at: "2026-03-08T20:00:00Z",
        demo_at: "2026-03-01T15:00:00Z",
      },
      stageHistory: [
        { from_stage: "qualified", to_stage: "closed_lost", changed_at: "2026-03-08T20:00:00Z", changed_by: RILEY, close_reason: "no_budget", note: null },
      ],
    });
    expect(text).toContain("- Close reason: No budget");
    expect(text).toContain("- Close notes: Budget frozen until Q3");
    expect(text).toContain("- Closed at: 2026-03-08 16:00");
    expect(text).toContain("- Demo: 2026-03-01 10:00 (past)");
    expect(text).toContain("Qualified → Closed Lost by Riley Rep (reason: No budget)");
  });

  it("truncates long free text", () => {
    const input = base();
    const long = "word ".repeat(2000);
    const text = buildInsightContext({ ...input, prospect: { ...input.prospect, notes: long } });
    const line = text.split("\n").find((l) => l.startsWith("- Conversation notes: "))!;
    expect(line.length).toBeLessThanOrEqual("- Conversation notes: ".length + CONTEXT_FIELD_MAX.notes);
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("clip", () => {
  it("collapses whitespace and truncates with an ellipsis", () => {
    expect(clip("  a \n\n b  ", 10)).toBe("a b");
    expect(clip("abcdefghij", 5)).toBe("abcd…");
    expect(clip("abcde", 5)).toBe("abcde");
  });
});
