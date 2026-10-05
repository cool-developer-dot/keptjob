/**
 * Rule-based stage-change workflow (SPEC §9). Pure: decides which prompt (if
 * any) a stage change needs; the UI (src/components/stage-change) shows it and
 * calls the server actions. Nothing here sends messages or changes stages.
 */
import { isClosedStage, type PipelineStage } from "@/lib/constants";
import { addDaysToDateString, orgToday, utcToOrgLocal, type DateString, type Instant } from "@/lib/time";
import type {
  CloseOutcome,
  DemoAttendedFormValues,
  DemoBookedFormValues,
} from "@/lib/validation/stage-change";

export type { CloseOutcome };

export type StageFlow =
  /** Same stage: nothing to do (no server call, no history). */
  | { kind: "noop" }
  /** Move right away, no dialog (forward/backward/skip/reopen to a non-dialog stage). */
  | { kind: "immediate" }
  /** → Demo Booked: demo date/time + optional follow-up (Save / Skip / Cancel). */
  | { kind: "demo_booked" }
  /** → Demo Attended: demo notes + next follow-up (Save / Skip / Cancel). */
  | { kind: "demo_attended" }
  /** → Closed Won / Lost: required reason, optional notes, offer to complete pending follow-ups (Save / Cancel). */
  | {
      kind: "close";
      outcome: CloseOutcome;
      pendingFollowUps: number;
      /** True when there are pending follow-ups to offer completing (N > 0). */
      offerCompleteFollowUps: boolean;
    };

export type StageFlowKind = StageFlow["kind"];

/**
 * Decides the flow for moving a prospect from `from` to `to`.
 *
 * Target-based (SPEC §9 "Moving to …"): same stage → noop (checked first, so
 * closed_won → closed_won is a no-op); demo_booked / demo_attended → their
 * dialog regardless of direction (forward, backward, skip or reopen);
 * closed_won / closed_lost → close dialog (also won ↔ lost, which needs a reason
 * from the new list); every other target (incl. reopening from a closed stage)
 * → immediate.
 */
export function decideStageFlow(
  from: PipelineStage,
  to: PipelineStage,
  pendingFollowUps: number,
): StageFlow {
  if (from === to) return { kind: "noop" };
  if (to === "demo_booked") return { kind: "demo_booked" };
  if (to === "demo_attended") return { kind: "demo_attended" };
  if (isClosedStage(to)) {
    const count = Number.isFinite(pendingFollowUps) && pendingFollowUps > 0 ? Math.floor(pendingFollowUps) : 0;
    return {
      kind: "close",
      outcome: to === "closed_won" ? "won" : "lost",
      pendingFollowUps: count,
      offerCompleteFollowUps: count > 0,
    };
  }
  return { kind: "immediate" };
}

/** True when moving to `to` needs a dialog (callers may need the pending follow-up count first). */
export function stageNeedsDialog(from: PipelineStage, to: PipelineStage): boolean {
  const kind = decideStageFlow(from, to, 0).kind;
  return kind !== "noop" && kind !== "immediate";
}

/** Default follow-up note for both demo dialogs. */
export const DEFAULT_DEMO_FOLLOW_UP_NOTE = "Follow up after demo";
/** Demo Booked: follow-up due this many days after the demo date. */
export const DEMO_BOOKED_FOLLOW_UP_OFFSET_DAYS = 1;
/** Demo Attended: next follow-up due this many days after org today. */
export const DEMO_ATTENDED_FOLLOW_UP_OFFSET_DAYS = 2;

/** Follow-up due date for a demo on `demoDate` (the day after), or "" without a demo date. */
export function demoFollowUpDueDate(demoDate: string): DateString {
  try {
    return addDaysToDateString(demoDate, DEMO_BOOKED_FOLLOW_UP_OFFSET_DAYS);
  } catch {
    return "";
  }
}

/**
 * Demo Booked defaults: an existing demo_at is prefilled as org-local date/time,
 * otherwise empty (the user must choose). Follow-up on, due the day after the demo.
 */
export function demoBookedDefaults(demoAt: Instant | null | undefined, tz: string): DemoBookedFormValues {
  const local = demoAt ? utcToOrgLocal(demoAt, tz) : null;
  const demoDate = local?.date ?? "";
  return {
    demoDate,
    demoTime: local?.time ?? "",
    createFollowUp: true,
    followUpDueDate: demoDate ? demoFollowUpDueDate(demoDate) : "",
    followUpNote: DEFAULT_DEMO_FOLLOW_UP_NOTE,
  };
}

/** Demo Attended defaults: next follow-up on, due org today + 2 days. */
export function demoAttendedDefaults(tz: string, now: Instant = new Date()): DemoAttendedFormValues {
  return {
    notes: "",
    createFollowUp: true,
    followUpDueDate: addDaysToDateString(orgToday(tz, now), DEMO_ATTENDED_FOLLOW_UP_OFFSET_DAYS),
    followUpNote: DEFAULT_DEMO_FOLLOW_UP_NOTE,
  };
}
