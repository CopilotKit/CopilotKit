"use client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function CardSkeleton({ height }: { height: number }) {
  return (
    <Card className="gap-4 p-4">
      <Skeleton className="h-5 w-32 rounded-full" />
      <Skeleton className="w-full rounded-lg" style={{ height }} />
    </Card>
  );
}

/** Loading state mirroring the dashboard grid: KPI row + 2×2 chart/list grid. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[112px] w-full rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CardSkeleton height={220} />
        </div>
        <CardSkeleton height={200} />
        <CardSkeleton height={180} />
        <CardSkeleton height={180} />
        <div className="lg:col-span-3">
          <CardSkeleton height={220} />
        </div>
      </div>
    </div>
  );
}
