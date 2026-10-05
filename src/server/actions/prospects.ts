"use server";

import type {
  ProspectCreateInput,
  ProspectIdInput,
  ProspectUpdateInput,
  ReassignProspectInput,
  StageChangeInput,
} from "@/lib/validation/prospects";
import type { ProspectRow } from "@/server/data/context";
import { MESSAGES } from "@/server/data/errors";
import { completeAllPendingFollowUpsData } from "@/server/data/follow-ups";
import {
  createProspectData,
  deleteProspectData,
  moveProspectStageData,
  reassignProspectData,
  updateProspectData,
} from "@/server/data/prospects";

import { getActionContext, getManagerActionContext, revalidateProspect } from "./helpers";
import type { ActionResult } from "./types";

/** Creates a prospect (owner defaults to the current user; currency to the org default). */
export async function createProspect(input: ProspectCreateInput): Promise<ActionResult<ProspectRow>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: MESSAGES.sessionExpired };
  const result = await createProspectData(ctx, input);
  if (result.ok) revalidateProspect(result.data.id);
  return result;
}

/** Updates editable prospect fields. Stage/owner/close fields have dedicated actions. */
export async function updateProspect(input: ProspectUpdateInput): Promise<ActionResult<ProspectRow>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: MESSAGES.sessionExpired };
  const result = await updateProspectData(ctx, input);
  if (result.ok) revalidateProspect(result.data.id);
  return result;
}

/** Deletes a prospect (managers only). */
export async function deleteProspect(input: ProspectIdInput): Promise<ActionResult<{ id: string }>> {
  const ctx = await getManagerActionContext();
  const result = await deleteProspectData(ctx, input);
  if (result.ok) revalidateProspect(result.data.id);
  return result;
}

/** Moves a prospect to any stage via the move_prospect_stage RPC (same stage → { changed: false }). */
export async function moveProspectStage(
  input: StageChangeInput,
): Promise<ActionResult<{ prospect: ProspectRow; changed: boolean }>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: MESSAGES.sessionExpired };
  const result = await moveProspectStageData(ctx, input);
  if (result.ok && result.data.changed) revalidateProspect(result.data.prospect.id);
  return result;
}

/** Reassigns a prospect to another user (managers only). */
export async function reassignProspect(input: ReassignProspectInput): Promise<ActionResult<ProspectRow>> {
  const ctx = await getManagerActionContext();
  const result = await reassignProspectData(ctx, input);
  if (result.ok) revalidateProspect(result.data.id);
  return result;
}

/** Close flow: completes all pending follow-ups of a prospect (one follow_up activity each). */
export async function completeAllPendingFollowUps(
  input: ProspectIdInput,
): Promise<ActionResult<{ completed: number }>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: MESSAGES.sessionExpired };
  const result = await completeAllPendingFollowUpsData(ctx, input);
  if (result.ok) revalidateProspect(input.prospectId);
  return result;
}
