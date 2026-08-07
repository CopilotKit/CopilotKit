"use client";

import type { BreakdownRow } from "../../data/derive";
import { formatValue } from "../../data/format";
import type { Unit } from "../../data/format";
import { SERIES_COLORS } from "./palette";

/**
 * Horizontal bars with direct labels — no legend, because the label IS on the
 * row. Sorted descending upstream in computeBreakdown, so the biggest
 * contributor reads first.
 */
export function BreakdownChart({
  rows,
  unit,
}: {
  rows: BreakdownRow[];
  unit: Unit;
}) {
  if (!rows.length) {
    return <div className="text-sm text-ink-muted">Nothing to break down.</div>;
  }
  const max = Math.max(...rows.map((r) => r.value)) || 1;
  return (
    <div className="space-y-2.5">
      {rows.map((row, i) => (
        <div key={row.key} className="space-y-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-ink">{row.label}</span>
            <span className="nw-figure text-ink-muted">
              {formatValue(row.value, unit, { compact: true })}
              <span className="ml-1.5 text-ink-muted/70">
                {(row.share * 100).toFixed(0)}%
              </span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max((row.value / max) * 100, 1)}%`,
                background: SERIES_COLORS[i % SERIES_COLORS.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
