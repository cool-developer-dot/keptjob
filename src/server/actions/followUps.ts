"use server";

import type {
  FollowUpCompleteInput,
  FollowUpCreateInput,
  FollowUpIdInput,
  FollowUpRescheduleInput,
} from "@/lib/validation/follow-ups";
import type { FollowUpRow } from "@/server/data/context";
import { MESSAGES } from "@/server/data/errors";
import {
  completeFollowUpData,
  createFollowUpData,
  deleteFollowUpData,
  rescheduleFollowUpData,
} from "@/server/data/follow-ups";

import { getActionContext, revalidateProspect } from "./helpers";
import type { ActionResult } from "./types";

/** Creates a pending follow-up owned by the prospect's owner. dueDate is an org-local "YYYY-MM-DD". */
export async function createFollowUp(input: FollowUpCreateInput): Promise<ActionResult<FollowUpRow>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: MESSAGES.sessionExpired };
  const result = await createFollowUpData(ctx, input);
  if (result.ok) revalidateProspect(result.data.prospect_id);
  return result;
}

/** Completes a follow-up (completed_by = current user) and logs a follow_up activity. */
export async function completeFollowUp(input: FollowUpCompleteInput): Promise<ActionResult<FollowUpRow>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: MESSAGES.sessionExpired };
  const result = await completeFollowUpData(ctx, input);
  if (result.ok) revalidateProspect(result.data.prospect_id);
  return result;
}

/** Changes the due date of a pending follow-up. */
export async function rescheduleFollowUp(input: FollowUpRescheduleInput): Promise<ActionResult<FollowUpRow>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: MESSAGES.sessionExpired };
  const result = await rescheduleFollowUpData(ctx, input);
  if (result.ok) revalidateProspect(result.data.prospect_id);
  return result;
}

/** Deletes a follow-up. */
export async function deleteFollowUp(
  input: FollowUpIdInput,
): Promise<ActionResult<{ id: string; prospectId: string }>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: MESSAGES.sessionExpired };
  const result = await deleteFollowUpData(ctx, input);
  if (result.ok) revalidateProspect(result.data.prospectId);
  return result;
}
