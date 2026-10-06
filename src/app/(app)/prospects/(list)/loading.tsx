import { Skeleton } from "@/components/ui/skeleton";

/** Prospects list skeleton (header, filters, rows). */
export default function ProspectsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading prospects">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-full sm:w-72" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-32" />
        ))}
      </div>
      <div className="glass space-y-px overflow-hidden rounded-2xl">
        <Skeleton className="h-10 w-full rounded-none" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-t px-3 py-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="hidden h-4 w-16 md:block" />
            <Skeleton className="hidden h-5 w-24 rounded-full md:block" />
            <Skeleton className="hidden h-4 w-24 lg:block" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
