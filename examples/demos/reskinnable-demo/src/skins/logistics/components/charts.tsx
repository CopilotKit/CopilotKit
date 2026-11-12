"use client";

import type { Lane, Shipment } from "../data/types";
import { cn } from "@/lib/utils";

const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const Empty = ({ children }: { children: string }) => (
  <p className="text-sm text-ink-muted">{children}</p>
);

/** A single labelled horizontal bar: label · fill · trailing figure. */
function Bar({
  label,
  figure,
  pct,
  soft,
}: {
  label: string;
  figure: string;
  pct: number;
  soft?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate text-ink">{label}</span>
        <span className="flex-none tabular-nums text-ink-muted">{figure}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-brand-soft">
        <div
          className={cn(
            "h-full rounded-full",
            soft ? "bg-brand-soft" : "bg-brand",
          )}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}

/** Horizontal bars of on-time reliability per lane, worst reliability last. */
export function LanePerformanceChart({
  lanes,
}: {
  shipments: Shipment[];
  lanes: Lane[];
}) {
  if (!lanes.length) return <Empty>No lanes to chart.</Empty>;
  const rows = [...lanes].sort((a, b) => b.reliability - a.reliability);
  return (
    <div className="space-y-2.5">
      {rows.map((l) => (
        <Bar
          key={l.id}
          label={`${l.origin} → ${l.destination}`}
          figure={`${Math.round(l.reliability * 100)}%`}
          pct={l.reliability * 100}
        />
      ))}
    </div>
  );
}

/** Horizontal bars of summed at-risk shipment value, grouped by lane. */
export function ExposureByLaneChart({
  shipments,
  lanes,
}: {
  shipments: Shipment[];
  lanes: Lane[];
}) {
  const laneById = new Map(lanes.map((l) => [l.id, l]));
  const byLane = new Map<string, number>();
  for (const s of shipments) {
    if (s.status !== "at_risk" && s.status !== "delayed") continue;
    byLane.set(s.laneId, (byLane.get(s.laneId) ?? 0) + s.valueUsd);
  }
  const rows = [...byLane.entries()]
    .map(([laneId, value]) => {
      const lane = laneById.get(laneId);
      return {
        laneId,
        label: lane ? `${lane.origin} → ${lane.destination}` : laneId,
        value,
      };
    })
    .sort((a, b) => b.value - a.value);

  if (!rows.length) return <Empty>No at-risk exposure to chart.</Empty>;
  const max = rows[0].value || 1;
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <Bar
          key={r.laneId}
          label={r.label}
          figure={fmtUsd(r.value)}
          pct={(r.value / max) * 100}
        />
      ))}
    </div>
  );
}

/** A polyline of per-shipment delay (days) ordered by planned ETA. */
export function DelayTrendChart({
  shipments,
}: {
  shipments: Shipment[];
  lanes: Lane[];
}) {
  const points = [...shipments]
    .sort((a, b) => a.etaPlanned.localeCompare(b.etaPlanned))
    .map((s) => {
      const ms =
        Date.parse(`${s.etaCurrent}T00:00:00Z`) -
        Date.parse(`${s.etaPlanned}T00:00:00Z`);
      return Math.max(0, Math.round(ms / 86_400_000));
    });

  if (points.length < 2)
    return <Empty>Not enough shipments to chart a trend.</Empty>;

  const w = 100;
  const h = 40;
  const maxDelay = Math.max(1, ...points);
  const coords = points.map((d, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - (d / maxDelay) * h;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-24 w-full text-brand"
        role="img"
        aria-label="Delay days per shipment, ordered by planned ETA"
      >
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-xs text-ink-muted tabular-nums">
        <span>peak {maxDelay}d</span>
        <span>{points.length} shipments</span>
      </div>
    </div>
  );
}

/** A stacked proportional bar of shipment count by lane transport mode. */
export function ModeSplitChart({
  shipments,
  lanes,
}: {
  shipments: Shipment[];
  lanes: Lane[];
}) {
  const modeByLane = new Map(lanes.map((l) => [l.id, l.mode]));
  const counts = new Map<string, number>();
  for (const s of shipments) {
    const mode = modeByLane.get(s.laneId);
    if (!mode) continue;
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, n]) => sum + n, 0);

  if (!total) return <Empty>No shipments to split by mode.</Empty>;

  return (
    <div className="space-y-2">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-brand-soft"
        role="img"
        aria-label="Shipment share by mode"
      >
        {rows.map(([mode, n], i) => (
          <div
            key={mode}
            className={cn("h-full", i % 2 === 0 ? "bg-brand" : "bg-brand-soft")}
            style={{ width: `${(n / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {rows.map(([mode, n], i) => (
          <li key={mode} className="flex items-center gap-1.5 text-ink-muted">
            <span
              aria-hidden
              className={cn(
                "h-2 w-2 flex-none rounded-full",
                i % 2 === 0 ? "bg-brand" : "bg-brand-soft",
              )}
            />
            <span className="capitalize text-ink">{mode}</span>
            <span className="tabular-nums">
              {Math.round((n / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
