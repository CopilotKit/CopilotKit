"use client";
import { AreaChart, BarList, DonutChart } from "@/components/charts";
import { Card } from "@/components/ui/card";
import { formatCurrency, relativeTime } from "@/lib/crm";
import type { Report, SalesOverTimePoint } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

/** Date range label like "May 25 – 31, 2026" (same-month aware, UTC). */
function periodLabel(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear();
  const startStr = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endStr = end.toLocaleDateString(
    "en-US",
    sameMonth
      ? { day: "numeric", year: "numeric", timeZone: "UTC" }
      : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
  return `${startStr} – ${endStr}`;
}

function MetricTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {sub ? (
        <div className="text-[11px] text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

/**
 * Full detail view for a generated weekly report. Renders the period + summary,
 * KPI tiles from the snapshot metrics, a donut of revenue-by-category, ranked
 * bar lists for the leaderboard and pipeline-by-stage, an area chart of bookings
 * over time (live context), and the report highlights.
 */
export function ReportDetail({
  report,
  salesTrend,
}: {
  report: Report;
  salesTrend: SalesOverTimePoint[];
}) {
  const { metrics } = report;

  const categoryData = metrics.byCategory.map((c) => ({
    label: c.category,
    value: c.value,
  }));
  const categoryTotal = metrics.byCategory.reduce((s, c) => s + c.value, 0);

  const leaderboardData = metrics.leaderboard.map((r) => ({
    label: r.name,
    value: r.bookings,
    secondary: `${Math.round(r.attainment * 100)}% quota`,
  }));

  const stageData = metrics.byStage
    .filter((s) => s.value > 0 || s.count > 0)
    .map((s) => ({
      label: s.stage,
      value: s.value,
      secondary: `${s.count} ${s.count === 1 ? "deal" : "deals"}`,
    }));

  const trendData = salesTrend.map((p) => ({
    label: p.label,
    value: p.bookings,
  }));

  return (
    <div className="space-y-4">
      <Card className="gap-4 py-5">
        <div className="px-6">
          <div className="text-base font-semibold">{report.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {periodLabel(report.periodStart, report.periodEnd)} · generated{" "}
            {relativeTime(report.generatedAt)}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {report.summary}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 px-6 lg:grid-cols-5">
          <MetricTile
            label="Bookings"
            value={formatCurrency(metrics.bookings)}
          />
          <MetricTile
            label="Weighted forecast"
            value={formatCurrency(metrics.weightedForecast)}
          />
          <MetricTile
            label="Win rate"
            value={
              metrics.winRate === null
                ? "—"
                : `${Math.round(metrics.winRate * 100)}%`
            }
          />
          <MetricTile label="Deals won" value={String(metrics.dealsWon)} />
          <MetricTile label="Deals open" value={String(metrics.dealsOpen)} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 py-5">
          <div className="px-6 text-sm font-semibold">Revenue by category</div>
          <div className="px-6">
            <DonutChart
              data={categoryData}
              centerLabel="total"
              centerValue={Intl.NumberFormat("en-US", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(categoryTotal)}
            />
          </div>
        </Card>

        <Card className="gap-3 py-5">
          <div className="px-6 text-sm font-semibold">Bookings over time</div>
          <div className="px-2">
            <AreaChart data={trendData} height={196} />
          </div>
        </Card>

        <Card className="gap-3 py-5">
          <div className="px-6 text-sm font-semibold">Rep leaderboard</div>
          <div className="px-6">
            <BarList data={leaderboardData} format={formatCurrency} />
          </div>
        </Card>

        <Card className="gap-3 py-5">
          <div className="px-6 text-sm font-semibold">Pipeline by stage</div>
          <div className="px-6">
            <BarList data={stageData} format={formatCurrency} />
          </div>
        </Card>
      </div>

      <Card className="gap-3 py-5">
        <div className="flex items-center gap-2 px-6 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden />
          Highlights
        </div>
        <ul className="space-y-2 px-6">
          {report.highlights.map((h, i) => (
            <li key={i} className="flex gap-2 text-sm text-muted-foreground">
              <span
                className={cn(
                  "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary",
                )}
                aria-hidden
              />
              <span>{h}</span>
            </li>
          ))}
          {report.highlights.length === 0 && (
            <li className="text-sm text-muted-foreground">
              No highlights for this period.
            </li>
          )}
        </ul>
      </Card>
    </div>
  );
}
