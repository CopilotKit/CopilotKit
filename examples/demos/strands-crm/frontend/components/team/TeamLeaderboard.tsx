"use client";
import { Card } from "@/components/ui/card";
import { BarList } from "@/components/charts";
import { teamLeaderboard, formatCurrency } from "@/lib/crm";
import type { CrmState } from "@/lib/crm";

/**
 * Ranked team leaderboard: a BarList of every rep's all-time bookings
 * (Closed-Won $), with their quota attainment shown as the secondary caption.
 */
export function TeamLeaderboard({ crm }: { crm: CrmState }) {
  const rows = teamLeaderboard(crm).map((r) => ({
    label: r.name,
    value: r.bookings,
    secondary: r.quota > 0 ? `${Math.round(r.attainment * 100)}%` : "—",
  }));

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-semibold">Leaderboard</div>
        <div className="text-xs text-muted-foreground">
          Bookings · attainment
        </div>
      </div>
      <BarList data={rows} format={(v) => formatCurrency(v)} />
    </Card>
  );
}
