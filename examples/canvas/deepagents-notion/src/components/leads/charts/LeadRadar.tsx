"use client";

/**
 * LeadRadar — five-axis radar comparing one lead against the ICP.
 *
 * Visual:
 *   - Concentric grid (4 polygons at 25/50/75/100%)
 *   - Dashed reference polygon = ICP target
 *   - Filled polygon = this lead, secondary-tinted
 *   - Vertex dots highlight on hover with axis label tooltip
 *   - Score + tier pill in the corner
 *
 * Sized to fit comfortably inside LeadDetail (~240px) but also works as
 * an inline-in-chat render at the same scale. The agent calls
 * `renderLeadRadar({leadId, axes})` and CopilotKit drops it in the stream.
 *
 * Pure SVG; no per-frame work. Entrance animation via motion path-length.
 */

import { motion } from "motion/react";
import type { RadarAxes, Tier } from "@/lib/leads/types";
import { ICP_REFERENCE } from "@/lib/leads/types";

const AXIS_LABELS: { key: keyof RadarAxes; short: string; long: string }[] = [
  { key: "copilotKitFit", short: "CK fit", long: "CopilotKit fit" },
  { key: "langChainFit", short: "LC fit", long: "LangChain fit" },
  { key: "agenticUiInterest", short: "Agentic UI", long: "Agentic UI interest" },
  { key: "productionReadiness", short: "Prod ready", long: "Production readiness" },
  { key: "decisionMakerScore", short: "DM score", long: "Decision-maker score" },
];

const SIZE = 240;
const CENTER = SIZE / 2;
const RADIUS = SIZE * 0.36;
const NUM_AXES = AXIS_LABELS.length;
const ANGLE_STEP = (2 * Math.PI) / NUM_AXES;

const TIER_FILL: Record<Tier, { stroke: string; fill: string; pill: string }> = {
  hot: {
    stroke: "var(--color-secondary)",
    fill: "rgba(99, 102, 241, 0.18)",
    pill: "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30",
  },
  warm: {
    stroke: "var(--color-secondary)",
    fill: "rgba(99, 102, 241, 0.14)",
    pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  },
  nurture: {
    stroke: "var(--color-secondary)",
    fill: "rgba(99, 102, 241, 0.10)",
    pill: "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30",
  },
  drop: {
    stroke: "var(--color-muted-foreground)",
    fill: "rgba(148, 163, 184, 0.10)",
    pill: "bg-slate-500/15 text-slate-700 dark:text-slate-300 ring-slate-500/30",
  },
};

const TIER_LABEL: Record<Tier, string> = {
  hot: "Hot",
  warm: "Warm",
  nurture: "Nurture",
  drop: "Drop",
};

export interface LeadRadarProps {
  /** The lead's name — shown small above the radar. */
  leadName?: string;
  axes: RadarAxes;
  /** Reference shape drawn dashed behind the lead polygon. Defaults to
   *  ICP_REFERENCE. */
  reference?: RadarAxes;
  score?: number;
  tier?: Tier;
  className?: string;
}

export function LeadRadar({
  leadName,
  axes,
  reference = ICP_REFERENCE,
  score,
  tier,
  className,
}: LeadRadarProps) {
  const leadPoints = axesToPoints(axes);
  const referencePoints = axesToPoints(reference);
  const fill = tier ? TIER_FILL[tier] : TIER_FILL.warm;

  return (
    <div
      className={`flex w-fit max-w-[320px] flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-sm ${className ?? ""}`}
    >
      {/* Header: name + tier pill + score */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Lead profile
          </div>
          {leadName ? (
            <div className="truncate text-sm font-semibold text-foreground">
              {leadName}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {tier ? (
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${fill.pill}`}
            >
              {TIER_LABEL[tier]}
            </span>
          ) : null}
          {typeof score === "number" ? (
            <span className="font-mono text-[12px] font-semibold tabular-nums text-foreground">
              {score}
            </span>
          ) : null}
        </div>
      </div>

      {/* Radar SVG */}
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={`Radar chart for ${leadName ?? "lead"}`}
        className="overflow-visible"
      >
        {/* Concentric grid */}
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <polygon
            key={r}
            points={polygonPoints(r * RADIUS)}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={1}
            opacity={0.6}
          />
        ))}

        {/* Axes */}
        {AXIS_LABELS.map((_, i) => {
          const [x, y] = pointAt(i, RADIUS);
          return (
            <line
              key={i}
              x1={CENTER}
              y1={CENTER}
              x2={fmt(x)}
              y2={fmt(y)}
              stroke="var(--color-border)"
              strokeWidth={1}
              opacity={0.5}
            />
          );
        })}

        {/* Reference (ICP) — dashed */}
        <polygon
          points={pointsToString(referencePoints)}
          fill="none"
          stroke="var(--color-muted-foreground)"
          strokeWidth={1}
          strokeDasharray="3 2"
          opacity={0.6}
        />

        {/* Lead polygon — animated entrance */}
        <motion.polygon
          points={pointsToString(leadPoints)}
          fill={fill.fill}
          stroke={fill.stroke}
          strokeWidth={1.5}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
        />

        {/* Vertex dots */}
        {leadPoints.map(([x, y], i) => (
          <circle
            key={i}
            cx={fmt(x)}
            cy={fmt(y)}
            r={3}
            fill={fill.stroke}
            stroke="var(--color-card)"
            strokeWidth={1.5}
          />
        ))}

        {/* Axis labels — placed slightly outside each vertex */}
        {AXIS_LABELS.map((label, i) => {
          const [x, y] = pointAt(i, RADIUS + 18);
          return (
            <text
              key={label.key}
              x={fmt(x)}
              y={fmt(y)}
              textAnchor="middle"
              dominantBaseline="central"
              className="font-mono text-[9px] fill-muted-foreground"
            >
              {label.short}
            </text>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-3 px-1 text-[10px] text-muted-foreground">
        <LegendDot color="solid" />
        <span>This lead</span>
        <LegendDot color="dashed" />
        <span>ICP target</span>
      </div>
    </div>
  );
}

function LegendDot({ color }: { color: "solid" | "dashed" }) {
  return color === "solid" ? (
    <span className="size-2 rounded-full bg-secondary" />
  ) : (
    <span className="h-px w-3 border-t border-dashed border-muted-foreground" />
  );
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function pointAt(axisIndex: number, distance: number): [number, number] {
  const angle = -Math.PI / 2 + axisIndex * ANGLE_STEP;
  return [
    CENTER + distance * Math.cos(angle),
    CENTER + distance * Math.sin(angle),
  ];
}

function polygonPoints(distance: number): string {
  return AXIS_LABELS.map((_, i) => {
    const [x, y] = pointAt(i, distance);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function axesToPoints(a: RadarAxes): [number, number][] {
  return AXIS_LABELS.map((label, i) => {
    const v = clamp01(a[label.key]);
    return pointAt(i, v * RADIUS);
  });
}

function pointsToString(pts: [number, number][]): string {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Round numeric SVG attribute values to 2 decimals before they hit the
// rendered HTML — Math.cos/sin aren't required to be bit-exact across JS
// engines, so server (Node V8) and client (Chrome V8) can disagree on the
// last ULP and trigger a hydration mismatch.
function fmt(n: number): string {
  return n.toFixed(2);
}
