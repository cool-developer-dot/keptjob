import "server-only";

import { orgLocalToUtc } from "@/lib/time";
import {
  logDemoAttendedSchema,
  setDemoDetailsSchema,
  type LogDemoAttendedInput,
  type SetDemoDetailsInput,
} from "@/lib/validation/demo";
import type { ActionResult } from "@/server/actions/types";

import type { ActivityRow, DataContext, FollowUpRow, ProspectRow } from "./context";
import { dbFailure, MESSAGES, ok, validationFailure } from "./errors";
import { insertFollowUp } from "./follow-ups";

export const DEMO_ATTENDED_DEFAULT_CONTENT = "Demo attended";

/**
 * Sets demo_at from an org-local date + time (converted to UTC with the org
 * timezone) and optionally creates a follow-up. Never changes the stage.
 */
export async function setDemoDetailsData(
  ctx: DataContext,
  input: SetDemoDetailsInput,
  timezone: string,
): Promise<ActionResult<{ prospect: ProspectRow; followUp: FollowUpRow | null }>> {
  const parsed = setDemoDetailsSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { prospectId, demoDate, demoTime, followUp } = parsed.data;

  let demoAt: string;
  try {
    demoAt = orgLocalToUtc(demoDate, demoTime, timezone).toISOString();
  } catch {
    return { ok: false, error: "Enter a valid demo date and time." };
  }

  const { data, error } = await ctx.supabase
    .from("prospects")
    .update({ demo_at: demoAt })
    .eq("id", prospectId)
    .select();
  if (error) return dbFailure("setDemoDetails", error, "Could not save the demo details. Please try again.");
  if (!data || data.length === 0) return { ok: false, error: MESSAGES.prospectNotFound };
  const prospect = data[0];

  if (!followUp) return ok({ prospect, followUp: null });
  const created = await insertFollowUp(ctx, prospect, followUp);
  if (!created.ok) return created;
  return ok({ prospect, followUp: created.data });
}

/** Logs a demo activity (notes) and optionally creates the next follow-up. Never changes the stage. */
export async function logDemoAttendedData(
  ctx: DataContext,
  input: LogDemoAttendedInput,
): Promise<ActionResult<{ activity: ActivityRow; followUp: FollowUpRow | null }>> {
  const parsed = logDemoAttendedSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { prospectId, notes, followUp } = parsed.data;

  const { data: prospect, error: readError } = await ctx.supabase
    .from("prospects")
    .select("id, owner_id")
    .eq("id", prospectId)
    .maybeSingle();
  if (readError) return dbFailure("logDemoAttended (read)", readError, "Could not save the demo notes.");
  if (!prospect) return { ok: false, error: MESSAGES.prospectNotFound };

  const { data: activity, error } = await ctx.supabase
    .from("activities")
    .insert({
      prospect_id: prospectId,
      type: "demo",
      content: notes || DEMO_ATTENDED_DEFAULT_CONTENT,
      metadata: { demo_attended: true },
    })
    .select()
    .single();
  if (error) return dbFailure("logDemoAttended", error, "Could not save the demo notes. Please try again.");

  if (!followUp) return ok({ activity, followUp: null });
  const created = await insertFollowUp(ctx, prospect, followUp);
  if (!created.ok) return created;
  return ok({ activity, followUp: created.data });
}
