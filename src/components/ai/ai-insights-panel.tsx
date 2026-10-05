"use client";

/**
 * AI insights panel (SPEC §10) on the prospect detail page. Manual only: the
 * AI is called when the user clicks "Generate AI Insights" / "Regenerate".
 * Human-in-the-loop: nothing is written to the prospect without a click —
 * "Apply" (decision-maker status → updateProspect) and "Create follow-up from
 * next step" (follow-up dialog prefilled with the next step). "Dismiss" only
 * hides the suggestion locally (nothing is stored).
 *
 * The Apply suggestion follows shouldSuggestDecisionMaker() (latest insight's
 * status differs from the prospect's and is not "unknown").
 */
import { ChevronDownIcon, Loader2Icon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useScheduleFollowUp } from "@/components/follow-ups/schedule-follow-up-dialog";
import { useOrgSettings } from "@/components/org-settings-provider";
import { DealHealthBadge } from "@/components/prospects/prospect-badges";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { shouldSuggestDecisionMaker } from "@/lib/ai/suggestions";
import { DECISION_MAKER_STATUS_LABELS, type DecisionMakerStatus } from "@/lib/constants";
import { formatOrgDateTime, formatRelativeTime } from "@/lib/time";
import { generateInsight } from "@/server/actions/ai";
import { updateProspect } from "@/server/actions/prospects";
import type { AiInsightWithAuthor } from "@/server/data/ai-insights";

type Props = {
  prospectId: string;
  prospectName: string;
  decisionMakerStatus: DecisionMakerStatus;
  /** Newest first. */
  insights: AiInsightWithAuthor[];
  /** Server render time (ISO) for relative times (avoids hydration drift). */
  now: string;
  loadError?: string | null;
};

export function AiInsightsPanel({ prospectId, prospectName, decisionMakerStatus, insights, now, loadError }: Props) {
  const { timezone } = useOrgSettings();
  const [generating, startGenerate] = useTransition();
  const [applying, startApply] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const { openScheduleFollowUp, dialog } = useScheduleFollowUp();

  const [latest, ...previous] = insights;
  const suggestDm =
    latest !== undefined &&
    !dismissed.has(latest.id) &&
    shouldSuggestDecisionMaker(latest.decision_maker_status, decisionMakerStatus);

  const generate = () =>
    startGenerate(async () => {
      setError(null);
      const result = await generateInsight({ prospectId });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("AI insight generated.");
    });

  const applyDecisionMaker = (status: DecisionMakerStatus) =>
    startApply(async () => {
      const result = await updateProspect({ prospectId, decisionMakerStatus: status });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Decision maker set to ${DECISION_MAKER_STATUS_LABELS[status]}.`);
    });

  const generateLabel = latest ? "Regenerate" : "Generate AI Insights";

  return (
    <Card data-slot="ai-insights" data-prospect-id={prospectId} aria-labelledby="ai-insights-title" aria-busy={generating}>
      <CardHeader>
        <CardTitle id="ai-insights-title" className="flex items-center gap-2">
          <SparklesIcon aria-hidden className="size-4 text-muted-foreground" />
          AI insights
        </CardTitle>
        <CardDescription>Advice for you, not a decision. Nothing changes without your click.</CardDescription>
        {latest && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={generate} disabled={generating}>
              {generating ? <Loader2Icon aria-hidden className="animate-spin" /> : <RefreshCwIcon aria-hidden />}
              {generating ? "Generating…" : generateLabel}
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {(error ?? loadError) && (
          <p
            role="alert"
            data-testid="ai-insights-error"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error ?? loadError}
          </p>
        )}

        {!latest ? (
          <div className="space-y-3 rounded-md border border-dashed px-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">
              No AI insights yet. Generate a summary, the main objection and a recommended next step from this
              prospect&apos;s notes and activity.
            </p>
            <Button onClick={generate} disabled={generating}>
              {generating ? <Loader2Icon aria-hidden className="animate-spin" /> : <SparklesIcon aria-hidden />}
              {generating ? "Generating…" : generateLabel}
            </Button>
          </div>
        ) : (
          <div className="space-y-4" data-testid="ai-insight-latest" data-insight-id={latest.id}>
            <InsightBody insight={latest} timezone={timezone} now={now} />

            {suggestDm && (
              <div
                data-testid="ai-dm-suggestion"
                className="space-y-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm dark:border-violet-500/30 dark:bg-violet-500/10"
              >
                <p>
                  AI suggests decision maker: <strong>{DECISION_MAKER_STATUS_LABELS[latest.decision_maker_status]}</strong>{" "}
                  <span className="text-muted-foreground">
                    (currently {DECISION_MAKER_STATUS_LABELS[decisionMakerStatus]})
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => applyDecisionMaker(latest.decision_maker_status)}
                    disabled={applying}
                  >
                    {applying && <Loader2Icon aria-hidden className="animate-spin" />}
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={applying}
                    onClick={() => setDismissed((prev) => new Set(prev).add(latest.id))}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}

            <Button
              size="sm"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() =>
                openScheduleFollowUp(
                  { prospectId, prospectName },
                  { title: "Create follow-up from next step", defaultNote: latest.recommended_next_step },
                )
              }
            >
              Create follow-up from next step
            </Button>
          </div>
        )}

        {previous.length > 0 && (
          <Collapsible className="border-t pt-3">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="group -ml-2 text-muted-foreground">
                <ChevronDownIcon aria-hidden className="transition-transform group-data-[state=open]:rotate-180" />
                Previous insights ({previous.length})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol className="mt-2 space-y-3" aria-label="Previous AI insights" data-testid="ai-insight-history">
                {previous.map((insight) => (
                  <li key={insight.id} className="rounded-md border px-3 py-2" data-insight-id={insight.id}>
                    <InsightBody insight={insight} timezone={timezone} now={now} compact />
                  </li>
                ))}
              </ol>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
      {dialog}
    </Card>
  );
}

function InsightBody({
  insight,
  timezone,
  now,
  compact = false,
}: {
  insight: AiInsightWithAuthor;
  timezone: string;
  now: string;
  compact?: boolean;
}) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <DealHealthBadge health={insight.deal_health} />
        <span className="text-xs text-muted-foreground" title={formatOrgDateTime(insight.created_at, timezone)}>
          Generated {formatRelativeTime(insight.created_at, now)} by {insight.author_name ?? "a former user"}
        </span>
      </div>
      <p className={compact ? "text-muted-foreground" : undefined}>{insight.summary}</p>
      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Decision maker</dt>
        <dd>{DECISION_MAKER_STATUS_LABELS[insight.decision_maker_status]}</dd>
        <dt className="text-muted-foreground">Main objection</dt>
        <dd>{insight.main_objection}</dd>
        <dt className="text-muted-foreground">Next step</dt>
        <dd className="font-medium">{insight.recommended_next_step}</dd>
      </dl>
    </div>
  );
}
