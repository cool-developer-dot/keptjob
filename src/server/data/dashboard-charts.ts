import "server-only";

import { z } from "zod";

import type { PipelineStage } from "@/lib/constants";
import {
  openStageCounts,
  type DailyActivityPoint,
  type StageCount,
  type TeamMemberSummary,
  type WeeklyFlowPoint,
} from "@/lib/dashboard-charts";
import type { ActionResult } from "@/server/actions/types";

import type { DataContext } from "./context";
import { dbFailure, ok, validationFailure } from "./errors";
import { effectiveOwner } from "./follow-up-views";

/**
 * Dashboard chart reads. Each is one RPC (security invoker → RLS: reps only
 * count their own rows); `ownerId` is honoured for managers only. SQL lives in
 * `supabase/migrations/20261014120000_dashboard_charts.sql`.
 */

export const DAILY_ACTIVITY_DAYS = 14;
export const WEEKLY_FLOW_WEEKS = 8;

export type DashboardCharts = {
  activity: DailyActivityPoint[];
  flow: WeeklyFlowPoint[];
  stages: StageCount[];
  /** Managers looking at the whole team only; null otherwise. */
  team: TeamMemberSummary[] | null;
};

const chartsQuerySchema = z.strictObject({
  ownerId: z.uuid().nullish(),
});
export type DashboardChartsQuery = z.input<typeof chartsQuerySchema>;

export async function getDashboardChartsData(
  ctx: DataContext,
  input: DashboardChartsQuery = {},
): Promise<ActionResult<DashboardCharts>> {
  const parsed = chartsQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);
  const owner = ownerId ? { p_owner_id: ownerId } : {};
  const wantTeam = ctx.user.role === "manager" && !ownerId;

  const [activity, flow, stages, team, users] = await Promise.all([
    ctx.supabase.rpc("dashboard_daily_activity", { p_days: DAILY_ACTIVITY_DAYS, ...owner }),
    ctx.supabase.rpc("dashboard_weekly_flow", { p_weeks: WEEKLY_FLOW_WEEKS, ...owner }),
    ctx.supabase.rpc("report_stage_counts", owner),
    wantTeam ? ctx.supabase.rpc("dashboard_team_summary") : Promise.resolve({ data: null, error: null }),
    wantTeam ? ctx.supabase.from("users").select("id, full_name") : Promise.resolve({ data: null, error: null }),
  ]);

  const failure =
    (activity.error && dbFailure("dashboardDailyActivity", activity.error, "Could not load the activity chart.")) ||
    (flow.error && dbFailure("dashboardWeeklyFlow", flow.error, "Could not load the deal flow chart.")) ||
    (stages.error && dbFailure("dashboardStageCounts", stages.error, "Could not load the stage chart.")) ||
    (team.error && dbFailure("dashboardTeamSummary", team.error, "Could not load the team summary.")) ||
    (users.error && dbFailure("dashboardTeamUsers", users.error, "Could not load the team."));
  if (failure) return failure;

  const names = new Map((users.data ?? []).map((user) => [user.id, user.full_name]));

  return ok({
    activity: (activity.data ?? []).map((row) => ({ day: row.day, count: row.activity_count })),
    flow: (flow.data ?? []).map((row) => ({
      weekStart: row.week_start,
      weekEnd: row.week_end,
      created: row.created_count,
      won: row.won_count,
    })),
    stages: openStageCounts(
      (stages.data ?? []).map((row) => ({ stage: row.stage as PipelineStage, count: row.prospect_count })),
    ),
    team: team.data
      ? team.data.map((row) => ({
          userId: row.user_id,
          name: names.get(row.user_id) || "Unnamed rep",
          open: row.open_count,
          stale: row.stale_count,
          overdue: row.overdue_count,
          won: row.won_count,
          lost: row.lost_count,
        }))
      : null,
  });
}
