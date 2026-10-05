import "server-only";

import type { TablesInsert, TablesUpdate } from "@/lib/supabase/database.types";
import {
  prospectCreateSchema,
  prospectIdSchema,
  prospectUpdateSchema,
  reassignProspectSchema,
  stageChangeSchema,
  type ProspectCreateInput,
  type ProspectIdInput,
  type ProspectUpdateData,
  type ProspectUpdateInput,
  type ReassignProspectInput,
  type StageChangeInput,
} from "@/lib/validation/prospects";
import type { ActionResult } from "@/server/actions/types";

import type { DataContext, ProspectRow } from "./context";
import { dbFailure, MESSAGES, ok, validationFailure } from "./errors";

/** camelCase editable fields → prospects columns (the only columns this module writes besides owner/stage). */
function toProspectColumns(data: Omit<ProspectUpdateData, "prospectId">): TablesUpdate<"prospects"> {
  const columns: TablesUpdate<"prospects"> = {};
  if (data.name !== undefined) columns.name = data.name;
  if (data.company !== undefined) columns.company = data.company;
  if (data.email !== undefined) columns.email = data.email;
  if (data.phone !== undefined) columns.phone = data.phone;
  if (data.decisionMakerStatus !== undefined) columns.decision_maker_status = data.decisionMakerStatus;
  if (data.objections !== undefined) columns.objections = data.objections;
  if (data.objectionNotes !== undefined) columns.objection_notes = data.objectionNotes;
  if (data.notes !== undefined) columns.notes = data.notes;
  if (data.dealValue !== undefined) columns.deal_value = data.dealValue;
  if (data.currency !== undefined) columns.currency = data.currency;
  return columns;
}

/**
 * Creates a prospect. Owner defaults to the current user; only managers may
 * assign another owner. Currency omitted → the DB trigger uses
 * org_settings.default_currency. Stage starts at the DB default (prospect).
 */
export async function createProspectData(
  ctx: DataContext,
  input: ProspectCreateInput,
): Promise<ActionResult<ProspectRow>> {
  const parsed = prospectCreateSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { ownerId, ...fields } = parsed.data;

  const owner = ownerId ?? ctx.user.id;
  if (owner !== ctx.user.id && ctx.user.role !== "manager") {
    return { ok: false, error: "Only managers can assign prospects to other users." };
  }

  const payload = {
    ...toProspectColumns(fields),
    name: fields.name,
    owner_id: owner,
  } as TablesInsert<"prospects">; // currency may be omitted: the before-insert trigger fills it.

  const { data, error } = await ctx.supabase.from("prospects").insert(payload).select().single();
  if (error) {
    if (error.code === "23503") return { ok: false, error: "Owner not found." };
    return dbFailure("createProspect", error, "Could not create the prospect. Please try again.");
  }
  return ok(data);
}

/** Updates editable fields only (stage, owner, close and derived fields are rejected by the schema). */
export async function updateProspectData(
  ctx: DataContext,
  input: ProspectUpdateInput,
): Promise<ActionResult<ProspectRow>> {
  const parsed = prospectUpdateSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { prospectId, ...fields } = parsed.data;

  const { data, error } = await ctx.supabase
    .from("prospects")
    .update(toProspectColumns(fields))
    .eq("id", prospectId)
    .select();
  if (error) return dbFailure("updateProspect", error, "Could not save the prospect. Please try again.");
  if (!data || data.length === 0) return { ok: false, error: MESSAGES.prospectNotFound };
  return ok(data[0]);
}

/** Deletes a prospect (managers only; RLS also enforces it). Children cascade. */
export async function deleteProspectData(
  ctx: DataContext,
  input: ProspectIdInput,
): Promise<ActionResult<{ id: string }>> {
  if (ctx.user.role !== "manager") return { ok: false, error: "Only managers can delete prospects." };
  const parsed = prospectIdSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const { data, error } = await ctx.supabase
    .from("prospects")
    .delete()
    .eq("id", parsed.data.prospectId)
    .select("id");
  if (error) return dbFailure("deleteProspect", error, "Could not delete the prospect. Please try again.");
  if (!data || data.length === 0) return { ok: false, error: MESSAGES.prospectNotFound };
  return ok({ id: data[0].id });
}

/**
 * Moves a prospect to any stage (forward, backward, skip, close, reopen) via the
 * move_prospect_stage RPC, so the note reaches stage_history and the
 * stage_change activity. Same stage → no-op ({ changed: false }). Close fields
 * are only sent for closed targets; reopening is cleared by the DB.
 */
export async function moveProspectStageData(
  ctx: DataContext,
  input: StageChangeInput,
): Promise<ActionResult<{ prospect: ProspectRow; changed: boolean }>> {
  const parsed = stageChangeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { prospectId, toStage, closeReason, closeNotes, note } = parsed.data;

  const { data: current, error: readError } = await ctx.supabase
    .from("prospects")
    .select()
    .eq("id", prospectId)
    .maybeSingle();
  if (readError) return dbFailure("moveProspectStage (read)", readError, "Could not change the stage.");
  if (!current) return { ok: false, error: MESSAGES.prospectNotFound };
  if (current.stage === toStage) return ok({ prospect: current, changed: false });

  const closed = toStage === "closed_won" || toStage === "closed_lost";
  const { data, error } = await ctx.supabase
    .rpc("move_prospect_stage", {
      p_prospect_id: prospectId,
      p_to_stage: toStage,
      ...(closed && closeReason ? { p_close_reason: closeReason } : {}),
      ...(closed && closeNotes ? { p_close_notes: closeNotes } : {}),
      ...(note ? { p_note: note } : {}),
    })
    .single();
  if (error) {
    if (error.code === "P0002") return { ok: false, error: MESSAGES.prospectNotFound };
    return dbFailure("moveProspectStage", error, "Could not change the stage. Please try again.");
  }
  return ok({ prospect: data as ProspectRow, changed: true });
}

/**
 * Reassigns a prospect (managers only; the DB trigger also enforces it, logs an
 * owner_change activity and moves pending follow-ups to the new owner).
 */
export async function reassignProspectData(
  ctx: DataContext,
  input: ReassignProspectInput,
): Promise<ActionResult<ProspectRow>> {
  if (ctx.user.role !== "manager") return { ok: false, error: "Only managers can reassign prospects." };
  const parsed = reassignProspectSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { prospectId, ownerId } = parsed.data;

  const { data: owner, error: ownerError } = await ctx.supabase
    .from("users")
    .select("id")
    .eq("id", ownerId)
    .maybeSingle();
  if (ownerError) return dbFailure("reassignProspect (user)", ownerError, "Could not reassign the prospect.");
  if (!owner) return { ok: false, error: MESSAGES.userNotFound };

  const { data: current, error: readError } = await ctx.supabase
    .from("prospects")
    .select()
    .eq("id", prospectId)
    .maybeSingle();
  if (readError) return dbFailure("reassignProspect (read)", readError, "Could not reassign the prospect.");
  if (!current) return { ok: false, error: MESSAGES.prospectNotFound };
  if (current.owner_id === ownerId) return ok(current);

  const { data, error } = await ctx.supabase
    .from("prospects")
    .update({ owner_id: ownerId })
    .eq("id", prospectId)
    .select();
  if (error) return dbFailure("reassignProspect", error, "Could not reassign the prospect. Please try again.");
  if (!data || data.length === 0) return { ok: false, error: MESSAGES.prospectNotFound };
  return ok(data[0]);
}
