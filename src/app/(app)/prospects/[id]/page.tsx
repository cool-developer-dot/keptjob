import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";

import { AiInsightsCard } from "@/components/ai/ai-insights-card";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/common";
import type { DataContext } from "@/server/data/context";
import { getProspectDetailData, listTeamData, type TeamMember } from "@/server/data/prospect-detail";

import { FollowUpsPanelSkeleton, TimelineSkeleton } from "./detail-skeletons";
import { FollowUpsSection } from "./follow-ups-section";
import { ProspectHeader } from "./prospect-header";
import { ProspectInfoCard } from "./prospect-info-card";
import { TimelineSection } from "./timeline-section";

/**
 * Prospect details (SPEC §11). No loading.tsx on purpose: the existence check
 * (through RLS) runs before any Suspense boundary, so a missing / not-visible
 * prospect is a real HTTP 404. The heavier sections stream in <Suspense>.
 */

async function dataContext(): Promise<DataContext> {
  const user = await requireUser();
  return { supabase: await createClient(), user: { id: user.id, role: user.role } };
}

/** Prospect (RLS) — null when missing, hidden or not a uuid. Deduped per request. */
const loadProspect = cache(async (id: string) => {
  if (!uuidSchema.safeParse(id).success) return null;
  const result = await getProspectDetailData(await dataContext(), id);
  if (!result.ok) throw new Error(result.error);
  return result.data;
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!(await getCurrentUser())) return { title: "Prospect · AI Sales CRM" };
  const prospect = await loadProspect(id);
  return { title: `${prospect?.name ?? "Prospect not found"} · AI Sales CRM` };
}

export default async function ProspectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  const user = await requireUser();
  const isManager = user.role === "manager";
  const ctx = await dataContext();
  const [prospect, teamResult] = await Promise.all([loadProspect(id), listTeamData(ctx)]);
  if (!prospect) notFound();
  if (!teamResult.ok) throw new Error(teamResult.error);
  const team: TeamMember[] = teamResult.data;

  return (
    <div className="space-y-6">
      <ProspectHeader prospect={prospect} team={team} isManager={isManager} />

      <div className="grid gap-6 xl:grid-cols-3 xl:grid-rows-[auto_1fr] xl:items-start">
        <div className="min-w-0 xl:col-span-2">
          <ProspectInfoCard prospect={prospect} />
        </div>

        <aside className="flex min-w-0 flex-col gap-6 xl:col-start-3 xl:row-span-2 xl:row-start-1">
          <Suspense fallback={<FollowUpsPanelSkeleton />}>
            <FollowUpsSection ctx={ctx} prospectId={prospect.id} team={team} />
          </Suspense>
          {/* Prompt 11: AI insights slot — replace the component in src/components/ai/ai-insights-card.tsx. */}
          <AiInsightsCard prospectId={prospect.id} />
        </aside>

        <div className="min-w-0 xl:col-span-2">
          <Suspense fallback={<TimelineSkeleton />}>
            <TimelineSection ctx={ctx} prospectId={prospect.id} team={team} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
