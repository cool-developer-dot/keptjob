import { Skeleton } from "@/components/ui/skeleton";

/** Pipeline skeleton (header, filters, a few columns). */
export default function PipelineLoading() {
  return (
    <div aria-busy="true" aria-label="Loading pipeline">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-full sm:w-72" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }, (_, column) => (
          <div key={column} className="glass w-72 shrink-0 space-y-2.5 rounded-3xl p-2.5">
            <Skeleton className="h-6 w-32" />
            {Array.from({ length: 3 - (column % 2) }, (_, card) => (
              <Skeleton key={card} className="h-24 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
