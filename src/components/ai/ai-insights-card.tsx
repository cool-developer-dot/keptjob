/**
 * AI insights card on the prospect detail page (SPEC §10). Server component:
 * streams the prospect's insights (RLS) into the client <AiInsightsPanel>
 * (generate / regenerate, latest + history, Apply / Dismiss, "Create follow-up
 * from next step"). Rendered in the page's right column.
 */
import { SparklesIcon } from "lucide-react";
import { Suspense } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listProspectInsightsData } from "@/server/data/ai-insights";
import { getProspectDetailData } from "@/server/data/prospect-detail";

import { AiInsightsPanel } from "./ai-insights-panel";

export function AiInsightsCard({ prospectId }: { prospectId: string }) {
  return (
    <Suspense fallback={<AiInsightsSkeleton />}>
      <AiInsightsLoader prospectId={prospectId} />
    </Suspense>
  );
}

async function AiInsightsLoader({ prospectId }: { prospectId: string }) {
  const user = await requireUser();
  const ctx = { supabase: await createClient(), user: { id: user.id, role: user.role } };
  const [insights, prospect] = await Promise.all([
    listProspectInsightsData(ctx, prospectId),
    getProspectDetailData(ctx, prospectId),
  ]);
  if (!prospect.ok || !prospect.data) return null; // the page itself 404s / errors in this case

  return (
    <AiInsightsPanel
      prospectId={prospectId}
      prospectName={prospect.data.name}
      decisionMakerStatus={prospect.data.decision_maker_status}
      insights={insights.ok ? insights.data : []}
      loadError={insights.ok ? null : insights.error}
      now={new Date().toISOString()}
    />
  );
}

function AiInsightsSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading AI insights">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon aria-hidden className="size-4 text-muted-foreground" />
          AI insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardContent>
    </Card>
  );
}
