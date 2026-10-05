"use server";

import type { ActivityCreateInput } from "@/lib/validation/activities";
import { addActivityData } from "@/server/data/activities";
import type { ActivityRow } from "@/server/data/context";
import { MESSAGES } from "@/server/data/errors";

import { getActionContext, revalidateProspect } from "./helpers";
import type { ActionResult } from "./types";

/** Logs a manual activity (call / conversation / note / demo) on a prospect's timeline. */
export async function addActivity(input: ActivityCreateInput): Promise<ActionResult<ActivityRow>> {
  const ctx = await getActionContext();
  if (!ctx) return { ok: false, error: MESSAGES.sessionExpired };
  const result = await addActivityData(ctx, input);
  if (result.ok) revalidateProspect(result.data.prospect_id);
  return result;
}
