"use client";

import type { KpiResult } from "../../data/derive";
import { deltaTone, formatDelta, formatValue } from "../../data/format";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-ink-muted",
} as const;

export function Sparkline({
  values,
  tone = "neutral",
}: {
  values: number[];
  tone?: "positive" | "negative" | "neutral";
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 20 - ((value - min) / span) * 18 - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const stroke =
    tone === "positive"
      ? "hsl(var(--positive))"
      : tone === "negative"
        ? "hsl(var(--negative))"
        : "hsl(var(--brand))";
  return (
    <svg
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      className="h-5 w-full"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A KPI tile is a display-weight number with a tinted delta chip and a spark —
 * not a card with a title and a giant icon. `nw-figure` supplies tabular
 * figures so a column of these does not jitter between renders.
 */
export function KpiTile({ kpi }: { kpi: KpiResult }) {
  const tone = deltaTone(kpi.deltaPct, kpi.unit);
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-hairline bg-surface p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {kpi.label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="nw-figure text-2xl font-semibold tracking-tight text-ink">
          {formatValue(kpi.value, kpi.unit, { compact: true })}
        </span>
        {kpi.deltaPct !== 0 && (
          <span
            className={cn(
              "nw-figure rounded px-1.5 py-0.5 text-[11px] font-semibold",
              tone === "positive" && "bg-positive-soft text-positive",
              tone === "negative" && "bg-negative-soft text-negative",
              tone === "neutral" && "bg-surface-muted text-ink-muted",
            )}
          >
            {formatDelta(kpi.deltaPct)}
          </span>
        )}
      </div>
      <Sparkline values={kpi.sparkline} tone={tone} />
      <div className={cn("text-[11px]", TONE_CLASS[tone])}>
        {kpi.deltaPct === 0 ? "No comparison" : "vs prior"}
      </div>
    </div>
  );
}
