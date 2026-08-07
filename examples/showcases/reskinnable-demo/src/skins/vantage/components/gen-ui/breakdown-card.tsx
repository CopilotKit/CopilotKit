"use client";

import type { Dimension, Lens, MetricId } from "../../data/types";
import { useSeries } from "../../data/hooks";
import { BreakdownChart } from "../charts/breakdown-chart";
import { CardShell } from "./card-shell";

export function BreakdownCard({
  lens,
  metric,
  dimension,
  title,
  note,
}: {
  lens: Lens;
  metric: MetricId;
  dimension: Dimension;
  title?: string;
  note?: string;
}) {
  const { series, breakdown, loading } = useSeries(lens, metric, dimension);
  return (
    <CardShell
      title={title ?? `${series?.label ?? "Metric"} by ${dimension}`}
      note={note}
      loading={loading}
    >
      <BreakdownChart rows={breakdown} unit={series?.unit ?? "usd"} />
    </CardShell>
  );
}
