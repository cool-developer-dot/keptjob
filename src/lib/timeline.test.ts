import { describe, expect, it } from "vitest";

import { buildTimeline, FORMER_USER, SYSTEM_AUTHOR, type TimelineActivity } from "./timeline";

const RILEY = "11111111-1111-4111-8111-000000000002";
const SAM = "11111111-1111-4111-8111-000000000003";
const users = [
  { id: RILEY, full_name: "Riley Rep" },
  { id: SAM, full_name: "Sam Rep" },
];

function activity(partial: Partial<TimelineActivity> & Pick<TimelineActivity, "id" | "type">): TimelineActivity {
  return {
    user_id: RILEY,
    content: null,
    metadata: {},
    occurred_at: "2026-10-05T12:00:00.000Z",
    created_at: "2026-10-05T12:00:00.000Z",
    ...partial,
  };
}

describe("buildTimeline", () => {
  it("sorts newest first (occurred_at, then created_at) with the created entry last", () => {
    const entries = buildTimeline({
      users,
      activities: [
        activity({ id: "a", type: "call", content: "Old call", occurred_at: "2026-10-01T10:00:00Z" }),
        activity({ id: "b", type: "note", content: "Newest", occurred_at: "2026-10-05T10:00:00Z", created_at: "2026-10-05T10:00:00Z" }),
        activity({
          id: "c",
          type: "note",
          content: "Same time, written later",
          occurred_at: "2026-10-05T10:00:00Z",
          created_at: "2026-10-05T11:00:00Z",
        }),
      ],
      stageHistory: [
        { id: "h2", from_stage: "prospect", to_stage: "contacted", changed_by: RILEY, changed_at: "2026-10-02T00:00:00Z" },
        { id: "h1", from_stage: null, to_stage: "prospect", changed_by: RILEY, changed_at: "2026-09-30T00:00:00Z" },
      ],
    });
    expect(entries.map((e) => e.key)).toEqual(["activity:c", "activity:b", "activity:a", "created:h1"]);
    expect(entries[3]).toMatchObject({ type: "created", authorName: "Riley Rep", detail: { kind: "created", stage: "prospect" } });
  });

  it("names the author, 'System' for null user_id and 'Former user' for unknown ids", () => {
    const entries = buildTimeline({
      users,
      activities: [
        activity({ id: "a", type: "note", content: "x", user_id: null, occurred_at: "2026-10-03T00:00:00Z" }),
        activity({ id: "b", type: "note", content: "y", user_id: "99999999-9999-4999-8999-999999999999", occurred_at: "2026-10-02T00:00:00Z" }),
        activity({ id: "c", type: "note", content: "z", user_id: SAM, occurred_at: "2026-10-01T00:00:00Z" }),
      ],
    });
    expect(entries.map((e) => [e.authorName, e.isSystem])).toEqual([
      [SYSTEM_AUTHOR, true],
      [FORMER_USER, false],
      ["Sam Rep", false],
    ]);
  });

  it("stage_change: from/to + close reason label from the right list, note as content", () => {
    const [lost, won, open] = buildTimeline({
      users,
      activities: [
        activity({
          id: "lost",
          type: "stage_change",
          content: "Went with a competitor",
          metadata: { from: "follow_up", to: "closed_lost", close_reason: "price" },
          occurred_at: "2026-10-03T00:00:00Z",
        }),
        activity({
          id: "won",
          type: "stage_change",
          metadata: { from: "closed_lost", to: "closed_won", close_reason: "price_value" },
          occurred_at: "2026-10-02T00:00:00Z",
        }),
        activity({
          id: "open",
          type: "stage_change",
          metadata: { from: "closed_won", to: "qualified", close_reason: null },
          occurred_at: "2026-10-01T00:00:00Z",
        }),
      ],
    });
    expect(lost.detail).toEqual({ kind: "stage_change", from: "follow_up", to: "closed_lost", closeReason: "Price" });
    expect(lost.content).toBe("Went with a competitor");
    expect(won.detail).toEqual({ kind: "stage_change", from: "closed_lost", to: "closed_won", closeReason: "Price/value" });
    expect(open.detail).toEqual({ kind: "stage_change", from: "closed_won", to: "qualified", closeReason: null });
  });

  it("owner_change resolves old → new owner names from metadata", () => {
    const [entry] = buildTimeline({
      users,
      activities: [activity({ id: "o", type: "owner_change", metadata: { from_owner: RILEY, to_owner: SAM } })],
    });
    expect(entry.detail).toEqual({ kind: "owner_change", fromName: "Riley Rep", toName: "Sam Rep" });
  });

  it("follow_up / ai_insight details; malformed metadata never throws", () => {
    const entries = buildTimeline({
      users,
      activities: [
        activity({
          id: "f",
          type: "follow_up",
          content: "Sent it",
          metadata: { follow_up_id: "x", due_date: "2026-10-04", task: "Send pricing" },
          occurred_at: "2026-10-05T00:00:00Z",
        }),
        activity({ id: "ai", type: "ai_insight", content: "Summary", metadata: { deal_health: "high" }, occurred_at: "2026-10-04T00:00:00Z" }),
        activity({ id: "bad1", type: "stage_change", metadata: null, occurred_at: "2026-10-03T00:00:00Z" }),
        activity({ id: "bad2", type: "owner_change", metadata: [1, 2], occurred_at: "2026-10-02T00:00:00Z" }),
        activity({ id: "bad3", type: "ai_insight", metadata: { deal_health: "great" }, occurred_at: "2026-10-01T00:00:00Z" }),
        activity({ id: "bad4", type: "follow_up", metadata: { due_date: "tomorrow" }, occurred_at: "2026-09-30T00:00:00Z" }),
      ],
    });
    expect(entries.map((e) => e.detail)).toEqual([
      { kind: "follow_up", task: "Send pricing", dueDate: "2026-10-04" },
      { kind: "ai_insight", dealHealth: "high" },
      { kind: "stage_change", from: null, to: null, closeReason: null },
      { kind: "owner_change", fromName: null, toName: null },
      { kind: "ai_insight", dealHealth: null },
      { kind: "follow_up", task: null, dueDate: null },
    ]);
  });

  it("blank content becomes null; unknown activity types are skipped", () => {
    const entries = buildTimeline({
      users,
      activities: [
        activity({ id: "a", type: "note", content: "   " }),
        activity({ id: "b", type: "email" as never, content: "x" }),
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBeNull();
  });
});
