import "server-only";

import type { Json } from "@/lib/supabase/database.types";
import {
  followUpCompleteSchema,
  followUpCreateSchema,
  followUpIdSchema,
  followUpRescheduleSchema,
  type FollowUpCompleteInput,
  type FollowUpCreateInput,
  type FollowUpIdInput,
  type FollowUpRescheduleInput,
} from "@/lib/validation/follow-ups";
import { prospectIdSchema, type ProspectIdInput } from "@/lib/validation/prospects";
import type { ActionResult } from "@/server/actions/types";

import type { DataContext, FollowUpRow } from "./context";
import { dbFailure, MESSAGES, ok, validationFailure } from "./errors";

const ALREADY_COMPLETED = "This follow-up is already completed.";

/**
 * Inserts a pending follow-up. owner_id is always the prospect's owner (SPEC §4/§8),
 * passed in by the caller after reading the prospect through RLS.
 */
export async function insertFollowUp(
  ctx: DataContext,
  prospect: { id: string; owner_id: string },
  followUp: { dueDate: string; note: string },
): Promise<ActionResult<FollowUpRow>> {
  const { data, error } = await ctx.supabase
    .from("follow_ups")
    .insert({
      prospect_id: prospect.id,
      owner_id: prospect.owner_id,
      due_date: followUp.dueDate,
      note: followUp.note,
    })
    .select()
    .single();
  if (error) return dbFailure("createFollowUp", error, "Could not create the follow-up. Please try again.");
  return ok(data);
}

/** Creates a follow-up owned by the prospect's owner (looked up through RLS). */
export async function createFollowUpData(
  ctx: DataContext,
  input: FollowUpCreateInput,
): Promise<ActionResult<FollowUpRow>> {
  const parsed = followUpCreateSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { prospectId, dueDate, note } = parsed.data;

  const { data: prospect, error } = await ctx.supabase
    .from("prospects")
    .select("id, owner_id")
    .eq("id", prospectId)
    .maybeSingle();
  if (error) return dbFailure("createFollowUp (read)", error, "Could not create the follow-up.");
  if (!prospect) return { ok: false, error: MESSAGES.prospectNotFound };

  return insertFollowUp(ctx, prospect, { dueDate, note });
}

async function readFollowUp(ctx: DataContext, followUpId: string) {
  return ctx.supabase.from("follow_ups").select().eq("id", followUpId).maybeSingle();
}

/** Logs one follow_up activity per completed follow-up (SPEC §8). */
async function logCompletedFollowUps(
  ctx: DataContext,
  rows: Pick<FollowUpRow, "id" | "prospect_id" | "note" | "due_date">[],
  completionNote: string | null,
  extra: Record<string, Json> = {},
) {
  if (rows.length === 0) return { error: null };
  return ctx.supabase.from("activities").insert(
    rows.map((row) => ({
      prospect_id: row.prospect_id,
      type: "follow_up" as const,
      content: completionNote ?? row.note,
      metadata: { follow_up_id: row.id, due_date: row.due_date, task: row.note, ...extra },
    })),
  );
}

/** Completes a pending follow-up (completed_by = current user) and logs a follow_up activity. */
export async function completeFollowUpData(
  ctx: DataContext,
  input: FollowUpCompleteInput,
): Promise<ActionResult<FollowUpRow>> {
  const parsed = followUpCompleteSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { followUpId, note } = parsed.data;

  const { data: current, error: readError } = await readFollowUp(ctx, followUpId);
  if (readError) return dbFailure("completeFollowUp (read)", readError, "Could not complete the follow-up.");
  if (!current) return { ok: false, error: MESSAGES.followUpNotFound };
  if (current.status === "completed") return { ok: false, error: ALREADY_COMPLETED };

  const { data, error } = await ctx.supabase
    .from("follow_ups")
    .update({ status: "completed", completed_at: new Date().toISOString(), completed_by: ctx.user.id })
    .eq("id", followUpId)
    .eq("status", "pending")
    .select();
  if (error) return dbFailure("completeFollowUp", error, "Could not complete the follow-up. Please try again.");
  if (!data || data.length === 0) return { ok: false, error: ALREADY_COMPLETED };

  const { error: activityError } = await logCompletedFollowUps(ctx, data, note ?? null);
  if (activityError) {
    return dbFailure(
      "completeFollowUp (activity)",
      activityError,
      "The follow-up was completed, but the timeline entry could not be saved.",
    );
  }
  return ok(data[0]);
}

/** Close flow: completes every pending follow-up of a prospect, logging one activity each. */
export async function completeAllPendingFollowUpsData(
  ctx: DataContext,
  input: ProspectIdInput,
): Promise<ActionResult<{ completed: number }>> {
  const parsed = prospectIdSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { prospectId } = parsed.data;

  const { data: prospect, error: readError } = await ctx.supabase
    .from("prospects")
    .select("id")
    .eq("id", prospectId)
    .maybeSingle();
  if (readError) return dbFailure("completeAllPendingFollowUps (read)", readError, "Could not complete the follow-ups.");
  if (!prospect) return { ok: false, error: MESSAGES.prospectNotFound };

  const { data, error } = await ctx.supabase
    .from("follow_ups")
    .update({ status: "completed", completed_at: new Date().toISOString(), completed_by: ctx.user.id })
    .eq("prospect_id", prospectId)
    .eq("status", "pending")
    .select();
  if (error) {
    return dbFailure("completeAllPendingFollowUps", error, "Could not complete the follow-ups. Please try again.");
  }

  const rows = data ?? [];
  const { error: activityError } = await logCompletedFollowUps(ctx, rows, null, { bulk: true });
  if (activityError) {
    return dbFailure(
      "completeAllPendingFollowUps (activity)",
      activityError,
      "The follow-ups were completed, but the timeline entries could not be saved.",
    );
  }
  return ok({ completed: rows.length });
}

/** Moves a pending follow-up to a new (org-local) due date. */
export async function rescheduleFollowUpData(
  ctx: DataContext,
  input: FollowUpRescheduleInput,
): Promise<ActionResult<FollowUpRow>> {
  const parsed = followUpRescheduleSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { followUpId, dueDate } = parsed.data;

  const { data: current, error: readError } = await readFollowUp(ctx, followUpId);
  if (readError) return dbFailure("rescheduleFollowUp (read)", readError, "Could not reschedule the follow-up.");
  if (!current) return { ok: false, error: MESSAGES.followUpNotFound };
  if (current.status === "completed") return { ok: false, error: ALREADY_COMPLETED };

  const { data, error } = await ctx.supabase
    .from("follow_ups")
    .update({ due_date: dueDate })
    .eq("id", followUpId)
    .eq("status", "pending")
    .select();
  if (error) return dbFailure("rescheduleFollowUp", error, "Could not reschedule the follow-up. Please try again.");
  if (!data || data.length === 0) return { ok: false, error: ALREADY_COMPLETED };
  return ok(data[0]);
}

/** Deletes a follow-up (pending or completed) the user can access. */
export async function deleteFollowUpData(
  ctx: DataContext,
  input: FollowUpIdInput,
): Promise<ActionResult<{ id: string; prospectId: string }>> {
  const parsed = followUpIdSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const { data, error } = await ctx.supabase
    .from("follow_ups")
    .delete()
    .eq("id", parsed.data.followUpId)
    .select("id, prospect_id");
  if (error) return dbFailure("deleteFollowUp", error, "Could not delete the follow-up. Please try again.");
  if (!data || data.length === 0) return { ok: false, error: MESSAGES.followUpNotFound };
  return ok({ id: data[0].id, prospectId: data[0].prospect_id });
}
