"use client";
import { useCrmContext } from "@/components/crm-context";
import { TeamLeaderboard } from "@/components/team/TeamLeaderboard";
import { DonutChart } from "@/components/charts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, teamStats } from "@/lib/crm";

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card className="gap-1 p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

/**
 * Team Reports — whole-team performance. Workspace render target for
 * `analyze_team`. Computed live from the CRM snapshot via `teamStats`
 * (mirrors the server analytics), so it always reflects current state.
 */
export default function TeamReportsPage() {
  const { crm, loading } = useCrmContext();
  const stats = teamStats(crm);
  const categoryData = stats.byCategory.map((c) => ({
    label: c.category,
    value: c.value,
  }));

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Team Reports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Team-wide performance — bookings, forecast, win rate, and the rep
            leaderboard.
          </p>
        </div>

        {loading ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Kpi
                label="Bookings"
                value={formatCurrency(stats.totalBookings)}
              />
              <Kpi
                label="Weighted forecast"
                value={formatCurrency(stats.weightedForecast)}
              />
              <Kpi
                label="Win rate"
                value={
                  stats.winRate === null
                    ? "—"
                    : `${Math.round(stats.winRate * 100)}%`
                }
              />
            </div>

            <TeamLeaderboard crm={crm} />

            {categoryData.length > 0 && (
              <Card className="gap-3 py-5">
                <div className="px-6 text-sm font-semibold">
                  Open pipeline by category
                </div>
                <div className="px-6">
                  <DonutChart data={categoryData} />
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
