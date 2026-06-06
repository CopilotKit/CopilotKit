"use client";

/**
 * TierDonut — portfolio-scale slice of leads by tier.
 *
 * Visual:
 *   - SVG donut, ~140px square
 *   - 4 arcs (Hot / Warm / Nurture / Drop), tier palette
 *   - Center label = total count + "leads"
 *   - Optional `onSliceClick` lets the agent or user filter the canvas to
 *     a single tier when the chart is rendered inline in chat
 *
 * Driven by counts. Caller is responsible for deriving from agent state
 * (e.g. iterating state.enrichment.perLead). Keeps the component pure.
 */

import { motion } from "motion/react";
import type { Tier } from "@/lib/leads/types";

export interface TierDonutProps {
  counts: Record<Tier, number>;
  /** ~140 by default. */
  size?: number;
  onSliceClick?: (tier: Tier) => void;
  className?: string;
}

const TIER_ORDER: Tier[] = ["hot", "warm", "nurture", "drop"];

const TIER_COLOR: Record<Tier, string> = {
  hot: "#f43f5e", // rose-500
  warm: "#f59e0b", // amber-500
  nurture: "#0ea5e9", // sky-500
  drop: "#94a3b8", // slate-400
};

const TIER_LABEL: Record<Tier, string> = {
  hot: "Hot",
  warm: "Warm",
  nurture: "Nurture",
  drop: "Drop",
};

export function TierDonut({
  counts,
  size = 140,
  onSliceClick,
  className,
}: TierDonutProps) {
  const total = TIER_ORDER.reduce((acc, t) => acc + (counts[t] ?? 0), 0);
  const center = size / 2;
  const radius = size * 0.42;
  const stroke = size * 0.16;

  // Build each arc's start/end angle (radians) and SVG path.
  let cursor = -Math.PI / 2;
  const slices = TIER_ORDER.map((tier) => {
    const value = counts[tier] ?? 0;
    const fraction = total === 0 ? 0 : value / total;
    const startAngle = cursor;
    const endAngle = cursor + fraction * 2 * Math.PI;
    cursor = endAngle;
    return { tier, value, fraction, startAngle, endAngle };
  });

  return (
    <div
      className={`flex items-start gap-4 rounded-xl border border-border bg-card p-3 shadow-sm ${className ?? ""}`}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={`${total} leads, split by tier`}
      >
        {total === 0 ? (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={stroke}
            strokeDasharray="3 3"
          />
        ) : (
          slices.map((slice) =>
            slice.fraction === 0 ? null : (
              <motion.path
                key={slice.tier}
                d={arcPath(center, center, radius, slice.startAngle, slice.endAngle)}
                fill="none"
                stroke={TIER_COLOR[slice.tier]}
                strokeWidth={stroke}
                strokeLinecap="butt"
                initial={{ pathLength: 0, opacity: 0.4 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                style={{ cursor: onSliceClick ? "pointer" : "default" }}
                onClick={() => onSliceClick?.(slice.tier)}
              />
            ),
          )
        )}
        {/* Center label */}
        <text
          x={center}
          y={center - 4}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground font-mono text-[18px] font-semibold tabular-nums"
        >
          {total}
        </text>
        <text
          x={center}
          y={center + 12}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-muted-foreground text-[9px] uppercase tracking-widest"
        >
          leads
        </text>
      </svg>

      {/* Legend */}
      <ul className="flex flex-1 flex-col gap-1.5 self-center">
        {TIER_ORDER.map((tier) => {
          const value = counts[tier] ?? 0;
          const pct = total === 0 ? 0 : Math.round((value / total) * 100);
          return (
            <li key={tier} className="flex items-center gap-2 text-[11px]">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: TIER_COLOR[tier] }}
              />
              <span className="flex-1 text-foreground">{TIER_LABEL[tier]}</span>
              <span className="font-mono tabular-nums text-foreground">
                {value}
              </span>
              <span className="w-8 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG arc helper
// ---------------------------------------------------------------------------

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  // Round coordinates before they hit the rendered HTML — Math.cos/sin
  // aren't required to be bit-exact across JS engines, so the server
  // (Node V8) and client (Chrome V8) can disagree on the last ULP and
  // trigger a hydration mismatch. Two decimal places is plenty for SVG
  // and snaps the strings into stable form.
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${fmt(start[0])} ${fmt(start[1])} A ${fmt(r)} ${fmt(r)} 0 ${largeArc} 1 ${fmt(end[0])} ${fmt(end[1])}`;
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

function fmt(n: number): string {
  return n.toFixed(2);
}
