"use client";
import { useCrmContext } from "@/components/crm-context";
import {
  KpiRow,
  SalesOverTimeCard,
  RevenueByCategoryCard,
  TopReps,
  UpcomingCloses,
  LatestOrders,
  DashboardSkeleton,
} from "@/components/dashboard";

export default function DashboardPage() {
  const { crm, loading, setSelectedDealId } = useCrmContext();

  return (
    <div className="h-full overflow-auto p-6">
      {loading ? (
        <DashboardSkeleton />
      ) : crm.deals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No data yet. Ask the assistant to research an account or build a quote
          to get started.
        </div>
      ) : (
        <div className="space-y-4">
          {/* 1 — KPI row */}
          <KpiRow crm={crm} />

          {/* 2–5 — responsive analytics grid (collapses to one column ≤1024px) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <SalesOverTimeCard crm={crm} />
            </div>
            <RevenueByCategoryCard crm={crm} />
            <TopReps crm={crm} />
            <div className="lg:col-span-2">
              <UpcomingCloses crm={crm} onSelect={setSelectedDealId} />
            </div>
          </div>

          {/* 6 — latest orders, full width */}
          <LatestOrders crm={crm} onSelect={setSelectedDealId} />
        </div>
      )}
    </div>
  );
}
