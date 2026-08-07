"use client";

import type { WaterfallStep } from "../../data/derive";
import { formatValue } from "../../data/format";
import type { Unit } from "../../data/format";
import { DIVERGING } from "./palette";

/**
 * Plan → per-region variance → Actual. Nothing else in the repo has a
 * waterfall, and it is the most exec-legible chart form there is: it does not
 * just show that the number moved, it shows WHO moved it. This is beat 3c's
 * answer to "why did EMEA slip?".
 *
 * The deltas reconcile start to end exactly (asserted in derive.test.ts), so the
 * floating bars always land on the end bar — a waterfall whose bars do not
 * reconcile reads as broken even when the arithmetic is fine.
 */
export function WaterfallChart({
  steps,
  unit,
}: {
  steps: WaterfallStep[];
  unit: Unit;
}) {
  if (steps.length < 3) return null;
  // Running cumulative base for each floating delta bar, threaded through the
  // reduction accumulator rather than a mutated outer variable.
  const bars = steps.reduce<{
    bars: (WaterfallStep & { from: number; to: number })[];
    running: number;
  }>(
    (acc, step) => {
      if (step.kind === "start") {
        return {
          bars: [...acc.bars, { ...step, from: 0, to: step.value }],
          running: step.value,
        };
      }
      if (step.kind === "end") {
        return {
          bars: [...acc.bars, { ...step, from: 0, to: step.value }],
          running: acc.running,
        };
      }
      const from = acc.running;
      const running = from + step.value;
      return { bars: [...acc.bars, { ...step, from, to: running }], running };
    },
    { bars: [], running: 0 },
  ).bars;
  const max = Math.max(...bars.map((b) => Math.max(b.from, b.to)));
  const scale = (value: number) => (max ? (value / max) * 100 : 0);

  return (
    <div className="space-y-3">
      <div className="flex h-44 items-end gap-2">
        {bars.map((bar) => {
          const low = Math.min(bar.from, bar.to);
          const high = Math.max(bar.from, bar.to);
          const isDelta = bar.kind === "delta";
          const color = !isDelta
            ? "hsl(var(--brand))"
            : bar.value < 0
              ? DIVERGING.negative
              : DIVERGING.positive;
          return (
            <div
              key={bar.label}
              className="relative flex h-full flex-1 flex-col justify-end"
            >
              <div
                className="w-full rounded-sm"
                style={{
                  height: `${Math.max(scale(high - low), 0.8)}%`,
                  marginBottom: `${scale(low)}%`,
                  background: color,
                  opacity: isDelta ? 0.9 : 1,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        {bars.map((bar) => (
          <div key={bar.label} className="flex-1 space-y-0.5 text-center">
            <div className="truncate text-[11px] text-ink-muted">
              {bar.label}
            </div>
            <div
              className={
                bar.kind === "delta" && bar.value < 0
                  ? "nw-figure text-[11px] font-semibold text-negative"
                  : bar.kind === "delta"
                    ? "nw-figure text-[11px] font-semibold text-positive"
                    : "nw-figure text-[11px] font-semibold text-ink"
              }
            >
              {bar.kind === "delta" && bar.value > 0 ? "+" : ""}
              {formatValue(bar.value, unit, { compact: true })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
