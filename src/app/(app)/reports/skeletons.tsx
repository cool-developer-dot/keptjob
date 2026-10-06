import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function ChartCardSkeleton({ label, rows }: { label: string; rows: number }) {
  return (
    <Card aria-label={`Loading ${label}`} className="gap-4">
      <CardHeader>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </CardHeader>
      <CardContent className="space-y-2.5">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-3">
            <Skeleton className="h-3 w-24 shrink-0" />
            <Skeleton className="h-5" style={{ width: `${Math.max(12, 90 - row * 11)}%` }} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Report body skeleton: 8 tiles, counts strip, funnel + table, two charts. */
export function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading report" className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, tile) => (
          <div key={tile} className="glass space-y-2 rounded-2xl p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <Card className="gap-4">
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          {Array.from({ length: 8 }, (_, item) => (
            <div key={item} className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-10" />
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCardSkeleton label="funnel" rows={7} />
        <ChartCardSkeleton label="conversion rates" rows={7} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCardSkeleton label="prospects by stage" rows={9} />
        <ChartCardSkeleton label="lost reasons" rows={7} />
      </div>
    </div>
  );
}
