"use client";

import type { SeriesResult } from "../../data/derive";
import { formatValue } from "../../data/format";
import { SERIES_COLORS } from "./palette";

/**
 * Area + line, hairline gridlines at ~8% ink, no chart border, direct axis
 * labels instead of a legend (there is one series). Hand-rolled SVG — the repo
 * ships no charting dependency and banking does the same.
 */
export function TrendChart({
  series,
  height = 180,
}: {
  series: SeriesResult;
  height?: number;
}) {
  const points = series.points;
  if (points.length < 2) {
    return (
      <div className="text-sm text-ink-muted">
        Not enough data in this period to draw a trend.
      </div>
    );
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 100;
  const H = 40;
  const xy = (i: number, value: number) => ({
    x: (i / (points.length - 1)) * W,
    y: H - ((value - min) / span) * (H - 2) - 1,
  });
  const path = points
    .map((p, i) => {
      const { x, y } = xy(i, p.value);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const area = `${path} L${W} ${H} L0 ${H} Z`;

  return (
    <div className="space-y-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full"
        role="img"
        aria-label={`${series.label} over ${points.length} periods`}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="hsl(var(--ink) / 0.08)"
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill={SERIES_COLORS[0]} opacity={0.14} />
        <path
          d={path}
          fill="none"
          stroke={SERIES_COLORS[0]}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex justify-between text-[11px] text-ink-muted">
        <span>{points[0].label}</span>
        <span className="nw-figure">
          {formatValue(points.at(-1)!.value, series.unit, { compact: true })}
        </span>
        <span>{points.at(-1)!.label}</span>
      </div>
    </div>
  );
}
