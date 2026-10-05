import "server-only";

import { activityCreateSchema, type ActivityCreateInput } from "@/lib/validation/activities";
import type { ActionResult } from "@/server/actions/types";

import type { ActivityRow, DataContext } from "./context";
import { dbFailure, MESSAGES, ok, validationFailure } from "./errors";

/**
 * Logs a manual activity (call/conversation/note/demo). user_id comes from the
 * DB default (auth.uid()); occurred_at defaults to now and is never in the future.
 */
export async function addActivityData(
  ctx: DataContext,
  input: ActivityCreateInput,
): Promise<ActionResult<ActivityRow>> {
  const parsed = activityCreateSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { prospectId, type, content, occurredAt } = parsed.data;

  const { data, error } = await ctx.supabase
    .from("activities")
    .insert({
      prospect_id: prospectId,
      type,
      content,
      ...(occurredAt ? { occurred_at: occurredAt } : {}),
    })
    .select()
    .single();
  if (error) {
    // RLS WITH CHECK failure on an inaccessible prospect surfaces as 42501.
    if (error.code === "42501") return { ok: false, error: MESSAGES.prospectNotFound };
    return dbFailure("addActivity", error, "Could not log the activity. Please try again.");
  }
  return ok(data);
}
