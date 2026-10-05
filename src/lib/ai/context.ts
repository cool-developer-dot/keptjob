/**
 * Pure, deterministic builder of the AI insight input (SPEC §10: prospect
 * fields, objections, notes, recent activities, stage history, org "today").
 * Same input → same string (no clock reads; `now` is passed in). Dates are
 * rendered in the org timezone. Email / phone are deliberately not sent.
 */
import {
  ACTIVITY_TYPE_LABELS,
  DECISION_MAKER_STATUS_LABELS,
  OBJECTION_LABELS,
  STAGE_LABELS,
  closeReasonLabel,
  type ActivityType,
  type DecisionMakerStatus,
  type ObjectionCategory,
  type PipelineStage,
} from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import { formatOrgDateTime, isDateString, orgToday, type Instant } from "@/lib/time";

import { AI_CONTEXT_ACTIVITY_LIMIT } from "./limits";

export const NOT_RECORDED = "not recorded";
/** Per-field caps (characters) keep the prompt bounded. */
export const CONTEXT_FIELD_MAX = { notes: 4000, objectionNotes: 2000, closeNotes: 1000, activity: 800, note: 300 } as const;
/** Final safety cap for the whole context. */
export const CONTEXT_MAX_CHARS = 40_000;
export const PENDING_FOLLOW_UP_LIMIT = 10;

const DATE_TIME = "yyyy-MM-dd HH:mm";

export type InsightContextProspect = {
  name: string;
  company: string | null;
  stage: PipelineStage;
  decision_maker_status: DecisionMakerStatus;
  objections: readonly ObjectionCategory[] | null;
  objection_notes: string | null;
  notes: string | null;
  deal_value: number | string | null;
  currency: string;
  demo_at: string | null;
  follow_up_date: string | null;
  close_reason: string | null;
  close_notes: string | null;
  closed_at: string | null;
  created_at: string;
  last_activity_at: string | null;
};

export type InsightContextActivity = {
  type: ActivityType;
  content: string | null;
  occurred_at: string;
  user_id: string | null;
  metadata?: unknown;
};

export type InsightContextStageChange = {
  from_stage: PipelineStage | null;
  to_stage: PipelineStage;
  changed_at: string;
  changed_by: string | null;
  close_reason: string | null;
  note: string | null;
};

export type InsightContextInput = {
  now: Instant;
  timezone: string;
  prospect: InsightContextProspect;
  /** Newest first (as read from the DB); any length — capped here. */
  activities: readonly InsightContextActivity[];
  /** Any order; sorted oldest → newest here. */
  stageHistory: readonly InsightContextStageChange[];
  /** Pending follow-ups (due_date "YYYY-MM-DD"); sorted by due date here. */
  pendingFollowUps: readonly { due_date: string; note: string }[];
  /** user id → display name. */
  users: ReadonlyMap<string, string>;
};

/** Activity types sent to the model: never its own previous output; stage changes come from stage history. */
const EXCLUDED_ACTIVITY_TYPES: readonly ActivityType[] = ["ai_insight", "stage_change"];

/** Collapses whitespace and truncates with an ellipsis. */
export function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
}

function textOr(value: string | null | undefined, max: number): string {
  return value && value.trim() !== "" ? clip(value, max) : NOT_RECORDED;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function name(users: ReadonlyMap<string, string>, id: string | null): string {
  if (!id) return "System";
  return users.get(id) ?? "Former user";
}

function stageLabel(stage: PipelineStage | null): string {
  return stage ? STAGE_LABELS[stage] : "(none)";
}

function activityLine(a: InsightContextActivity, input: InsightContextInput): string {
  const when = formatOrgDateTime(a.occurred_at, input.timezone, DATE_TIME);
  const who = name(input.users, a.user_id);
  const meta = record(a.metadata);
  let label: string = ACTIVITY_TYPE_LABELS[a.type];
  if (a.type === "follow_up") {
    const task = str(meta.task);
    const due = str(meta.due_date);
    const parts = [
      task ? `task: ${clip(task, CONTEXT_FIELD_MAX.note)}` : null,
      due && isDateString(due) ? `due ${due}` : null,
    ].filter((part): part is string => part !== null);
    label = `Follow-up completed${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
  } else if (a.type === "owner_change") {
    const from = str(meta.from_owner);
    const to = str(meta.to_owner);
    label = `Owner changed${from || to ? ` from ${name(input.users, from)} to ${name(input.users, to)}` : ""}`;
  }
  const content = a.content && a.content.trim() !== "" ? `: ${clip(a.content, CONTEXT_FIELD_MAX.activity)}` : "";
  return `- ${when} · ${label} by ${who}${content}`;
}

/** Builds the model input. Deterministic for a given input. */
export function buildInsightContext(input: InsightContextInput): string {
  const { prospect: p, timezone: tz } = input;
  const today = orgToday(tz, input.now);
  const weekday = formatOrgDateTime(input.now, tz, "EEEE");
  const nowMs = new Date(input.now).getTime();

  const objections = (p.objections ?? []).map((o) => OBJECTION_LABELS[o] ?? o);
  const closeReason = closeReasonLabel(p.stage, p.close_reason);
  const demo = p.demo_at
    ? `${formatOrgDateTime(p.demo_at, tz, DATE_TIME)} (${new Date(p.demo_at).getTime() > nowMs ? "upcoming" : "past"})`
    : NOT_RECORDED;

  const lines: string[] = [
    "# CRM record",
    `Today (org timezone ${tz}): ${today} (${weekday}). All times below are in ${tz}.`,
    "",
    "## Prospect",
    `- Name: ${clip(p.name, 200)}`,
    `- Company: ${textOr(p.company, 200)}`,
    `- Current stage: ${STAGE_LABELS[p.stage]}`,
    `- Decision maker (recorded): ${DECISION_MAKER_STATUS_LABELS[p.decision_maker_status]}`,
    `- Objections: ${objections.length > 0 ? objections.join(", ") : "none recorded"}`,
    `- Objection notes: ${textOr(p.objection_notes, CONTEXT_FIELD_MAX.objectionNotes)}`,
    `- Conversation notes: ${textOr(p.notes, CONTEXT_FIELD_MAX.notes)}`,
    `- Deal value: ${p.deal_value === null || p.deal_value === "" ? NOT_RECORDED : formatMoney(p.deal_value, p.currency)}`,
    `- Demo: ${demo}`,
    `- Next follow-up date: ${p.follow_up_date ? p.follow_up_date : "none scheduled"}`,
    `- Created: ${formatOrgDateTime(p.created_at, tz, DATE_TIME)}`,
    `- Last sales activity: ${p.last_activity_at ? formatOrgDateTime(p.last_activity_at, tz, DATE_TIME) : NOT_RECORDED}`,
  ];
  if (p.stage === "closed_won" || p.stage === "closed_lost") {
    lines.push(
      `- Close reason: ${closeReason ?? NOT_RECORDED}`,
      `- Close notes: ${textOr(p.close_notes, CONTEXT_FIELD_MAX.closeNotes)}`,
      `- Closed at: ${p.closed_at ? formatOrgDateTime(p.closed_at, tz, DATE_TIME) : NOT_RECORDED}`,
    );
  }

  const pending = [...input.pendingFollowUps]
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.note.localeCompare(b.note))
    .slice(0, PENDING_FOLLOW_UP_LIMIT);
  lines.push("", "## Pending follow-ups (soonest first)");
  if (pending.length === 0) lines.push("- none");
  for (const f of pending) {
    lines.push(`- due ${f.due_date}: ${clip(f.note, CONTEXT_FIELD_MAX.note)}`);
  }

  const recent = input.activities
    .filter((a) => !EXCLUDED_ACTIVITY_TYPES.includes(a.type))
    .slice(0, AI_CONTEXT_ACTIVITY_LIMIT)
    .reverse();
  lines.push("", `## Recent activities (last ${AI_CONTEXT_ACTIVITY_LIMIT}, oldest first)`);
  if (recent.length === 0) lines.push("- none");
  for (const a of recent) lines.push(activityLine(a, input));

  const history = [...input.stageHistory].sort((a, b) => a.changed_at.localeCompare(b.changed_at));
  lines.push("", "## Stage history (oldest first)");
  if (history.length === 0) lines.push("- none");
  for (const h of history) {
    const reason = closeReasonLabel(h.to_stage, h.close_reason);
    lines.push(
      `- ${formatOrgDateTime(h.changed_at, tz, DATE_TIME)} · ${stageLabel(h.from_stage)} → ${stageLabel(h.to_stage)} by ${name(input.users, h.changed_by)}${
        reason ? ` (reason: ${reason})` : ""
      }${h.note && h.note.trim() !== "" ? `: ${clip(h.note, CONTEXT_FIELD_MAX.note)}` : ""}`,
    );
  }

  const text = lines.join("\n");
  return text.length > CONTEXT_MAX_CHARS ? `${text.slice(0, CONTEXT_MAX_CHARS - 1)}…` : text;
}
