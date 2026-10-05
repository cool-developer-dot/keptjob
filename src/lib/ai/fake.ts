import "server-only";

/**
 * Deterministic fake of the Responses API call, for local dev, integration
 * tests and e2e ONLY (selected by getAiClient() when isFakeAiEnabled(): AI_FAKE=1
 * outside production). No network calls. It reads a few facts back from the
 * context built by buildInsightContext() so the output is plausible and
 * stable:
 * - decision maker: "yes" when the recorded status is Unknown (so the Apply
 *   suggestion can be exercised), otherwise the recorded status;
 * - main objection: the first recorded objection, else "Unknown";
 * - deal health: low for closed lost / stale-ish records, high for demo or
 *   later stages, medium otherwise.
 */
import { DECISION_MAKER_STATUS_LABELS, type DecisionMakerStatus } from "@/lib/constants";
import { aiInsightOutputSchema, type AiInsightOutput } from "@/lib/validation/ai";

import type { AiClient, InsightParseParams, InsightParseResponse } from "./types";

function field(context: string, label: string): string | null {
  const line = context.split("\n").find((l) => l.startsWith(`- ${label}: `));
  return line ? line.slice(`- ${label}: `.length).trim() : null;
}

function recordedDecisionMaker(context: string): DecisionMakerStatus {
  const label = field(context, "Decision maker (recorded)");
  const entry = Object.entries(DECISION_MAKER_STATUS_LABELS).find(([, l]) => l === label);
  return (entry?.[0] as DecisionMakerStatus | undefined) ?? "unknown";
}

export function fakeInsightFor(context: string): AiInsightOutput {
  const name = field(context, "Name") ?? "the prospect";
  const stage = field(context, "Current stage") ?? "Prospect";
  const objections = field(context, "Objections");
  const mainObjection = objections && objections !== "none recorded" ? objections.split(", ")[0]! : "Unknown";
  const recorded = recordedDecisionMaker(context);
  const health: AiInsightOutput["deal_health"] =
    stage === "Closed Lost" ? "low" : ["Demo Booked", "Demo Attended", "Follow-up", "Closed Won"].includes(stage) ? "high" : "medium";
  const followUp = field(context, "Next follow-up date");

  return aiInsightOutputSchema.parse({
    summary: `[Fake AI] ${name} is in the ${stage} stage. Main objection: ${mainObjection}. ${
      followUp && followUp !== "none scheduled" ? `Next follow-up is on ${followUp}.` : "No follow-up is scheduled."
    }`.slice(0, 600),
    decision_maker_status: recorded === "unknown" ? "yes" : recorded,
    main_objection: mainObjection,
    recommended_next_step: `Call ${name} to confirm the decision process and agree on a next meeting date.`,
    deal_health: health,
  });
}

export function createFakeAiClient(): AiClient {
  return {
    responses: {
      async parse(params: InsightParseParams): Promise<InsightParseResponse> {
        const parsed = fakeInsightFor(params.input);
        return {
          status: "completed",
          incomplete_details: null,
          output_parsed: parsed,
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(parsed) }] }],
        };
      },
    },
  };
}
