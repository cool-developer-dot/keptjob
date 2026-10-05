import { Skeleton } from "@/components/ui/skeleton";

import { KpiTilesSkeleton, SectionSkeleton } from "./skeletons";

/** First-load skeleton: greeting, KPI tiles and the four sections. */
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="space-y-6">
        <KpiTilesSkeleton />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <SectionSkeleton label="contact today" />
            <SectionSkeleton label="deals needing attention" />
          </div>
          <div className="space-y-6">
            <SectionSkeleton label="AI recommendations" rows={2} />
            <SectionSkeleton label="recent activity" rows={4} />
          </div>
        </div>
      </div>
    </div>
  );
}
