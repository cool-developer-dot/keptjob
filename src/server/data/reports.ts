import "server-only";

import { summarizePipelineValue, type PipelineValueSummary } from "@/lib/dashboard";
import {
  toFunnelSteps,
  toOutcomes,
  toReachedCounts,
  toStageCounts,
  type FunnelStep,
  type RankedStage,
  type ReportOutcomes,
  type StageCount,
} from "@/lib/reports";
import type { DateString } from "@/lib/time";
import { reportQuerySchema, type ReportQuery } from "@/lib/validation/reports";
import type { ActionResult } from "@/server/actions/types";

import type { DataContext } from "./context";
import { dbFailure, ok, validationFailure } from "./errors";
import { effectiveOwner } from "./follow-up-views";

/**
 * Reports (Prompt 13). Every number comes from a SQL report function
 * (security invoker → RLS: reps only ever see their own rows) called with the
 * user-scoped client; `ownerId` is honoured for managers only. Definitions
 * (SPEC §12) live in `supabase/migrations/20261011120000_reports.sql`:
 * - report_stage_counts   → prospects by current stage (now)
 * - report_stage_reached  → created in the period, highest stage ever reached ≥ X
 * - report_funnel         → the 7 funnel steps + step / overall conversion %
 * - report_outcomes       → closed in the period: won, lost, win rate, won value, lost reasons
 * - report_pipeline_value → open value per currency + without value (now)
 * - report_follow_ups     → overdue + due today (now), completed in the period
 */

export type ReportFollowUps = { overdue: number; dueToday: number; completed: number };

export type ReportData = {
  period: { from: DateString; to: DateString };
  /** Now: all 9 stages in SPEC order. */
  stageCounts: StageCount[];
  /** Now: all prospects (sum of stageCounts). */
  totalProspects: number;
  /** Created in the period: prospects that reached at least each ranked stage. */
  reached: Record<RankedStage, number>;
  /** Created in the period: SPEC §12 funnel. */
  funnel: FunnelStep[];
  /** Closed in the period. */
  outcomes: ReportOutcomes;
  /** Now. */
  pipelineValue: PipelineValueSummary;
  followUps: ReportFollowUps;
};

/** Every report number for one period (+ optional owner), 6 RPCs in parallel. */
export async function getReportData(ctx: DataContext, input: ReportQuery): Promise<ActionResult<ReportData>> {
  const parsed = reportQuerySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { from, to } = parsed.data;
  const ownerId = effectiveOwner(ctx, parsed.data.ownerId);
  const owner = ownerId ? { p_owner_id: ownerId } : {};
  const period = { p_from: from, p_to: to, ...owner };

  const [stageCounts, reached, funnel, outcomes, pipeline, followUps] = await Promise.all([
    ctx.supabase.rpc("report_stage_counts", owner),
    ctx.supabase.rpc("report_stage_reached", period),
    ctx.supabase.rpc("report_funnel", period),
    ctx.supabase.rpc("report_outcomes", period).maybeSingle(),
    ctx.supabase.rpc("report_pipeline_value", owner),
    ctx.supabase.rpc("report_follow_ups", period).maybeSingle(),
  ]);

  const failure =
    (stageCounts.error && dbFailure("reportStageCounts", stageCounts.error, "Could not load the stage counts.")) ||
    (reached.error && dbFailure("reportStageReached", reached.error, "Could not load the funnel.")) ||
    (funnel.error && dbFailure("reportFunnel", funnel.error, "Could not load the funnel.")) ||
    (outcomes.error && dbFailure("reportOutcomes", outcomes.error, "Could not load the win rate.")) ||
    (pipeline.error && dbFailure("reportPipelineValue", pipeline.error, "Could not load the pipeline value.")) ||
    (followUps.error && dbFailure("reportFollowUps", followUps.error, "Could not load the follow-up counts."));
  if (failure) return failure;

  let outcomeData: ReportOutcomes;
  try {
    outcomeData = toOutcomes(outcomes.data);
  } catch (error) {
    console.error("[reportOutcomes] malformed row", error);
    return { ok: false, error: "Could not load the win rate." };
  }

  const stages = toStageCounts(stageCounts.data ?? []);
  return ok({
    period: { from, to },
    stageCounts: stages,
    totalProspects: stages.reduce((sum, row) => sum + row.count, 0),
    reached: toReachedCounts(reached.data ?? []),
    funnel: toFunnelSteps(funnel.data ?? []),
    outcomes: outcomeData,
    pipelineValue: summarizePipelineValue(pipeline.data ?? []),
    followUps: {
      overdue: followUps.data?.overdue ?? 0,
      dueToday: followUps.data?.due_today ?? 0,
      completed: followUps.data?.completed ?? 0,
    },
  });
}
