import { Skeleton } from "@/components/ui/skeleton";

import { FollowUpListSkeleton } from "./follow-up-list-skeleton";

/** First-load skeleton (header, tabs, rows). Tab switches use the in-page Suspense fallback. */
export default function FollowUpsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading follow-ups">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="mb-4 flex gap-2 border-b pb-2">
        {Array.from({ length: 5 }, (_, tab) => (
          <Skeleton key={tab} className="h-6 w-24" />
        ))}
      </div>
      <FollowUpListSkeleton />
    </div>
  );
}
