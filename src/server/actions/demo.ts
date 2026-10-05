"use server";

import { getOrgSettings } from "@/lib/org";
import type { LogDemoAttendedInput, SetDemoDetailsInput } from "@/lib/validation/demo";
import type { ActivityRow, FollowUpRow, ProspectRow } from "@/server/data/context";
import { logDemoAttendedData, setDemoDetailsData } from "@/server/data/demo";
import { MESSAGES } from "@/server/data/errors";

import { getActionContext, revalidateProspect } from "./helpers";
import type { ActionResult } from "./types";

/**
 * Saves the demo date/time (org-local → UTC using the org timezone) and an
 * optional follow-up. Does not change the stage (call moveProspectStage first).
 */
export async function setDemoDetails(
  input: SetDemoDetailsInput,
): Promise<ActionResult<{ prospect: ProspectRow; followUp: FollowUpRow | null }>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: MESSAGES.sessionExpired };
  const { timezone } = await getOrgSettings();
  const result = await setDemoDetailsData(ctx, input, timezone);
  if (result.ok) revalidateProspect(result.data.prospect.id);
  return result;
}

/** Logs a demo activity with the demo notes and an optional next follow-up. */
export async function logDemoAttended(
  input: LogDemoAttendedInput,
): Promise<ActionResult<{ activity: ActivityRow; followUp: FollowUpRow | null }>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: MESSAGES.sessionExpired };
  const result = await logDemoAttendedData(ctx, input);
  if (result.ok) revalidateProspect(result.data.activity.prospect_id);
  return result;
}
