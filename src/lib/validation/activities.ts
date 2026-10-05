import { z } from "zod";

import { MANUAL_ACTIVITY_TYPES } from "@/lib/constants";

import { orgLocalToUtc } from "@/lib/time";

import { CLOCK_SKEW_MS, dateStringSchema, requiredText, timeStringSchema, uuidSchema } from "./common";

/** ISO timestamp (with offset) or Date → ISO UTC string; must not be in the future. */
export const occurredAtSchema = z
  .union([z.date(), z.iso.datetime({ offset: true })], "Enter a valid date and time.")
  .transform((value, ctx) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date and time." });
      return z.NEVER;
    }
    if (date.getTime() > Date.now() + CLOCK_SKEW_MS) {
      ctx.addIssue({ code: "custom", message: "The activity time can't be in the future." });
      return z.NEVER;
    }
    return date.toISOString();
  });

export const activityCreateSchema = z.object({
  prospectId: uuidSchema,
  type: z.enum(MANUAL_ACTIVITY_TYPES, "Choose an activity type."),
  content: requiredText(10_000, "Describe what happened.", "Content"),
  occurredAt: occurredAtSchema.optional(),
});
export type ActivityCreateInput = z.input<typeof activityCreateSchema>;
export type ActivityCreateData = z.output<typeof activityCreateSchema>;

/**
 * "Log activity" form (detail page): occurred_at is entered as an org-local
 * date + time (org timezone, SPEC §6) and converted with orgLocalToUtc. The
 * schema is built per timezone so "not in the future" is checked on the client
 * too (the server re-checks with activityCreateSchema).
 */
export function makeActivityFormSchema(tz: string, now: () => Date = () => new Date()) {
  return z
    .object({
      type: z.enum(MANUAL_ACTIVITY_TYPES, "Choose an activity type."),
      content: requiredText(10_000, "Describe what happened.", "Content"),
      date: dateStringSchema,
      time: timeStringSchema,
    })
    .superRefine((value, ctx) => {
      let at: Date;
      try {
        at = orgLocalToUtc(value.date, value.time, tz);
      } catch {
        return; // field-level errors already reported
      }
      if (at.getTime() > now().getTime() + CLOCK_SKEW_MS) {
        ctx.addIssue({ code: "custom", path: ["time"], message: "The activity time can't be in the future." });
      }
    });
}
export type ActivityFormInput = z.input<ReturnType<typeof makeActivityFormSchema>>;
export type ActivityFormData = z.output<ReturnType<typeof makeActivityFormSchema>>;

/** Form values → addActivity input (org-local date/time → UTC ISO). */
export function toActivityCreateInput(prospectId: string, values: ActivityFormData, tz: string): ActivityCreateInput {
  return {
    prospectId,
    type: values.type,
    content: values.content,
    occurredAt: orgLocalToUtc(values.date, values.time, tz).toISOString(),
  };
}
