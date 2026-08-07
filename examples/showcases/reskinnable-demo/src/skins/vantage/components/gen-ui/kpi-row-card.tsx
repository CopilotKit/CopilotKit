"use client";

import type { Lens, MetricId } from "../../data/types";
import { useKpis } from "../../data/hooks";
import { KpiTile } from "../charts/kpi-tile";
import { CardShell } from "./card-shell";

export function KpiRowCard({
  lens,
  metrics,
  title,
  note,
}: {
  lens: Lens;
  metrics?: MetricId[];
  title?: string;
  note?: string;
}) {
  // `metrics` must reach the fetch, not just the filter below — filtering the
  // default four by a metric outside them (nrr, magic_number) renders an empty
  // card rather than the tile that was asked for.
  const { kpis, loading } = useKpis(lens, metrics);
  const shown = metrics?.length
    ? kpis.filter((k) => metrics.includes(k.metric))
    : kpis;
  return (
    <CardShell
      title={title ?? "How the quarter is tracking"}
      note={note}
      loading={loading}
    >
      <div className="grid grid-cols-2 gap-2">
        {shown.map((kpi) => (
          <KpiTile key={kpi.metric} kpi={kpi} />
        ))}
      </div>
    </CardShell>
  );
}
