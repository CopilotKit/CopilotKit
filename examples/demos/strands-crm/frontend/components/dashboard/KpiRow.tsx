"use client";
import { TrendStat } from "@/components/charts";
import { computeKpis, formatCurrency, salesOverTime } from "@/lib/crm";
import type { CrmState } from "@/lib/crm";

/** Percent change of latest vs previous, rounded; null when no prior baseline. */
function pctDelta(curr: number, prev: number): number | undefined {
  if (!prev) return undefined;
  return Math.round(((curr - prev) / prev) * 100);
}

/**
 * Section 1 — four KPI TrendStat cards: Bookings (closed-won $), Open pipeline,
 * Weighted forecast, Win rate. The bookings series (last 8 months) feeds the
 * sparklines; the Bookings delta is latest-vs-previous month.
 */
export function KpiRow({ crm }: { crm: CrmState }) {
  const k = computeKpis(crm);
  const sot = salesOverTime(crm);
  const series = sot.map((p) => p.bookings);
  const bookings = series.reduce((s, v) => s + v, 0);

  const last = series.at(-1) ?? 0;
  const prev = series.at(-2) ?? 0;
  const bookingsDelta = pctDelta(last, prev);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <TrendStat
        label="Bookings"
        value={formatCurrency(bookings)}
        delta={bookingsDelta}
        data={series}
        hint="closed-won, last 8 mo"
      />
      <TrendStat
        label="Open pipeline"
        value={formatCurrency(k.openPipeline)}
        data={series}
        hint="across open deals"
      />
      <TrendStat
        label="Weighted forecast"
        value={formatCurrency(k.weightedForecast)}
        data={series}
        hint="amount × probability"
      />
      <TrendStat
        label="Win rate"
        value={k.winRate === null ? "—" : `${Math.round(k.winRate * 100)}%`}
        hint="closed won / closed"
      />
    </div>
  );
}
