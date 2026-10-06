/**
 * Pure helpers for the dashboard charts (client-safe). The numbers come from
 * the SQL functions in `20261014120000_dashboard_charts.sql`; these only shape
 * them for display, so they are unit-tested without a database.
 */
import { OPEN_STAGES, type PipelineStage } from "@/lib/constants";
import type { DateString } from "@/lib/time";

export type DailyActivityPoint = { day: DateString; count: number };
export type WeeklyFlowPoint = { weekStart: DateString; weekEnd: DateString; created: number; won: number };
export type StageCount = { stage: PipelineStage; count: number };
export type TeamMemberSummary = {
  userId: string;
  name: string;
  open: number;
  stale: number;
  overdue: number;
  won: number;
  lost: number;
};

/** Totals for the last 7 days vs the 7 before (needs ≥ 14 points, oldest first). */
export function activityWeekOverWeek(points: readonly DailyActivityPoint[]): {
  thisWeek: number;
  lastWeek: number;
  /** Signed % change; null when last week had nothing to compare with. */
  changePct: number | null;
} {
  const thisWeek = points.slice(-7).reduce((sum, point) => sum + point.count, 0);
  const lastWeek = points.slice(-14, -7).reduce((sum, point) => sum + point.count, 0);
  const changePct = lastWeek === 0 ? null : Math.round(((thisWeek - lastWeek) / lastWeek) * 100);
  return { thisWeek, lastWeek, changePct };
}

/** Bar height as a share of the busiest day (0–1); an all-zero series stays flat. */
export function barShare(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0;
  return Math.min(1, count / max);
}

/** Open stages only, in SPEC order, zero-filled. */
export function openStageCounts(rows: readonly StageCount[]): StageCount[] {
  const byStage = new Map(rows.map((row) => [row.stage, row.count]));
  return OPEN_STAGES.map((stage) => ({ stage, count: byStage.get(stage) ?? 0 }));
}

/**
 * Gauge segments: the arc is the deals closed in the window, split won / lost,
 * so the green share equals the win rate printed in the middle. Both 0 when
 * nothing closed (the empty track shows instead).
 */
export function outcomeSegments(won: number, lost: number): { won: number; lost: number } {
  const total = won + lost;
  if (total <= 0) return { won: 0, lost: 0 };
  return { won: won / total, lost: lost / total };
}

/** Workload bar: open deals relative to the busiest rep (0–1). */
export function workloadShare(open: number, members: readonly TeamMemberSummary[]): number {
  const max = Math.max(0, ...members.map((member) => member.open));
  return max === 0 ? 0 : open / max;
}

/** Win rate in whole percent, null when nothing closed. */
export function wholeWinRate(won: number, lost: number): number | null {
  return won + lost === 0 ? null : Math.round((won / (won + lost)) * 100);
}
