import { z } from "zod";

import { dateStringSchema, optionalText, timeStringSchema, uuidSchema } from "./common";
import { followUpInputSchema } from "./follow-ups";

/** Demo date + time are org-local; the action converts them to UTC with the org timezone. */
export const setDemoDetailsSchema = z.object({
  prospectId: uuidSchema,
  demoDate: dateStringSchema,
  demoTime: timeStringSchema,
  followUp: followUpInputSchema.optional(),
});
export type SetDemoDetailsInput = z.input<typeof setDemoDetailsSchema>;
export type SetDemoDetailsData = z.output<typeof setDemoDetailsSchema>;

export const logDemoAttendedSchema = z.object({
  prospectId: uuidSchema,
  notes: optionalText(10_000, "Demo notes"),
  followUp: followUpInputSchema.optional(),
});
export type LogDemoAttendedInput = z.input<typeof logDemoAttendedSchema>;
export type LogDemoAttendedData = z.output<typeof logDemoAttendedSchema>;
