/**
 * PLACEHOLDER — Prompt 11 implements this component (SPEC §10): manual
 * "Generate AI Insights" / "Regenerate", latest insight + history, Apply /
 * Dismiss and "Create follow-up from next step" (reuse
 * src/components/follow-ups/follow-up-form.tsx with `defaultNote`).
 *
 * The prospect detail page already renders it in its right column
 * (`src/app/(app)/prospects/[id]/page.tsx`, "Prompt 11: AI insights slot"), so
 * Prompt 11 only replaces this file (it may become a client component). Keep
 * the `prospectId` prop.
 */
import { SparklesIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AiInsightsCard({ prospectId }: { prospectId: string }) {
  return (
    <Card data-slot="ai-insights" data-prospect-id={prospectId} aria-labelledby="ai-insights-title">
      <CardHeader>
        <CardTitle id="ai-insights-title" className="flex items-center gap-2">
          <SparklesIcon aria-hidden className="size-4 text-muted-foreground" />
          AI insights
        </CardTitle>
        <CardDescription>Summary, main objection and the recommended next step.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          AI insights aren&apos;t available yet.
        </p>
      </CardContent>
    </Card>
  );
}
