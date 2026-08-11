"use client";

import type { Lens, MetricId } from "../../data/types";
import { useSeries } from "../../data/hooks";
import { TrendChart } from "../charts/trend-chart";
import { CardShell } from "./card-shell";

export function TrendCard({
  lens,
  metric,
  title,
  note,
}: {
  lens: Lens;
  metric: MetricId;
  title?: string;
  note?: string;
}) {
  const { series, loading } = useSeries(lens, metric);
  return (
    <CardShell
      title={title ?? `${series?.label ?? "Metric"} over time`}
      note={note}
      loading={loading}
    >
      {series ? (
        <TrendChart series={series} height={150} />
      ) : (
        <div className="text-xs text-ink-muted">No series for that lens.</div>
      )}
    </CardShell>
  );
}
