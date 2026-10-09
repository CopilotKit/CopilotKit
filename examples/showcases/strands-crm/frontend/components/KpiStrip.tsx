"use client";
import { computeKpis, formatCurrency } from "@/lib/crm";
import type { CrmState } from "@/lib/crm";
import { KpiCard } from "./KpiCard";
import { Skeleton } from "@/components/ui/skeleton";

export function KpiStrip({
  crm,
  loading,
}: {
  crm: CrmState;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] w-full rounded-xl" />
        ))}
      </div>
    );
  }
  const k = computeKpis(crm);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        label="Open pipeline"
        value={formatCurrency(k.openPipeline)}
        sub="across open deals"
      />
      <KpiCard
        label="Weighted forecast"
        value={formatCurrency(k.weightedForecast)}
        sub="amount × probability"
      />
      <KpiCard
        label="Win rate"
        value={k.winRate === null ? "—" : `${Math.round(k.winRate * 100)}%`}
        sub="closed won / closed"
      />
      <KpiCard
        label="At-risk deals"
        value={String(k.atRisk)}
        sub="need attention"
      />
    </div>
  );
}
