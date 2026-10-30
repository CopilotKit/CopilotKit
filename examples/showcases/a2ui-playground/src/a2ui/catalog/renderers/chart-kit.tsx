"use client";

import { Component, type CSSProperties, type ReactNode } from "react";
import type { ChartCurve, ChartTheme } from "@tanstack/charts";
import type { RadialAreaOptions } from "@tanstack/charts/polar";
import { cn } from "@/lib/utils";
import { formatNumber, type NumberFormat } from "./format";

/* ------------------------------------------------------------------ data */

export type Row = { x: string | number; y: number; series?: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isKey = (v: unknown): v is string | number => typeof v === "string" || isNum(v);

/** Long-format cartesian rows. Drops anything partial or malformed (streaming-safe). */
export function cleanRows(data: unknown): Row[] {
  if (!Array.isArray(data)) return [];
  const out: Row[] = [];
  for (const r of data) {
    if (!isObj(r) || !isNum(r.y) || !isKey(r.x)) continue;
    out.push({ x: r.x, y: r.y, series: typeof r.series === "string" && r.series ? r.series : undefined });
  }
  return out;
}

/** Generic row filter: keeps objects whose listed fields pass the given guards. */
export function pickRows<T>(data: unknown, guard: (r: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(data)) return [];
  const out: T[] = [];
  for (const r of data) {
    if (!isObj(r)) continue;
    const v = guard(r);
    if (v) out.push(v);
  }
  return out;
}

export function seriesOf(rows: { series?: string }[]) {
  return Array.from(new Set(rows.map((r) => r.series ?? "")));
}

/* ----------------------------------------------------------- formatting */

/** Full-precision value for tooltips, centers and labels. */
export function fmtValue(v: unknown, format?: NumberFormat, unit?: string) {
  return formatNumber(v, format ?? "number", unit);
}

/** Compact axis ticks: $1.2K, 34%, 1.4M ms. */
export function tickFormatter(format?: NumberFormat, unit?: string) {
  return (v: number) => {
    if (format === "currency") return `${v < 0 ? "-" : ""}$${formatNumber(Math.abs(v), "compact")}`;
    if (format === "percent") return formatNumber(v, "percent");
    return formatNumber(v, Math.abs(v) >= 1000 ? "compact" : "number", unit);
  };
}

export const shortLabel = (v: unknown, max = 14) => {
  const s = String(v ?? "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/* --------------------------------------------------------------- theme */

export const PALETTE = [
  "var(--ts-chart-1)",
  "var(--ts-chart-2)",
  "var(--ts-chart-3)",
  "var(--ts-chart-4)",
  "var(--ts-chart-5)",
  "var(--ts-chart-6)",
];
export const paletteAt = (i: number) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];

export const POSITIVE = "var(--a2-positive)";
export const NEGATIVE = "var(--a2-negative)";

/** Scene theme shared by every chart: muted axis text, hairline grid, the a2 palette. */
export const THEME: Partial<ChartTheme> = {
  foreground: "oklch(0.93 0.004 285)",
  muted: "oklch(0.6 0.012 285)",
  grid: "oklch(1 0 0 / 6.5%)",
  background: "transparent",
  palette: PALETTE,
  focusRing: { radius: 4.5, fill: "var(--a2-surface)", strokeWidth: 2 },
};

export const GRID = { stroke: "oklch(1 0 0 / 6.5%)", strokeDasharray: "2 4" } as const;

/** Tooltip chrome, read by the built-in tooltip from the chart container. */
const TOOLTIP_VARS = {
  "--ts-chart-tooltip-background": "oklch(0.2 0.006 285 / 0.94)",
  "--ts-chart-tooltip-color": "oklch(0.95 0.004 285)",
  "--ts-chart-tooltip-border": "1px solid oklch(1 0 0 / 10%)",
  "--ts-chart-tooltip-border-radius": "10px",
  "--ts-chart-tooltip-shadow": "0 12px 32px oklch(0 0 0 / 45%)",
  "--ts-chart-tooltip-padding": "8px 10px",
  "--ts-chart-tooltip-font": "500 11.5px/1.45 var(--font-sans)",
  "--ts-chart-tooltip-max-width": "240px",
} as CSSProperties;

/* -------------------------------------------------------------- curves */

type Pt = readonly (readonly [number, number])[];

/** Monotone cubic (Fritsch-Carlson) through x-sorted points: smooth without overshoot. */
function monotonePath(points: Pt, move = true) {
  const n = points.length;
  if (n === 0) return "";
  const [x0, y0] = points[0];
  let d = move ? `M${x0},${y0}` : `L${x0},${y0}`;
  if (n === 1) return d;
  if (n === 2) return `${d}L${points[1][0]},${points[1][1]}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = points[i + 1][0] - points[i][0];
    dx.push(h);
    m.push(h === 0 ? 0 : (points[i + 1][1] - points[i][1]) / h);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    const [xa, ya] = points[i];
    const [xb, yb] = points[i + 1];
    const h = dx[i] / 3;
    d += `C${xa + h},${ya + t[i] * h} ${xb - h},${yb - t[i + 1] * h} ${xb},${yb}`;
  }
  return d;
}

export const smoothCurve: ChartCurve = {
  line: (points) => monotonePath(points),
  area: (top, bottom) => {
    if (top.length === 0) return "";
    const back = [...bottom].reverse();
    return `${monotonePath(top)}${monotonePath(back, false)}Z`;
  },
};

/** Horizontal S-curve between two endpoints: Sankey ribbons. */
export const bumpX: ChartCurve = {
  line: (points) => {
    if (points.length < 2) return "";
    const [x1, y1] = points[0];
    const [x2, y2] = points[points.length - 1];
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1}C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  },
  area: (top, bottom) => `${bumpX.line(top)}L${bottom[bottom.length - 1]?.join(",") ?? ""}Z`,
};

/** Closed straight polygon for radar shapes (the d3 curveLinearClosed contract, no extra dependency). */
export const linearClosed: NonNullable<RadialAreaOptions<unknown>["curve"]> = (context) => {
  let started = false;
  return {
    areaStart() {},
    areaEnd() {},
    lineStart() {
      started = false;
    },
    lineEnd() {
      if (started) context.closePath();
    },
    point(x: number, y: number) {
      if (started) context.lineTo(x, y);
      else {
        started = true;
        context.moveTo(x, y);
      }
    },
  };
};

/* ------------------------------------------------------------ frame UI */

export type LegendItem = string | { label: string; color?: string; value?: string };

export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {items.map((it, i) => {
        const item = typeof it === "string" ? { label: it } : it;
        return (
          <span key={`${item.label}-${i}`} className="inline-flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <span className="size-2 shrink-0 rounded-[3px]" style={{ background: item.color ?? paletteAt(i) }} />
            <span className="truncate">{item.label}</span>
            {item.value ? <span className="tabular-nums text-foreground/85">{item.value}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

export function ChartFrame({
  title,
  subtitle,
  legend,
  aside,
  footer,
  children,
  className,
  empty,
}: {
  title?: string;
  subtitle?: string;
  legend?: LegendItem[];
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  empty?: boolean;
}) {
  const showLegend = !!legend && legend.length > 1;
  return (
    <figure
      className={cn("a2-card a2-chart a2-enter relative flex w-full min-w-0 max-w-full flex-col gap-3 overflow-hidden px-4 pb-3 pt-3.5", className)}
      style={TOOLTIP_VARS}
    >
      {(title || subtitle || showLegend || aside) && (
        <figcaption className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
          <div className="min-w-0">
            {title ? <div className="truncate text-[13.5px] font-semibold tracking-tight text-foreground">{title}</div> : null}
            {subtitle ? <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{subtitle}</div> : null}
          </div>
          {aside ?? (showLegend ? <Legend items={legend} className="pt-0.5" /> : null)}
        </figcaption>
      )}
      {empty ? <EmptyState /> : <ChartBoundary>{children}</ChartBoundary>}
      {footer && !empty ? footer : null}
    </figure>
  );
}

export function EmptyState({ label = "No data yet" }: { label?: string }) {
  return (
    <div className="a2-well grid h-36 place-items-center rounded-[10px] text-[12px] text-muted-foreground">
      <div className="flex items-center gap-2">
        <span className="a2-shimmer h-1.5 w-10 rounded-full" />
        {label}
      </div>
    </div>
  );
}

/** Layout marks (Sankey, treemap) validate input during render; partial streams must never crash the surface. */
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {}
  componentDidUpdate(prev: { children: ReactNode }) {
    // New props (more streamed data) get a fresh attempt.
    if (this.state.failed && prev.children !== this.props.children) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <EmptyState label="Waiting for complete data" /> : this.props.children;
  }
}

/** Width-safe wrapper for a TanStack <Chart>. */
export function Plot({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("relative w-full min-w-0 [&_.ts-chart-host]:!max-w-full", className)}>{children}</div>;
}
