/**
 * Stage-change dialog forms (Prompt 6, SPEC §9). Built from the action schemas'
 * pieces; the mappers produce the inputs of setDemoDetails / logDemoAttended /
 * moveProspectStage, which validate again on the server.
 */
import { z } from "zod";

import { LOST_REASONS, WON_REASONS, type PipelineStage } from "@/lib/constants";

import { isDateString, isTimeString } from "@/lib/time";

import { requiredText } from "./common";
import type { LogDemoAttendedInput, SetDemoDetailsInput } from "./demo";
import type { StageChangeInput } from "./prospects";

/** Native date/time inputs give "" when empty: say "choose" instead of showing the wire format. */
function formDate(emptyMessage: string) {
  return z.string().min(1, emptyMessage).refine(isDateString, "Enter a valid date.");
}
function formTime(emptyMessage: string) {
  return z.string().min(1, emptyMessage).refine(isTimeString, "Enter a valid time.");
}

/** Optional textarea value (form state stays a string; same limit as the action schema, after trimming). */
function formText(max: number, label: string) {
  return z.string().refine((value) => value.trim().length <= max, `${label} must be at most ${max} characters.`);
}

/**
 * Optional follow-up block: due date + note are only validated when the box is
 * checked (same rules as followUpInputSchema; the action re-validates with it).
 */
const followUpFields = {
  createFollowUp: z.boolean(),
  followUpDueDate: z.string(),
  followUpNote: z.string(),
};

function refineFollowUp(
  value: { createFollowUp: boolean; followUpDueDate: string; followUpNote: string },
  ctx: z.RefinementCtx,
) {
  if (!value.createFollowUp) return;
  const schema = z.object({
    followUpDueDate: formDate("Choose a due date."),
    followUpNote: requiredText(2000, "Describe the follow-up.", "Note"),
  });
  const result = schema.safeParse(value);
  if (result.success) return;
  for (const issue of result.error.issues) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
}

export const demoBookedFormSchema = z
  .object({
    demoDate: formDate("Choose the demo date."),
    demoTime: formTime("Choose the demo time."),
    ...followUpFields,
  })
  .superRefine(refineFollowUp);
export type DemoBookedFormValues = z.input<typeof demoBookedFormSchema>;

export const demoAttendedFormSchema = z
  .object({
    notes: formText(10_000, "Demo notes"),
    ...followUpFields,
  })
  .superRefine(refineFollowUp);
export type DemoAttendedFormValues = z.input<typeof demoAttendedFormSchema>;

export type CloseOutcome = "won" | "lost";

const CLOSE_REASON_REQUIRED = "Choose a close reason.";

/** Close dialog: reason required and from the won or lost list; notes optional. */
export function closeFormSchema(outcome: CloseOutcome) {
  const allowed: readonly string[] = outcome === "won" ? WON_REASONS : LOST_REASONS;
  return z.object({
    closeReason: z
      .string(CLOSE_REASON_REQUIRED)
      .min(1, CLOSE_REASON_REQUIRED)
      .refine((value) => allowed.includes(value), `Choose a ${outcome} reason from the list.`),
    closeNotes: formText(2000, "Close notes"),
    completePendingFollowUps: z.boolean(),
  });
}
export type CloseFormValues = z.input<ReturnType<typeof closeFormSchema>>;

export function closeStageFor(outcome: CloseOutcome): Extract<PipelineStage, "closed_won" | "closed_lost"> {
  return outcome === "won" ? "closed_won" : "closed_lost";
}

function followUpFrom(values: { createFollowUp: boolean; followUpDueDate: string; followUpNote: string }) {
  return values.createFollowUp
    ? { dueDate: values.followUpDueDate, note: values.followUpNote.trim() }
    : undefined;
}

export function toSetDemoDetailsInput(prospectId: string, values: DemoBookedFormValues): SetDemoDetailsInput {
  return {
    prospectId,
    demoDate: values.demoDate,
    demoTime: values.demoTime,
    followUp: followUpFrom(values),
  };
}

export function toLogDemoAttendedInput(prospectId: string, values: DemoAttendedFormValues): LogDemoAttendedInput {
  return {
    prospectId,
    notes: values.notes.trim() || null,
    followUp: followUpFrom(values),
  };
}

export function toCloseStageInput(
  prospectId: string,
  outcome: CloseOutcome,
  values: CloseFormValues,
): StageChangeInput {
  return {
    prospectId,
    toStage: closeStageFor(outcome),
    closeReason: values.closeReason,
    closeNotes: values.closeNotes.trim() || null,
  };
}
