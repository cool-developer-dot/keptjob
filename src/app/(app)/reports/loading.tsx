import { Skeleton } from "@/components/ui/skeleton";

import { ReportSkeleton } from "./skeletons";

/** First-load skeleton: header, filters and the report body. */
export default function ReportsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading reports">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="mb-6 flex flex-wrap gap-3">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-44" />
      </div>
      <ReportSkeleton />
    </div>
  );
}
