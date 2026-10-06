import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function KpiTilesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }, (_, tile) => (
        <div key={tile} className="glass space-y-2 rounded-2xl p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export function SectionSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <Card aria-busy="true" aria-label={`Loading ${label}`} className="gap-4">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="space-y-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
