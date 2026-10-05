import { z } from "zod";

import { dateStringSchema, optionalText, requiredText, uuidSchema } from "./common";

/** Due date + task, reused by the demo flows. dueDate is an org-local calendar date. */
export const followUpInputSchema = z.object({
  dueDate: dateStringSchema,
  note: requiredText(2000, "Describe the follow-up.", "Note"),
});
export type FollowUpInput = z.input<typeof followUpInputSchema>;

export const followUpCreateSchema = followUpInputSchema.extend({ prospectId: uuidSchema });
export type FollowUpCreateInput = z.input<typeof followUpCreateSchema>;
export type FollowUpCreateData = z.output<typeof followUpCreateSchema>;

export const followUpRescheduleSchema = z.object({
  followUpId: uuidSchema,
  dueDate: dateStringSchema,
});
export type FollowUpRescheduleInput = z.input<typeof followUpRescheduleSchema>;

export const followUpCompleteSchema = z.object({
  followUpId: uuidSchema,
  /** Optional completion note (outcome); the activity falls back to the follow-up's note. */
  note: optionalText(2000, "Note"),
});
export type FollowUpCompleteInput = z.input<typeof followUpCompleteSchema>;

export const followUpIdSchema = z.object({ followUpId: uuidSchema });
export type FollowUpIdInput = z.input<typeof followUpIdSchema>;
