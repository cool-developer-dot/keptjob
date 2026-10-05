/**
 * Prospect activity timeline (SPEC §7), pure: turns activities + the initial
 * stage_history row into display entries, newest first. Metadata written by the
 * DB triggers / data layer is parsed defensively — an unexpected shape never
 * crashes the page, it just shows less detail.
 *
 * Metadata shapes (see supabase/migrations/*_functions_triggers.sql and
 * src/server/data/follow-ups.ts):
 * - stage_change: { from, to, close_reason }   (content = optional stage note)
 * - owner_change: { from_owner, to_owner }     (user ids)
 * - follow_up:    { follow_up_id, due_date, task, bulk? } (content = outcome note ?? task)
 * - ai_insight:   { insight_id?, deal_health? } (content = summary; Prompt 11)
 */
import {
  ACTIVITY_TYPES,
  DEAL_HEALTH_VALUES,
  PIPELINE_STAGES,
  closeReasonLabel,
  type ActivityType,
  type DealHealth,
  type PipelineStage,
} from "@/lib/constants";
import { isDateString } from "@/lib/time";

export type TimelineActivity = {
  id: string;
  user_id: string | null;
  type: ActivityType;
  content: string | null;
  metadata: unknown;
  occurred_at: string;
  created_at: string;
};

export type TimelineStageHistory = {
  id: string;
  from_stage: PipelineStage | null;
  to_stage: PipelineStage;
  changed_by: string | null;
  changed_at: string;
};

export type TimelineUser = { id: string; full_name: string };

export type TimelineDetail =
  | {
      kind: "stage_change";
      from: PipelineStage | null;
      to: PipelineStage | null;
      /** Label (won/lost list by target stage), or null. */
      closeReason: string | null;
    }
  | { kind: "owner_change"; fromName: string | null; toName: string | null }
  | { kind: "follow_up"; task: string | null; dueDate: string | null }
  | { kind: "ai_insight"; dealHealth: DealHealth | null }
  | { kind: "created"; stage: PipelineStage }
  | { kind: "basic" };

export type TimelineEntry = {
  /** Unique key: "activity:<id>" or "created:<stage_history id>". */
  key: string;
  type: ActivityType | "created";
  at: string;
  authorName: string;
  /** True when no user wrote it (seed/system writes: user_id null). */
  isSystem: boolean;
  content: string | null;
  detail: TimelineDetail;
};

export const SYSTEM_AUTHOR = "System";
export const FORMER_USER = "Former user";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : null;
}

function userName(users: ReadonlyMap<string, string>, id: string | null): string {
  if (!id) return SYSTEM_AUTHOR;
  return users.get(id) ?? FORMER_USER;
}

function detailFor(activity: TimelineActivity, users: ReadonlyMap<string, string>): TimelineDetail {
  const meta = record(activity.metadata);
  switch (activity.type) {
    case "stage_change": {
      const from = oneOf(PIPELINE_STAGES, meta.from);
      const to = oneOf(PIPELINE_STAGES, meta.to);
      return { kind: "stage_change", from, to, closeReason: to ? closeReasonLabel(to, str(meta.close_reason)) : null };
    }
    case "owner_change": {
      const fromId = str(meta.from_owner);
      const toId = str(meta.to_owner);
      return {
        kind: "owner_change",
        fromName: fromId ? userName(users, fromId) : null,
        toName: toId ? userName(users, toId) : null,
      };
    }
    case "follow_up": {
      const due = str(meta.due_date);
      return { kind: "follow_up", task: str(meta.task), dueDate: due && isDateString(due) ? due : null };
    }
    case "ai_insight":
      return { kind: "ai_insight", dealHealth: oneOf(DEAL_HEALTH_VALUES, meta.deal_health) };
    default:
      return { kind: "basic" };
  }
}

/**
 * Builds the timeline: every activity + a synthetic "created" entry from the
 * first stage_history row (from_stage null; the insert trigger writes no
 * activity). Sorted newest first by time, then by creation time / key.
 */
export function buildTimeline({
  activities,
  stageHistory = [],
  users,
}: {
  activities: readonly TimelineActivity[];
  stageHistory?: readonly TimelineStageHistory[];
  users: readonly TimelineUser[];
}): TimelineEntry[] {
  const names = new Map(users.map((user) => [user.id, user.full_name]));
  const entries: TimelineEntry[] = [];
  // Secondary sort key (created_at) per entry key.
  const tiebreaks = new Map<string, string>();

  for (const activity of activities) {
    if (!oneOf(ACTIVITY_TYPES, activity.type)) continue;
    entries.push({
      key: `activity:${activity.id}`,
      type: activity.type,
      at: activity.occurred_at,
      authorName: userName(names, activity.user_id),
      isSystem: activity.user_id === null,
      content: str(activity.content),
      detail: detailFor(activity, names),
    });
    tiebreaks.set(`activity:${activity.id}`, activity.created_at);
  }

  const created = stageHistory
    .filter((row) => row.from_stage === null)
    .sort((a, b) => a.changed_at.localeCompare(b.changed_at))[0];
  if (created) {
    entries.push({
      key: `created:${created.id}`,
      type: "created",
      at: created.changed_at,
      authorName: userName(names, created.changed_by),
      isSystem: created.changed_by === null,
      content: null,
      detail: { kind: "created", stage: created.to_stage },
    });
    // No tiebreak: sorts below anything else written in the same instant.
  }

  const time = (value: string | undefined) => (value ? new Date(value).getTime() || 0 : 0);
  return entries.sort(
    (a, b) =>
      time(b.at) - time(a.at) ||
      time(tiebreaks.get(b.key)) - time(tiebreaks.get(a.key)) ||
      b.key.localeCompare(a.key),
  );
}
