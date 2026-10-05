import "server-only";

import type { Role } from "@/lib/constants";
import type { Tables } from "@/lib/supabase/database.types";
import { prospectIdSchema } from "@/lib/validation/prospects";
import type { ActionResult } from "@/server/actions/types";

import type { ActivityRow, DataContext, FollowUpRow, ProspectRow } from "./context";
import { dbFailure, ok, validationFailure } from "./errors";

/** A prospect row + the prospects_with_flags flags (non-null like the table). */
export type ProspectDetail = ProspectRow & { is_stale: boolean; has_overdue_follow_up: boolean };

export type StageHistoryRow = Tables<"stage_history">;

export type TeamMember = { id: string; full_name: string; role: Role };

/** Timeline cap: the newest N activities are shown (the page says so when it's hit). */
export const ACTIVITY_LIMIT = 500;

/**
 * One prospect through RLS (prospects_with_flags is security_invoker), or
 * `null` when it doesn't exist **or** the user can't see it — the page turns
 * both into the same 404.
 */
export async function getProspectDetailData(
  ctx: DataContext,
  prospectId: string,
): Promise<ActionResult<ProspectDetail | null>> {
  const parsed = prospectIdSchema.safeParse({ prospectId });
  if (!parsed.success) return ok(null);

  const { data, error } = await ctx.supabase
    .from("prospects_with_flags")
    .select("*")
    .eq("id", parsed.data.prospectId)
    .maybeSingle();
  if (error) return dbFailure("getProspectDetail", error, "Could not load the prospect.");
  if (!data) return ok(null);
  return ok({
    ...(data as ProspectRow),
    is_stale: data.is_stale ?? false,
    has_overdue_follow_up: data.has_overdue_follow_up ?? false,
  });
}

/** Activities of a prospect, newest first (occurred_at, then created_at), capped at ACTIVITY_LIMIT. */
export async function listProspectActivitiesData(
  ctx: DataContext,
  prospectId: string,
): Promise<ActionResult<{ rows: ActivityRow[]; truncated: boolean }>> {
  const parsed = prospectIdSchema.safeParse({ prospectId });
  if (!parsed.success) return validationFailure(parsed.error);

  const { data, error } = await ctx.supabase
    .from("activities")
    .select("*")
    .eq("prospect_id", parsed.data.prospectId)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ACTIVITY_LIMIT + 1);
  if (error) return dbFailure("listProspectActivities", error, "Could not load the timeline.");
  const rows = data ?? [];
  return ok({ rows: rows.slice(0, ACTIVITY_LIMIT), truncated: rows.length > ACTIVITY_LIMIT });
}

/** Stage history of a prospect, oldest first. */
export async function listProspectStageHistoryData(
  ctx: DataContext,
  prospectId: string,
): Promise<ActionResult<StageHistoryRow[]>> {
  const parsed = prospectIdSchema.safeParse({ prospectId });
  if (!parsed.success) return validationFailure(parsed.error);

  const { data, error } = await ctx.supabase
    .from("stage_history")
    .select("*")
    .eq("prospect_id", parsed.data.prospectId)
    .order("changed_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) return dbFailure("listProspectStageHistory", error, "Could not load the stage history.");
  return ok(data ?? []);
}

/**
 * Follow-ups of a prospect: pending by due date (soonest first), completed by
 * completion time (newest first).
 */
export async function listProspectFollowUpsData(
  ctx: DataContext,
  prospectId: string,
): Promise<ActionResult<{ pending: FollowUpRow[]; completed: FollowUpRow[] }>> {
  const parsed = prospectIdSchema.safeParse({ prospectId });
  if (!parsed.success) return validationFailure(parsed.error);

  const { data, error } = await ctx.supabase
    .from("follow_ups")
    .select("*")
    .eq("prospect_id", parsed.data.prospectId)
    .order("due_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) return dbFailure("listProspectFollowUps", error, "Could not load the follow-ups.");
  const rows = data ?? [];
  return ok({
    pending: rows.filter((row) => row.status === "pending"),
    completed: rows
      .filter((row) => row.status === "completed")
      .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")),
  });
}

/** Every user (readable by all authenticated users): names for the timeline + reassign options. */
export async function listTeamData(ctx: DataContext): Promise<ActionResult<TeamMember[]>> {
  const { data, error } = await ctx.supabase
    .from("users")
    .select("id, full_name, role")
    .order("full_name", { ascending: true });
  if (error) return dbFailure("listTeam", error, "Could not load the team.");
  return ok(data ?? []);
}
