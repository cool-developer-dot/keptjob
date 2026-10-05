import { describe, expect, it } from "vitest";

import {
  ACTIVITY_TYPES,
  ALLOWED_TIMEZONES,
  CLOSED_STAGES,
  DEAL_HEALTH_VALUES,
  DECISION_MAKER_STATUSES,
  FOLLOW_UP_STATUSES,
  LAST_ACTIVITY_TYPES,
  LOST_REASON_LABELS,
  LOST_REASONS,
  OBJECTION_CATEGORIES,
  OBJECTION_LABELS,
  OPEN_STAGES,
  PIPELINE_STAGES,
  ROLE_LABELS,
  ROLES,
  STAGE_LABELS,
  STAGE_OPTIONS,
  TIMEZONE_LABELS,
  WON_REASON_LABELS,
  WON_REASONS,
  isClosedStage,
} from "./constants";

describe("constants match SPEC.md", () => {
  it("pipeline stages are in SPEC §2 order with exact labels", () => {
    expect(PIPELINE_STAGES).toEqual([
      "prospect",
      "contacted",
      "conversation",
      "qualified",
      "demo_booked",
      "demo_attended",
      "follow_up",
      "closed_won",
      "closed_lost",
    ]);
    expect(STAGE_OPTIONS.map((o) => o.label)).toEqual([
      "Prospect",
      "Contacted",
      "Conversation",
      "Qualified",
      "Demo Booked",
      "Demo Attended",
      "Follow-up",
      "Closed Won",
      "Closed Lost",
    ]);
    expect(Object.keys(STAGE_LABELS)).toHaveLength(PIPELINE_STAGES.length);
  });

  it("splits open and closed stages", () => {
    expect(CLOSED_STAGES).toEqual(["closed_won", "closed_lost"]);
    expect(OPEN_STAGES).toEqual(PIPELINE_STAGES.slice(0, 7));
    expect(isClosedStage("closed_won")).toBe(true);
    expect(isClosedStage("closed_lost")).toBe(true);
    expect(isClosedStage("follow_up")).toBe(false);
  });

  it("objection categories (SPEC §3)", () => {
    expect(OBJECTION_CATEGORIES).toEqual([
      "price",
      "timing",
      "competitor",
      "budget",
      "no_authority",
      "not_interested",
      "other",
    ]);
    expect(OBJECTION_LABELS.no_authority).toBe("No authority");
    expect(OBJECTION_LABELS.not_interested).toBe("Not interested");
  });

  it("won and lost reasons (SPEC §3)", () => {
    expect(WON_REASONS).toEqual([
      "product_fit",
      "price_value",
      "relationship",
      "urgent_need",
      "other",
    ]);
    expect(WON_REASONS.map((r) => WON_REASON_LABELS[r])).toEqual([
      "Product fit",
      "Price/value",
      "Relationship",
      "Urgent need",
      "Other",
    ]);
    expect(LOST_REASONS).toEqual([
      "price",
      "timing",
      "competitor",
      "no_budget",
      "no_response",
      "not_a_fit",
      "other",
    ]);
    expect(LOST_REASONS.map((r) => LOST_REASON_LABELS[r])).toEqual([
      "Price",
      "Timing",
      "Competitor",
      "No budget",
      "No response",
      "Not a fit",
      "Other",
    ]);
  });

  it("activity types and last-activity subset (SPEC §7)", () => {
    expect(ACTIVITY_TYPES).toEqual([
      "call",
      "conversation",
      "note",
      "demo",
      "follow_up",
      "stage_change",
      "owner_change",
      "ai_insight",
    ]);
    expect(LAST_ACTIVITY_TYPES).not.toContain("ai_insight");
    expect(LAST_ACTIVITY_TYPES).not.toContain("owner_change");
    expect(LAST_ACTIVITY_TYPES).toHaveLength(6);
  });

  it("roles (SPEC §4)", () => {
    expect(ROLES).toEqual(["manager", "sales_rep"]);
    expect(ROLE_LABELS.sales_rep).toBe("Sales Rep");
  });

  it("allowed US timezones (SPEC §5)", () => {
    expect(ALLOWED_TIMEZONES).toEqual([
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Phoenix",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
    ]);
    expect(Object.keys(TIMEZONE_LABELS)).toEqual([...ALLOWED_TIMEZONES]);
    for (const tz of ALLOWED_TIMEZONES) {
      // Every timezone must be a valid IANA zone for Intl/@date-fns/tz.
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: tz })).not.toThrow();
    }
  });

  it("other SPEC enums", () => {
    expect(DECISION_MAKER_STATUSES).toEqual(["yes", "no", "unknown"]);
    expect(FOLLOW_UP_STATUSES).toEqual(["pending", "completed"]);
    expect(DEAL_HEALTH_VALUES).toEqual(["high", "medium", "low"]);
  });
});
