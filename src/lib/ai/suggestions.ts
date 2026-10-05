import type { DecisionMakerStatus } from "@/lib/constants";

/**
 * Human-in-the-loop rule for the "Apply decision-maker status" suggestion
 * (SPEC §10): offered only when the AI's status differs from the prospect's
 * AND is not "unknown" — the AI never proposes downgrading a known status to
 * unknown. Applying is always a user click (updateProspect).
 */
export function shouldSuggestDecisionMaker(
  aiStatus: DecisionMakerStatus,
  prospectStatus: DecisionMakerStatus,
): boolean {
  return aiStatus !== "unknown" && aiStatus !== prospectStatus;
}
