/**
 * Follow-ups page (Prompt 10) vocabulary + pure display helpers. Client-safe.
 * Bucketing itself lives in SQL (`follow_up_bucket()`, mirrored by
 * `followUpViewBucket()` in time.ts); this file only names and labels things.
 */
import { daysBetweenDateStrings, type DateString } from "@/lib/time";

/** Follow-up list tabs (= SQL bucket values shown on the page). */
export const FOLLOW_UP_LIST_TABS = ["overdue", "today", "upcoming", "completed"] as const;
export type FollowUpListTab = (typeof FOLLOW_UP_LIST_TABS)[number];

/** Every tab of /follow-ups, in display order ("attention" = Needs attention). */
export const FOLLOW_UP_PAGE_TABS = [...FOLLOW_UP_LIST_TABS, "attention"] as const;
export type FollowUpPageTab = (typeof FOLLOW_UP_PAGE_TABS)[number];

export const FOLLOW_UP_TAB_LABELS: Record<FollowUpPageTab, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  completed: "Completed",
  attention: "Needs attention",
};

export function isFollowUpListTab(value: unknown): value is FollowUpListTab {
  return typeof value === "string" && (FOLLOW_UP_LIST_TABS as readonly string[]).includes(value);
}

export type FollowUpTabCounts = Record<FollowUpListTab, number>;

export const EMPTY_FOLLOW_UP_COUNTS: FollowUpTabCounts = {
  overdue: 0,
  today: 0,
  upcoming: 0,
  completed: 0,
};

/** Why an open deal needs attention (SPEC §9.6 stale + no next step). */
export type NeedsAttentionReason = "stale" | "no_follow_up";

/** Reasons for a prospects_with_flags row (callers pass open-stage rows only). */
export function needsAttentionReasons(row: {
  is_stale: boolean;
  follow_up_date: DateString | null;
}): NeedsAttentionReason[] {
  const reasons: NeedsAttentionReason[] = [];
  if (row.is_stale) reasons.push("stale");
  if (row.follow_up_date === null) reasons.push("no_follow_up");
  return reasons;
}

export function needsAttentionReasonLabel(reason: NeedsAttentionReason, staleDays: number): string {
  return reason === "stale" ? `No activity for ${staleDays}+ days` : "No follow-up scheduled";
}

/** "3 days overdue" / "Due today" / "Due tomorrow" / "In 4 days" relative to org today. */
export function dueRelativeLabel(dueDate: DateString, today: DateString): string {
  const days = daysBetweenDateStrings(today, dueDate);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${-days} days overdue`;
  return `In ${days} days`;
}

export const SNIPPET_MAX_CHARS = 140;

/**
 * Shortens a conversation snippet to `max` characters on a word boundary when
 * possible, collapsing whitespace; `fullLength` (the stored content length)
 * marks server-truncated text so an ellipsis is added.
 */
export function truncateSnippet(text: string, max: number = SNIPPET_MAX_CHARS, fullLength?: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const cut = clean.length > max;
  if (!cut) return fullLength !== undefined && fullLength > text.length ? `${clean}…` : clean;
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${base.replace(/[\s.,;:!?-]+$/, "")}…`;
}
