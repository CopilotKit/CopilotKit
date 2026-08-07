"use client";

import { useAgentContext } from "@copilotkit/react-core/v2";
import { useBoards, useKpis, useSeries } from "../data/hooks";
import { DEFAULT_LENS } from "../data/lens";
import { formatValue } from "../data/format";
import { KpiTile } from "../components/charts/kpi-tile";
import { TrendChart } from "../components/charts/trend-chart";
import { BreakdownChart } from "../components/charts/breakdown-chart";

export function BoardroomPage() {
  const { boards } = useBoards();
  const pinned = boards.find((b) => b.pinned) ?? boards[0] ?? null;
  const lens = pinned?.lens ?? DEFAULT_LENS;
  const { kpis } = useKpis(lens);
  const { series, breakdown } = useSeries(lens, "arr", "segment");

  // The anomaly the page is showing — the biggest negative KPI move. Surfacing
  // it here (and in the readable) is what lets the agent open with the read
  // rather than a description.
  const anomaly = [...kpis].sort((a, b) => a.deltaPct - b.deltaPct)[0] ?? null;

  // ON-SCREEN READABLE: the actual visible figures, so "what am I looking at?"
  // cites real numbers instead of describing the layout.
  useAgentContext({
    description:
      "What is visibly on the Boardroom page right now: the pinned board, every " +
      "KPI tile with its value and change, and the flagged anomaly. Cite these " +
      "figures directly.",
    value: JSON.stringify({
      page: "Boardroom",
      pinnedBoard: pinned?.title ?? null,
      lens,
      kpiTiles: kpis.map((k) => ({
        label: k.label,
        value: formatValue(k.value, k.unit, { compact: true }),
        change: `${(k.deltaPct * 100).toFixed(1)}%`,
      })),
      flaggedAnomaly: anomaly
        ? `${anomaly.label} ${(anomaly.deltaPct * 100).toFixed(1)}%`
        : null,
      arrBySegment: breakdown.map((r) => ({
        segment: r.label,
        value: formatValue(r.value, "usd", { compact: true }),
      })),
    }),
  });

  if (!pinned) {
    return (
      <div className="text-sm text-ink-muted">No board is pinned yet.</div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {pinned.title}
        </h1>
        <p className="text-sm text-ink-muted">{pinned.summary}</p>
      </header>

      {anomaly && anomaly.deltaPct < 0 && (
        <div className="flex items-start gap-2.5 rounded-[var(--radius)] border border-negative/40 bg-negative-soft px-3.5 py-2.5">
          <span className="mt-0.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-negative" />
          <p className="text-sm text-ink">
            <span className="font-semibold">{anomaly.label}</span> moved{" "}
            <span className="nw-figure font-semibold text-negative">
              {(anomaly.deltaPct * 100).toFixed(1)}%
            </span>{" "}
            against the prior period — the largest adverse move on this board.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiTile key={kpi.metric} kpi={kpi} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">ARR over time</h2>
          {series && <TrendChart series={series} />}
        </section>
        <section className="space-y-3 rounded-[var(--radius)] border border-hairline bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">ARR by segment</h2>
          <BreakdownChart rows={breakdown} unit="usd" />
        </section>
      </div>
    </div>
  );
}

export default BoardroomPage;
