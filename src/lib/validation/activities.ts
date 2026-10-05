import { z } from "zod";

import { MANUAL_ACTIVITY_TYPES } from "@/lib/constants";

import { CLOCK_SKEW_MS, requiredText, uuidSchema } from "./common";

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
