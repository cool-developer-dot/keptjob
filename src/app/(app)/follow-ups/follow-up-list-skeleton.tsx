import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder rows while a tab's list streams in. */
export function FollowUpListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading follow-ups" className="glass divide-y divide-[oklch(0.3_0.01_255/0.07)] overflow-hidden rounded-2xl dark:divide-white/5">
      {Array.from({ length: 4 }, (_, row) => (
        <div key={row} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="space-y-2 lg:w-56">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-4 w-28" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-44" />
        </div>
      ))}
    </div>
  );
}
