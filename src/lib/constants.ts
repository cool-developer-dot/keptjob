/**
 * Domain enums and labels, exactly as in SPEC.md. This is the single source for
 * enum values in TypeScript (Zod schemas, selects, badges). The database enums
 * (Prompt 1) must use the same values.
 */

type LabelMap<T extends string> = Readonly<Record<T, string>>;

function toOptions<T extends string>(values: readonly T[], labels: LabelMap<T>) {
  return values.map((value) => ({ value, label: labels[value] }));
}

// ---------------------------------------------------------------------------
// Pipeline stages (SPEC §2). Order matters: it drives the Kanban columns and
// the reporting funnel. closed_lost is not ranked in the funnel (SPEC §12).
// ---------------------------------------------------------------------------
export const PIPELINE_STAGES = [
  "prospect",
  "contacted",
  "conversation",
  "qualified",
  "demo_booked",
  "demo_attended",
  "follow_up",
  "closed_won",
  "closed_lost",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABELS: LabelMap<PipelineStage> = {
  prospect: "Prospect",
  contacted: "Contacted",
  conversation: "Conversation",
  qualified: "Qualified",
  demo_booked: "Demo Booked",
  demo_attended: "Demo Attended",
  follow_up: "Follow-up",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};
export const STAGE_OPTIONS = toOptions(PIPELINE_STAGES, STAGE_LABELS);

export const CLOSED_STAGES = ["closed_won", "closed_lost"] as const satisfies readonly PipelineStage[];
export type ClosedStage = (typeof CLOSED_STAGES)[number];

export const OPEN_STAGES = PIPELINE_STAGES.filter(
  (stage): stage is Exclude<PipelineStage, ClosedStage> =>
    !(CLOSED_STAGES as readonly string[]).includes(stage),
);

export function isClosedStage(stage: PipelineStage): stage is ClosedStage {
  return (CLOSED_STAGES as readonly string[]).includes(stage);
}

// ---------------------------------------------------------------------------
// Decision-maker status (SPEC §3, §10)
// ---------------------------------------------------------------------------
export const DECISION_MAKER_STATUSES = ["yes", "no", "unknown"] as const;
export type DecisionMakerStatus = (typeof DECISION_MAKER_STATUSES)[number];

export const DECISION_MAKER_STATUS_LABELS: LabelMap<DecisionMakerStatus> = {
  yes: "Yes",
  no: "No",
  unknown: "Unknown",
};
export const DECISION_MAKER_STATUS_OPTIONS = toOptions(
  DECISION_MAKER_STATUSES,
  DECISION_MAKER_STATUS_LABELS,
);

// ---------------------------------------------------------------------------
// Objection categories (SPEC §3, multi-select)
// ---------------------------------------------------------------------------
export const OBJECTION_CATEGORIES = [
  "price",
  "timing",
  "competitor",
  "budget",
  "no_authority",
  "not_interested",
  "other",
] as const;
export type ObjectionCategory = (typeof OBJECTION_CATEGORIES)[number];

export const OBJECTION_LABELS: LabelMap<ObjectionCategory> = {
  price: "Price",
  timing: "Timing",
  competitor: "Competitor",
  budget: "Budget",
  no_authority: "No authority",
  not_interested: "Not interested",
  other: "Other",
};
export const OBJECTION_OPTIONS = toOptions(OBJECTION_CATEGORIES, OBJECTION_LABELS);

// ---------------------------------------------------------------------------
// Close reasons (SPEC §3). Won reasons are proposed defaults the client may
// change; lost reasons are fixed.
// ---------------------------------------------------------------------------
export const WON_REASONS = [
  "product_fit",
  "price_value",
  "relationship",
  "urgent_need",
  "other",
] as const;
export type WonReason = (typeof WON_REASONS)[number];

export const WON_REASON_LABELS: LabelMap<WonReason> = {
  product_fit: "Product fit",
  price_value: "Price/value",
  relationship: "Relationship",
  urgent_need: "Urgent need",
  other: "Other",
};
export const WON_REASON_OPTIONS = toOptions(WON_REASONS, WON_REASON_LABELS);

export const LOST_REASONS = [
  "price",
  "timing",
  "competitor",
  "no_budget",
  "no_response",
  "not_a_fit",
  "other",
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const LOST_REASON_LABELS: LabelMap<LostReason> = {
  price: "Price",
  timing: "Timing",
  competitor: "Competitor",
  no_budget: "No budget",
  no_response: "No response",
  not_a_fit: "Not a fit",
  other: "Other",
};
export const LOST_REASON_OPTIONS = toOptions(LOST_REASONS, LOST_REASON_LABELS);

export type CloseReason = WonReason | LostReason;

// ---------------------------------------------------------------------------
// Activity types (SPEC §7)
// ---------------------------------------------------------------------------
export const ACTIVITY_TYPES = [
  "call",
  "conversation",
  "note",
  "demo",
  "follow_up",
  "stage_change",
  "owner_change",
  "ai_insight",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABELS: LabelMap<ActivityType> = {
  call: "Call",
  conversation: "Conversation",
  note: "Note",
  demo: "Demo",
  follow_up: "Follow-up",
  stage_change: "Stage change",
  owner_change: "Owner change",
  ai_insight: "AI insight",
};

/** Human sales activity that updates prospects.last_activity_at (SPEC §7). */
export const LAST_ACTIVITY_TYPES = [
  "call",
  "conversation",
  "note",
  "demo",
  "follow_up",
  "stage_change",
] as const satisfies readonly ActivityType[];

/** Types a user can log manually from the timeline (others are system-written). */
export const MANUAL_ACTIVITY_TYPES = [
  "call",
  "conversation",
  "note",
  "demo",
] as const satisfies readonly ActivityType[];

// ---------------------------------------------------------------------------
// Follow-ups (SPEC §8) and AI deal health (SPEC §10)
// ---------------------------------------------------------------------------
export const FOLLOW_UP_STATUSES = ["pending", "completed"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const DEAL_HEALTH_VALUES = ["high", "medium", "low"] as const;
export type DealHealth = (typeof DEAL_HEALTH_VALUES)[number];

export const DEAL_HEALTH_LABELS: LabelMap<DealHealth> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

// ---------------------------------------------------------------------------
// Roles (SPEC §4)
// ---------------------------------------------------------------------------
export const ROLES = ["manager", "sales_rep"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: LabelMap<Role> = {
  manager: "Admin/Manager",
  sales_rep: "Sales Rep",
};
export const ROLE_OPTIONS = toOptions(ROLES, ROLE_LABELS);

// ---------------------------------------------------------------------------
// Allowed org timezones (SPEC §5). The org's actual timezone comes from
// org_settings; never hardcode it elsewhere.
// ---------------------------------------------------------------------------
export const ALLOWED_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;
export type AllowedTimezone = (typeof ALLOWED_TIMEZONES)[number];

export const TIMEZONE_LABELS: LabelMap<AllowedTimezone> = {
  "America/New_York": "Eastern Time (New York)",
  "America/Chicago": "Central Time (Chicago)",
  "America/Denver": "Mountain Time (Denver)",
  "America/Phoenix": "Mountain Time, no DST (Phoenix)",
  "America/Los_Angeles": "Pacific Time (Los Angeles)",
  "America/Anchorage": "Alaska Time (Anchorage)",
  "Pacific/Honolulu": "Hawaii Time (Honolulu)",
};
export const TIMEZONE_OPTIONS = toOptions(ALLOWED_TIMEZONES, TIMEZONE_LABELS);
