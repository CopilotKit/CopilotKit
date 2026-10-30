"use client";

import { useMemo } from "react";
import { areaY, barX, barY, cell, defineChart, dot, group, lineY, link, rect, stack, text, type ChartGradient } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { treemap } from "@tanstack/charts/hierarchy/treemap";
import { sankeyDiagram } from "@tanstack/charts/network/sankey";
import { angleGrid, focusGroupAngle, pie, polar, radialArc, radialArea, radialDot, radialGrid } from "@tanstack/charts/polar";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "@tanstack/react-charts";
import { cn } from "@/lib/utils";
import type { RendererMap } from "./types";
import {
  ChartFrame,
  GRID,
  NEGATIVE,
  PALETTE,
  POSITIVE,
  Plot,
  THEME,
  bumpX,
  cleanRows,
  fmtValue,
  isNum,
  linearClosed,
  paletteAt,
  pickRows,
  seriesOf,
  shortLabel,
  smoothCurve,
  tickFormatter,
  type Row,
} from "./chart-kit";

/* ---------------------------------------------------------------- shared */

const SERIES_FALLBACK = "Value";
const seriesName = (r: { series?: string }) => r.series ?? SERIES_FALLBACK;

/** Vertical fade per palette slot, referenced as url(#a2-fade-N). */
const FADES: ChartGradient[] = PALETTE.map((color, i) => ({
  id: `a2-fade-${i}`,
  x1: 0,
  y1: 0,
  x2: 0,
  y2: 1,
  stops: [
    { offset: 0, color, opacity: 0.34 },
    { offset: 0.65, color, opacity: 0.08 },
    { offset: 1, color, opacity: 0 },
  ],
}));

const xTicks = { ticks: { size: 0, padding: 8 }, line: false, tickLabels: { thin: true } } as const;
const valueAxis = (format?: Parameters<typeof tickFormatter>[0], unit?: string) =>
  ({ line: false, ticks: { size: 0, padding: 8, count: 5, format: tickFormatter(format, unit) } }) as const;

/** Muted greys for the other series when one series is highlighted. */
const MUTED = ["oklch(0.47 0.012 285)", "oklch(0.40 0.012 285)", "oklch(0.54 0.012 285)", "oklch(0.36 0.012 285)"];

function useStableSeries(rows: Row[], highlight?: string) {
  return useMemo(() => {
    const names = seriesOf(rows).map((s) => s || SERIES_FALLBACK);
    const on = highlight && names.includes(highlight) ? highlight : null;
    const range = names.map((n, i) => (on ? (n === on ? paletteAt(0) : MUTED[i % MUTED.length]) : paletteAt(i)));
    return { names, color: { domain: names, range }, legend: names.map((label, i) => ({ label, color: range[i] })) };
  }, [rows, highlight]);
}

/** Order x categories by first appearance so string x stays in authored order. */
function xDomain(rows: Row[]) {
  return Array.from(new Set(rows.map((r) => String(r.x))));
}

/* ------------------------------------------------------------ renderers */

export const chartRenderers: RendererMap<
  | "LineChart"
  | "AreaChart"
  | "BarChart"
  | "PieChart"
  | "ScatterChart"
  | "Heatmap"
  | "Sparkline"
  | "RadarChart"
  | "CandlestickChart"
  | "Treemap"
  | "SankeyChart"
  | "Gauge"
> = {
  /* ---------------------------------------------------------- LineChart */
  LineChart: ({ props }) => {
    const rows = useMemo(() => cleanRows(props.data), [props.data]);
    const { names, color, legend } = useStableSeries(rows, typeof props.highlight === "string" ? props.highlight : undefined);
    const { format, unit } = props;
    const definition = useMemo(() => {
      const numericX = rows.length > 0 && rows.every((r) => typeof r.x === "number");
      const single = names.length === 1;
      const nonNegative = rows.every((r) => r.y >= 0);
      const curve = props.curve === false ? undefined : smoothCurve;
      const xOf = (r: Row) => (numericX ? r.x : String(r.x));
      return defineChart({ svgAnimation: true,
        marks: [
          ...(single && nonNegative
            ? [areaY(rows, { x: xOf, y1: 0, y2: "y", fill: "url(#a2-fade-0)", fillOpacity: 1, curve })]
            : []),
          lineY(rows, { x: xOf, y: "y", z: seriesName, color: seriesName, strokeWidth: 2, curve, points: rows.length <= 16 }),
          crosshair({ x: true, y: false }),
        ],
        scales: {
          x: numericX
            ? { scale: scaleLinear, nice: true, axis: xTicks }
            : { scale: () => scalePoint<string>().domain(xDomain(rows)).padding(0.25), axis: xTicks },
          y: { scale: scaleLinear, nice: true, grid: GRID, axis: valueAxis(format, unit) },
        },
        color,
        gradients: FADES,
        theme: THEME,
        focus: single ? "nearest-x" : "group-x",
        maxFocusDistance: Number.POSITIVE_INFINITY,
        tooltip: {
          use: tooltip,
          content: (points) => ({
            title: String(points[0]?.datum.x ?? ""),
            rows: points.map((p) => ({ label: single ? props.title ?? SERIES_FALLBACK : seriesName(p.datum), value: fmtValue(p.datum.y, format, unit), color: p.color })),
          }),
        },
      });
    }, [rows, names, color, format, unit, props.curve, props.title]);
    return (
      <ChartFrame title={props.title} subtitle={props.subtitle} legend={legend} empty={rows.length === 0}>
        <Plot>
          <Chart definition={definition} height={props.height ?? 220} ariaLabel={props.title ?? "Line chart"} />
        </Plot>
      </ChartFrame>
    );
  },

  /* ---------------------------------------------------------- AreaChart */
  AreaChart: ({ props }) => {
    const rows = useMemo(() => cleanRows(props.data), [props.data]);
    const { names, color, legend } = useStableSeries(rows, typeof props.highlight === "string" ? props.highlight : undefined);
    const { format, unit } = props;
    const stacked = props.stacked !== false && names.length > 1;
    const definition = useMemo(() => {
      const numericX = rows.length > 0 && rows.every((r) => typeof r.x === "number");
      const xOf = (r: Row) => (numericX ? r.x : String(r.x));
      const fadeOf = (r: Row) => `url(#a2-fade-${Math.max(0, names.indexOf(seriesName(r))) % PALETTE.length})`;
      return defineChart({ svgAnimation: true,
        marks: stacked
          ? [
              areaY(rows, {
                x: xOf,
                y: "y",
                z: seriesName,
                color: seriesName,
                layout: stack({ order: names }),
                fillOpacity: 0.62,
                stroke: "var(--a2-surface)",
                strokeWidth: 1,
                curve: smoothCurve,
              }),
              crosshair({ x: true, y: false }),
            ]
          : [
              areaY(rows, { x: xOf, y1: 0, y2: "y", z: seriesName, color: seriesName, fill: fadeOf, fillOpacity: 1, curve: smoothCurve }),
              lineY(rows, { x: xOf, y: "y", z: seriesName, color: seriesName, strokeWidth: 1.75, curve: smoothCurve }),
              crosshair({ x: true, y: false }),
            ],
        scales: {
          x: numericX
            ? { scale: scaleLinear, nice: true, axis: xTicks }
            : { scale: () => scalePoint<string>().domain(xDomain(rows)).padding(0.02), axis: xTicks },
          y: { scale: scaleLinear, nice: true, grid: GRID, axis: valueAxis(format, unit) },
        },
        color,
        gradients: FADES,
        theme: THEME,
        clip: true,
        focus: "group-x",
        maxFocusDistance: Number.POSITIVE_INFINITY,
        tooltip: {
          use: tooltip,
          content: (points) => {
            const seen = new Set<string>();
            const uniq = points.filter((p) => {
              const k = seriesName(p.datum);
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });
            const total = uniq.reduce((s, p) => s + p.datum.y, 0);
            return {
              title: String(points[0]?.datum.x ?? ""),
              rows: [
                ...uniq.map((p) => ({ label: seriesName(p.datum), value: fmtValue(p.datum.y, format, unit), color: p.color })),
                ...(stacked ? [{ label: "Total", value: fmtValue(total, format, unit), active: true }] : []),
              ],
            };
          },
        },
      });
    }, [rows, names, color, stacked, format, unit]);
    return (
      <ChartFrame title={props.title} subtitle={props.subtitle} legend={legend} empty={rows.length === 0}>
        <Plot>
          <Chart definition={definition} height={props.height ?? 220} ariaLabel={props.title ?? "Area chart"} />
        </Plot>
      </ChartFrame>
    );
  },

  /* ----------------------------------------------------------- BarChart */
  BarChart: ({ props }) => {
    const rows = useMemo(() => cleanRows(props.data).map((r) => ({ ...r, x: String(r.x) })), [props.data]);
    const { names, color, legend } = useStableSeries(rows, typeof props.highlight === "string" ? props.highlight : undefined);
    const { format, unit } = props;
    const horizontal = !!props.horizontal;
    const multi = names.length > 1;
    const grouped = multi && !props.stacked;
    const cats = useMemo(() => xDomain(rows), [rows]);
    const definition = useMemo(() => {
      const radius = grouped || !multi ? { end: 4 } : { end: 4, stack: "outer" as const };
      const content = (points: readonly { datum: Row & { x: string }; color: string }[]) => ({
        title: points[0]?.datum.x ?? "",
        rows: points.map((p) => ({ label: multi ? seriesName(p.datum) : props.title ?? SERIES_FALLBACK, value: fmtValue(p.datum.y, format, unit), color: p.color })),
      });
      const band = () => scaleBand<string>().domain(cats).padding(multi ? 0.24 : 0.32);
      const shared = { color, theme: THEME, tooltip: { use: tooltip, content } } as const;
      if (horizontal) {
        return { kind: "h" as const, def: defineChart({ svgAnimation: true,
          marks: [
            barX(rows, {
              x: "y",
              y: "x",
              z: seriesName,
              color: seriesName,
              layout: grouped ? group({ padding: 0.12 }) : stack({ order: names }),
              radius,
              maxThickness: 22,
            }),
          ],
          scales: {
            x: { scale: scaleLinear, nice: true, grid: GRID, axis: valueAxis(format, unit) },
            y: { scale: band, axis: { ...xTicks, ticks: { size: 0, padding: 10, format: (v: string) => shortLabel(v, 18) } } },
          },
          focus: multi ? "group-y" : undefined,
          ...shared,
        }) };
      }
      return { kind: "v" as const, def: defineChart({ svgAnimation: true,
        marks: [
          barY(rows, {
            x: "x",
            y: "y",
            z: seriesName,
            color: seriesName,
            layout: grouped ? group({ padding: 0.12 }) : stack({ order: names }),
            radius,
            maxThickness: grouped ? 18 : 40,
          }),
        ],
        scales: {
          x: { scale: band, axis: { ...xTicks, ticks: { size: 0, padding: 8, format: (v: string) => shortLabel(v, 12) } } },
          y: { scale: scaleLinear, nice: true, grid: GRID, axis: valueAxis(format, unit) },
        },
        focus: multi ? "group-x" : undefined,
        ...shared,
      }) };
    }, [rows, names, color, cats, grouped, multi, horizontal, format, unit, props.title]);
    const height = props.height ?? (horizontal ? Math.max(160, cats.length * (multi && grouped ? 40 : 30) + 40) : 230);
    return (
      <ChartFrame title={props.title} subtitle={props.subtitle} legend={legend} empty={rows.length === 0}>
        <Plot>
          {definition.kind === "h" ? (
            <Chart definition={definition.def} height={height} ariaLabel={props.title ?? "Bar chart"} />
          ) : (
            <Chart definition={definition.def} height={height} ariaLabel={props.title ?? "Bar chart"} />
          )}
        </Plot>
      </ChartFrame>
    );
  },

  /* ----------------------------------------------------------- PieChart */
  PieChart: ({ props }) => {
    const rows = useMemo(
      () =>
        pickRows(props.data, (r) =>
          typeof r.label === "string" && isNum(r.value) && r.value >= 0 ? { label: r.label, value: r.value } : null,
        ),
      [props.data],
    );
    const { format, unit } = props;
    const donut = props.donut !== false;
    const total = rows.reduce((s, r) => s + r.value, 0);
    const labels = useMemo(() => rows.map((r) => r.label), [rows]);
    const definition = useMemo(() => {
      const slices = pie(rows, { value: "value", gapAngle: rows.length > 1 ? 0.025 : 0 });
      return defineChart({ svgAnimation: true,
        marks: [
          polar({
            inset: 6,
            marks: [
              radialArc(slices, {
                innerRadius: ({ radius }) => (donut ? radius * 0.64 : 0),
                cornerRadius: donut ? 4 : 2,
                color: "label",
                key: "label",
                states: [{ when: { focus: "unmatched" }, style: { opacity: 0.35 } }],
              }),
            ],
            scales: { angle: null, radius: null },
          }),
        ],
        scales: { x: null, y: null },
        guides: false,
        margin: 0,
        color: { domain: labels, range: labels.map((_, i) => paletteAt(i)) },
        theme: { ...THEME, focusRing: false },
        tooltip: {
          use: tooltip,
          content: (points) => {
            const p = points[0];
            if (!p) return { rows: [] };
            const d = p.datum;
            return {
              title: d.label,
              rows: [
                { label: "Value", value: fmtValue(d.value, format, unit), color: p.color },
                { label: "Share", value: `${(d.fraction * 100).toFixed(1)}%` },
              ],
            };
          },
        },
      });
    }, [rows, labels, donut, format, unit]);
    const size = props.height ?? 200;
    return (
      <ChartFrame title={props.title} subtitle={props.subtitle} empty={rows.length === 0 || total <= 0}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-4">
          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <Chart definition={definition} width={size} height={size} ariaLabel={props.title ?? "Pie chart"} />
            {donut ? (
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div>
                  <div className="text-[20px] font-semibold tabular-nums tracking-tight text-foreground">{fmtValue(total, format === "currency" ? "currency" : format === "percent" ? "percent" : "compact", unit)}</div>
                  <div className="text-[11px] text-muted-foreground">{props.centerLabel ?? "Total"}</div>
                </div>
              </div>
            ) : null}
          </div>
          <ul className="grid min-w-[180px] flex-1 gap-1.5">
            {rows.map((r, i) => (
              <li key={`${r.label}-${i}`} className="flex min-w-0 items-center gap-2 text-[12px]">
                <span className="size-2 shrink-0 rounded-[3px]" style={{ background: paletteAt(i) }} />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.label}</span>
                <span className="tabular-nums text-foreground/90">{fmtValue(r.value, format === "currency" ? "currency" : "compact", format === "currency" ? undefined : unit)}</span>
                <span className="w-11 text-right tabular-nums text-muted-foreground">{((r.value / total) * 100).toFixed(r.value / total < 0.1 ? 1 : 0)}%</span>
              </li>
            ))}
          </ul>
        </div>
      </ChartFrame>
    );
  },

  /* ------------------------------------------------------- ScatterChart */
  ScatterChart: ({ props }) => {
    const rows = useMemo(
      () =>
        pickRows(props.data, (r) =>
          isNum(r.x) && isNum(r.y)
            ? {
                x: r.x,
                y: r.y,
                label: typeof r.label === "string" ? r.label : undefined,
                size: isNum(r.size) && r.size >= 0 ? r.size : undefined,
                series: typeof r.series === "string" && r.series ? r.series : undefined,
              }
            : null,
        ),
      [props.data],
    );
    const { names, color } = useMemo(() => {
      const n = seriesOf(rows).map((s) => s || SERIES_FALLBACK);
      return { names: n, color: { domain: n, range: n.map((_, i) => paletteAt(i)) } };
    }, [rows]);
    const { format, unit } = props;
    const definition = useMemo(() => {
      const maxSize = Math.max(0, ...rows.map((r) => r.size ?? 0));
      const radius = (s: number | undefined) => (s == null || maxSize === 0 ? 5 : 3.5 + Math.sqrt(s / maxSize) * 11);
      return defineChart({ svgAnimation: true,
        marks: [
          dot(rows, {
            x: "x",
            y: "y",
            z: seriesName,
            color: seriesName,
            r: (d) => radius(d.size),
            fillOpacity: 0.55,
            strokeWidth: 1.25,
            states: [
              { when: { focus: "primary" }, style: { fillOpacity: 0.95 } },
              { when: { focus: "unmatched" }, style: { opacity: 0.45 } },
            ],
          }),
        ],
        scales: {
          x: { scale: scaleLinear, nice: true, grid: GRID, axis: { ...xTicks, ticks: { size: 0, padding: 8, format: tickFormatter() }, label: props.xLabel ? { text: props.xLabel, fontSize: 11, fontWeight: 500 } : undefined } },
          y: { scale: scaleLinear, nice: true, grid: GRID, axis: { ...valueAxis(format, unit), label: props.yLabel ? { text: props.yLabel, fontSize: 11, fontWeight: 500 } : undefined } },
        },
        color,
        theme: THEME,
        tooltip: {
          use: tooltip,
          content: (points) => {
            const p = points[0];
            if (!p) return { rows: [] };
            const d = p.datum;
            return {
              title: d.label ?? (names.length > 1 ? seriesName(d) : undefined),
              rows: [
                { label: props.xLabel ?? "x", value: fmtValue(d.x), color: p.color },
                { label: props.yLabel ?? "y", value: fmtValue(d.y, format, unit) },
                ...(d.size != null ? [{ label: "Size", value: fmtValue(d.size, "compact") }] : []),
              ],
            };
          },
        },
      });
    }, [rows, names, color, format, unit, props.xLabel, props.yLabel]);
    return (
      <ChartFrame title={props.title} subtitle={props.subtitle} legend={names} empty={rows.length === 0}>
        <Plot>
          <Chart definition={definition} height={props.height ?? 260} ariaLabel={props.title ?? "Scatter chart"} />
        </Plot>
      </ChartFrame>
    );
  },

  /* ------------------------------------------------------------ Heatmap */
  Heatmap: ({ props }) => {
    const rows = useMemo(
      () => pickRows(props.data, (r) => (typeof r.x === "string" && typeof r.y === "string" && isNum(r.value) ? { x: r.x, y: r.y, value: r.value } : null)),
      [props.data],
    );
    const { format, unit } = props;
    const xs = useMemo(() => Array.from(new Set(rows.map((r) => r.x))), [rows]);
    const ys = useMemo(() => Array.from(new Set(rows.map((r) => r.y))), [rows]);
    const [min, max] = useMemo(() => (rows.length ? [Math.min(...rows.map((r) => r.value)), Math.max(...rows.map((r) => r.value))] : [0, 1]), [rows]);
    const definition = useMemo(() => {
      const span = max - min || 1;
      const shade = (v: unknown) => {
        const t = isNum(v) ? Math.max(0, Math.min(1, (v - min) / span)) : 0;
        const pct = Math.round(4 + Math.pow(t, 0.8) * 96);
        return `color-mix(in oklch, var(--ts-chart-1) ${pct}%, oklch(0.27 0.01 285))`;
      };
      const showText = xs.length * ys.length <= 48 && xs.length <= 12;
      return defineChart({ svgAnimation: true,
        marks: [
          cell(rows, {
            x: "x",
            y: "y",
            color: "value",
            key: (r) => `${r.y}\u0000${r.x}`,
            inset: 1.5,
            radius: 4,
            states: [{ when: { focus: "primary" }, style: { stroke: "oklch(0.97 0 0)", strokeWidth: 1.5 } }],
          }),
          ...(showText
            ? [
                text(rows, {
                  x: "x",
                  y: "y",
                  text: (r) => fmtValue(r.value, format === "currency" ? "compact" : format ?? "compact"),
                  fill: (r) => ((r.value - min) / span > 0.55 ? "oklch(0.18 0.02 292)" : "oklch(0.86 0.01 285)"),
                  fontSize: 10.5,
                  fontWeight: 600,
                }),
              ]
            : []),
        ],
        scales: {
          x: { scale: () => scaleBand<string>().domain(xs).padding(0), axis: { ...xTicks, ticks: { size: 0, padding: 6 } } },
          y: { scale: () => scaleBand<string>().domain(ys).padding(0), axis: { line: false, ticks: { size: 0, padding: 8 } } },
        },
        color: {
          resolver: {
            id: "a2-heat",
            resolve: () => ({ type: "a2-heat", kind: "continuous", domain: [min, max], range: [shade(min), shade(max)], map: shade }),
          },
        },
        theme: { ...THEME, focusRing: false },
        tooltip: {
          use: tooltip,
          content: (points) => {
            const d = points[0]?.datum;
            return d ? { title: `${d.y} · ${d.x}`, rows: [{ label: "Value", value: fmtValue(d.value, format, unit), color: shade(d.value) }] } : { rows: [] };
          },
        },
      });
    }, [rows, xs, ys, min, max, format, unit]);
    const height = props.height ?? Math.min(320, Math.max(150, ys.length * 30 + 36));
    return (
      <ChartFrame
        title={props.title}
        subtitle={props.subtitle}
        empty={rows.length === 0}
        aside={
          rows.length ? (
            <div className="flex items-center gap-2 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
              <span>{fmtValue(min, format === "currency" ? "currency" : "compact", unit)}</span>
              <span className="h-1.5 w-20 rounded-full" style={{ background: "linear-gradient(90deg, color-mix(in oklch, var(--ts-chart-1) 6%, oklch(0.24 0.008 285)), var(--ts-chart-1))" }} />
              <span>{fmtValue(max, format === "currency" ? "currency" : "compact", unit)}</span>
            </div>
          ) : null
        }
      >
        <Plot>
          <Chart definition={definition} height={height} ariaLabel={props.title ?? "Heatmap"} />
        </Plot>
      </ChartFrame>
    );
  },

  /* ---------------------------------------------------------- Sparkline */
  Sparkline: ({ props }) => {
    const values = useMemo(() => (Array.isArray(props.values) ? props.values.filter(isNum) : []), [props.values]);
    const rows = useMemo(() => values.map((v, i) => ({ i, v })), [values]);
    const first = values[0];
    const last = values[values.length - 1];
    const tone = props.tone ?? (values.length > 1 ? (last >= first ? "positive" : "negative") : "default");
    const stroke = tone === "positive" ? POSITIVE : tone === "negative" ? NEGATIVE : "var(--ts-chart-1)";
    const definition = useMemo(
      () =>
        defineChart({ svgAnimation: true,
          marks: [
            areaY(rows, { x: "i", y1: (r) => Math.min(...values), y2: "v", fill: "url(#a2-spark)", fillOpacity: 1, curve: smoothCurve }),
            lineY(rows, { x: "i", y: "v", stroke, strokeWidth: 1.75, curve: smoothCurve }),
            dot(rows.slice(-1), { x: "i", y: "v", r: 2.75, fill: stroke, stroke: "var(--a2-surface)", strokeWidth: 1.5 }),
          ],
          scales: {
            x: { scale: scaleLinear, axis: false },
            y: { scale: scaleLinear, axis: false },
          },
          gradients: [
            {
              id: "a2-spark",
              x1: 0,
              y1: 0,
              x2: 0,
              y2: 1,
              stops: [
                { offset: 0, color: stroke, opacity: 0.3 },
                { offset: 1, color: stroke, opacity: 0 },
              ],
            },
          ],
          margin: { top: 4, right: 4, bottom: 2, left: 2 },
          theme: { ...THEME, focusRing: { radius: 3.5, fill: stroke, strokeWidth: 0 } },
          focus: "nearest-x",
          maxFocusDistance: Number.POSITIVE_INFINITY,
          tooltip: { use: tooltip, content: (points) => ({ rows: points.slice(0, 1).map((p) => ({ label: props.label ?? "Value", value: fmtValue(p.datum.v), color: stroke })) }) },
        }),
      [rows, values, stroke, props.label],
    );
    const deltaTone = tone === "positive" ? "text-[var(--a2-positive)] bg-[color-mix(in_oklch,var(--a2-positive)_14%,transparent)]" : tone === "negative" ? "text-[var(--a2-negative)] bg-[color-mix(in_oklch,var(--a2-negative)_14%,transparent)]" : "text-muted-foreground bg-white/5";
    return (
      <div className="a2-card a2-chart a2-enter flex w-full min-w-0 items-center gap-4 px-4 py-3">
        <div className="min-w-0 shrink-0">
          {props.label ? <div className="truncate text-[11.5px] text-muted-foreground">{props.label}</div> : null}
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-[18px] font-semibold tabular-nums tracking-tight text-foreground">{props.value ?? (isNum(last) ? fmtValue(last, "compact") : "")}</span>
            {props.delta ? <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums", deltaTone)}>{props.delta}</span> : null}
          </div>
        </div>
        <div className="h-11 min-w-0 flex-1">
          {values.length > 1 ? <Chart definition={definition} height={44} ariaLabel={props.label ?? "Sparkline"} /> : <div className="a2-shimmer mt-5 h-1 rounded-full" />}
        </div>
      </div>
    );
  },

  /* --------------------------------------------------------- RadarChart */
  RadarChart: ({ props }) => {
    const rows = useMemo(
      () =>
        pickRows(props.data, (r) =>
          typeof r.axis === "string" && isNum(r.value) ? { axis: r.axis, value: r.value, series: typeof r.series === "string" && r.series ? r.series : undefined } : null,
        ),
      [props.data],
    );
    const { format, unit } = props;
    const axes = useMemo(() => Array.from(new Set(rows.map((r) => r.axis))), [rows]);
    const names = useMemo(() => seriesOf(rows).map((s) => s || SERIES_FALLBACK), [rows]);
    const max = props.max && props.max > 0 ? props.max : Math.max(1, ...rows.map((r) => r.value));
    const definition = useMemo(() => {
      const color = { domain: names, range: names.map((_, i) => paletteAt(i)) };
      return defineChart({ svgAnimation: true,
        marks: [
          polar({
            radiusRatio: 0.78,
            scales: {
              angle: { scale: scalePoint<string>().domain(axes), wrap: true },
              radius: { scale: scaleLinear().domain([0, max]) },
            },
            guides: [
              radialGrid({ values: [0.25, 0.5, 0.75, 1].map((f) => f * max), shape: "polygon", stroke: "oklch(1 0 0)", strokeOpacity: 0.08 }),
              angleGrid({ stroke: "oklch(1 0 0)", strokeOpacity: 0.07, labelOffset: 12, format: (v) => shortLabel(v, 16) }),
            ],
            marks: [
              radialArea(rows, { angle: "axis", radius: "value", z: seriesName, color: seriesName, curve: linearClosed, fill: (r) => paletteAt(names.indexOf(seriesName(r))), fillOpacity: 0.2, stroke: (r) => paletteAt(names.indexOf(seriesName(r))), strokeWidth: 1.75 }),
              radialDot(rows, { angle: "axis", radius: "value", z: seriesName, color: seriesName, r: 2.75 }),
            ],
          }),
        ],
        scales: { x: null, y: null },
        guides: false,
        margin: { top: 4, bottom: 4 },
        color,
        theme: THEME,
        focus: focusGroupAngle,
        tooltip: {
          use: tooltip,
          content: (points) => ({
            title: points[0]?.datum.axis,
            rows: points.map((p) => ({ label: seriesName(p.datum), value: fmtValue(p.datum.value, format, unit), color: p.color })),
          }),
        },
      });
    }, [rows, axes, names, max, format, unit]);
    return (
      <ChartFrame title={props.title} subtitle={props.subtitle} legend={names} empty={rows.length === 0 || axes.length < 3}>
        <Plot>
          <Chart definition={definition} height={props.height ?? 280} ariaLabel={props.title ?? "Radar chart"} />
        </Plot>
      </ChartFrame>
    );
  },

  /* --------------------------------------------------- CandlestickChart */
  CandlestickChart: ({ props }) => {
    const rows = useMemo(
      () =>
        pickRows(props.data, (r) =>
          typeof r.date === "string" && isNum(r.open) && isNum(r.high) && isNum(r.low) && isNum(r.close)
            ? { date: r.date, open: r.open, high: Math.max(r.high, r.open, r.close), low: Math.min(r.low, r.open, r.close), close: r.close, dir: r.close >= r.open ? "Up" : "Down" }
            : null,
        ),
      [props.data],
    );
    const { format, unit } = props;
    const dates = useMemo(() => rows.map((r) => r.date), [rows]);
    const definition = useMemo(() => {
      // Keep doji candles visible: a body never collapses below ~0.6% of the price range.
      const minBody = (Math.max(...rows.map((r) => r.high)) - Math.min(...rows.map((r) => r.low)) || 1) * 0.006;
      return defineChart({ svgAnimation: true,
          marks: [
            link(rows, { x1: "date", x2: "date", y1: "low", y2: "high", stroke: (r) => (r.dir === "Up" ? POSITIVE : NEGATIVE), strokeWidth: 1.25 }),
            rect(rows, { x: "date", y1: "open", y2: (r) => (Math.abs(r.close - r.open) < minBody ? r.open + (r.dir === "Up" ? minBody : -minBody) : r.close), color: "dir", inset: 0, radius: 1.5 }),
          ],
          scales: {
            x: { scale: () => scaleBand<string>().domain(dates).padding(0.36), axis: { ...xTicks, ticks: { size: 0, padding: 8, format: (v: string) => shortLabel(v, 8) } } },
            y: { scale: scaleLinear, nice: true, grid: GRID, axis: valueAxis(format, unit) },
          },
          color: { domain: ["Up", "Down"], range: [POSITIVE, NEGATIVE] },
          theme: { ...THEME, focusRing: false },
          focus: "nearest-x",
          maxFocusDistance: Number.POSITIVE_INFINITY,
          tooltip: {
            use: tooltip,
            content: (points) => {
              const d = points.find((p) => p.markId)?.datum;
              if (!d) return { rows: [] };
              const chg = d.open ? ((d.close - d.open) / d.open) * 100 : 0;
              const c = d.dir === "Up" ? POSITIVE : NEGATIVE;
              return {
                title: d.date,
                rows: [
                  { label: "Open", value: fmtValue(d.open, format, unit) },
                  { label: "High", value: fmtValue(d.high, format, unit) },
                  { label: "Low", value: fmtValue(d.low, format, unit) },
                  { label: "Close", value: fmtValue(d.close, format, unit), color: c },
                  { label: "Change", value: `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`, color: c, active: true },
                ],
              };
            },
          },
        });
    }, [rows, dates, format, unit]);
    const last = rows[rows.length - 1];
    const firstOpen = rows[0]?.open;
    const change = last && firstOpen ? ((last.close - firstOpen) / firstOpen) * 100 : 0;
    return (
      <ChartFrame
        title={props.title}
        subtitle={props.subtitle}
        empty={rows.length === 0}
        aside={
          last ? (
            <div className="text-right">
              <div className="text-[15px] font-semibold tabular-nums tracking-tight text-foreground">{fmtValue(last.close, format, unit)}</div>
              <div className="text-[11px] font-medium tabular-nums" style={{ color: change >= 0 ? POSITIVE : NEGATIVE }}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)}% over period
              </div>
            </div>
          ) : null
        }
      >
        <Plot>
          <Chart definition={definition} height={props.height ?? 240} ariaLabel={props.title ?? "Candlestick chart"} />
        </Plot>
      </ChartFrame>
    );
  },

  /* ------------------------------------------------------------ Treemap */
  Treemap: ({ props }) => {
    const { format, unit } = props;
    const { leaves, groups } = useMemo(() => {
      const clean = (s: string) => s.replace(/\|/g, "/").trim() || "Other";
      const byPath = new Map<string, { name: string; group: string; value: number }>();
      for (const r of pickRows(props.data, (r) =>
        typeof r.name === "string" && isNum(r.value) && r.value > 0 ? { name: clean(r.name), value: r.value, group: typeof r.group === "string" && r.group ? clean(r.group) : "" } : null,
      )) {
        const k = `${r.group}|${r.name}`;
        const prev = byPath.get(k);
        byPath.set(k, prev ? { ...prev, value: prev.value + r.value } : r);
      }
      const list = Array.from(byPath.values()).map((r) => ({ ...r, path: r.group ? `root|g:${r.group}|${r.name}` : `root|${r.name}` }));
      return { leaves: list, groups: Array.from(new Set(list.map((r) => r.group || r.name))) };
    }, [props.data]);
    const total = leaves.reduce((s, r) => s + r.value, 0);
    const definition = useMemo(() => {
      const keyOf = (d: { group: string; name: string } | null) => (d ? d.group || d.name : "");
      return defineChart({ svgAnimation: true,
        marks: [
          treemap(leaves, {
            path: "path",
            delimiter: "|",
            value: "value",
            sort: (a, b) => b.value - a.value,
            // d3 lays children out over their parent's box widened by half the
            // inner padding, then shrinks each one back. A cell thinner than
            // the padding collapses to its midpoint, which lands outside the
            // chart when the cell sits on its edge, and the mark throws on
            // that (narrow screens). The same half gap as outer padding keeps
            // every cell inside the box at any width.
            paddingInner: 3,
            paddingOuter: 1.5,
            color: (n) => keyOf(n.data),
            fillOpacity: 0.88,
            inset: 0,
            radius: 6,
            label: (n) => n.data?.name,
            labelFill: "oklch(0.17 0.02 285)",
            labelFontSize: 11.5,
            labelFontWeight: 600,
            labelPadding: 6,
            states: [{ when: { focus: "primary" }, style: { fillOpacity: 1, stroke: "oklch(0.98 0 0)", strokeWidth: 1.5 } }],
          }),
        ],
        scales: { x: null, y: null },
        guides: false,
        margin: 0,
        color: { domain: groups, range: groups.map((_, i) => paletteAt(i)) },
        theme: { ...THEME, focusRing: false },
        tooltip: {
          use: tooltip,
          content: (points) => {
            const p = points[0];
            const d = p?.datum.data;
            if (!p || !d) return { rows: [] };
            return {
              title: d.name,
              rows: [
                ...(d.group ? [{ label: "Group", value: d.group, color: p.color }] : []),
                { label: "Value", value: fmtValue(d.value, format, unit), color: d.group ? undefined : p.color },
                { label: "Share", value: `${((d.value / (total || 1)) * 100).toFixed(1)}%` },
              ],
            };
          },
        },
      });
    }, [leaves, groups, total, format, unit]);
    const hasGroups = leaves.some((l) => l.group);
    return (
      <ChartFrame title={props.title} subtitle={props.subtitle} legend={hasGroups ? groups : undefined} empty={leaves.length === 0}>
        <Plot>
          <Chart definition={definition} height={props.height ?? 260} ariaLabel={props.title ?? "Treemap"} />
        </Plot>
      </ChartFrame>
    );
  },

  /* -------------------------------------------------------- SankeyChart */
  SankeyChart: ({ props }) => {
    const { format, unit } = props;
    const graph = useMemo(() => {
      const raw = pickRows(props.links, (r) =>
        typeof r.source === "string" && typeof r.target === "string" && r.source !== r.target && isNum(r.value) && r.value > 0
          ? { source: r.source, target: r.target, value: r.value }
          : null,
      );
      // Merge parallel links and drop any edge that would close a cycle (the layout rejects cycles).
      const merged = new Map<string, { source: string; target: string; value: number }>();
      for (const l of raw) {
        const k = `${l.source}\u0000${l.target}`;
        const prev = merged.get(k);
        merged.set(k, prev ? { ...prev, value: prev.value + l.value } : l);
      }
      const out = new Map<string, string[]>();
      const reaches = (from: string, to: string) => {
        const seen = new Set<string>();
        const stack = [from];
        while (stack.length) {
          const n = stack.pop() as string;
          if (n === to) return true;
          if (seen.has(n)) continue;
          seen.add(n);
          stack.push(...(out.get(n) ?? []));
        }
        return false;
      };
      const links: { source: string; target: string; value: number }[] = [];
      for (const l of merged.values()) {
        if (reaches(l.target, l.source)) continue;
        out.set(l.source, [...(out.get(l.source) ?? []), l.target]);
        links.push(l);
      }
      const ids: string[] = [];
      for (const l of links) for (const id of [l.source, l.target]) if (!ids.includes(id)) ids.push(id);
      return { links, nodes: ids.map((id) => ({ id })) };
    }, [props.links]);
    const definition = useMemo(() => {
      const colorOf = (id: string) => paletteAt(Math.max(0, graph.nodes.findIndex((n) => n.id === id)));
      return defineChart({ svgAnimation: true,
        marks: [
          sankeyDiagram({
            nodes: graph.nodes,
            links: graph.links,
            nodeKey: "id",
            source: "source",
            target: "target",
            value: "value",
            nodeWidth: 10,
            nodePadding: ({ height }) => Math.max(10, height * 0.05),
            inset: { top: 6, bottom: 6, left: 2, right: 2 },
            marks: ({ nodes, links, chart }) => {
              const right = chart.x + chart.width;
              const lastLayer = Math.max(0, ...nodes.map((n) => n.layer));
              const flip = (n: (typeof nodes)[number]) => n.layer === lastLayer && n.layer > 0;
              return [
                link(links, {
                  x1: "x1",
                  y1: "y1",
                  x2: "x2",
                  y2: "y2",
                  key: "key",
                  curve: bumpX,
                  stroke: (l) => colorOf(String(l.sourceKey)),
                  strokeOpacity: 0.28,
                  strokeWidth: (l) => Math.max(1, l.width),
                  lineCap: "butt",
                }),
                rect(nodes, { x1: "x0", x2: "x1", y1: "y0", y2: "y1", key: "key", color: (n) => String(n.key), inset: 0, radius: 2.5 }),
                text(nodes, {
                  x: (n) => (flip(n) ? Math.min(n.x0, right) - 7 : n.x1 + 7),
                  y: "y",
                  text: (n) => `${shortLabel(n.data.id, 22)}  ${fmtValue(n.value, format === "currency" ? "currency" : "compact", format === "currency" ? undefined : unit)}`,
                  key: "key",
                  anchor: (n) => (flip(n) ? "end" : "start"),
                  fill: "oklch(0.86 0.008 285)",
                  fontSize: 11,
                  fontWeight: 550,
                }),
              ] as const;
            },
          }),
        ],
        scales: { x: null, y: null },
        guides: false,
        margin: { top: 0, bottom: 0, left: 0, right: 0 },
        color: { domain: graph.nodes.map((n) => n.id), range: graph.nodes.map((n) => colorOf(n.id)) },
        theme: { ...THEME, focusRing: false },
        tooltip: {
          use: tooltip,
          format: (p) => {
            const d: unknown = p.datum;
            if (d && typeof d === "object" && "kind" in d && "value" in d && isNum(d.value)) {
              if (d.kind === "link" && "sourceKey" in d && "targetKey" in d) return `${String(d.sourceKey)} → ${String(d.targetKey)}: ${fmtValue(d.value, format, unit)}`;
              if (d.kind === "node" && "key" in d) return `${String(d.key)}: ${fmtValue(d.value, format, unit)}`;
            }
            return "";
          },
        },
      });
    }, [graph, format, unit]);
    return (
      <ChartFrame title={props.title} subtitle={props.subtitle} empty={graph.links.length === 0}>
        <Plot>
          <Chart definition={definition} height={props.height ?? 280} ariaLabel={props.title ?? "Sankey chart"} />
        </Plot>
      </ChartFrame>
    );
  },

  /* -------------------------------------------------------------- Gauge */
  Gauge: ({ props }) => {
    const min = isNum(props.min) ? props.min : 0;
    const maxRaw = isNum(props.max) ? props.max : props.format === "percent" ? 100 : 100;
    const max = maxRaw > min ? maxRaw : min + 1;
    const value = isNum(props.value) ? props.value : min;
    const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const tone = t >= 0.9 ? NEGATIVE : "var(--ts-chart-1)";
    const definition = useMemo(() => {
      const parts = [
        { id: "value", amount: t },
        { id: "rest", amount: 1 - t },
      ];
      const slices = pie(parts, { value: "amount", startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
      const track = pie([{ id: "track", amount: 1 }], { value: "amount", startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
      return defineChart({ svgAnimation: true,
        marks: [
          polar({
            radiusRatio: 1,
            inset: 2,
            marks: [
              radialArc(track, { innerRadius: ({ radius }) => radius * 0.78, cornerRadius: 999, fill: "oklch(1 0 0 / 7%)", key: "id" }),
              radialArc(
                slices.filter((s) => s.id === "value" && s.amount > 0),
                { innerRadius: ({ radius }) => radius * 0.78, cornerRadius: 999, fill: tone, key: "id" },
              ),
            ],
            scales: { angle: null, radius: null },
          }),
        ],
        scales: { x: null, y: null },
        guides: false,
        margin: 0,
        theme: { ...THEME, focusRing: false },
        pointer: false,
        keyboard: false,
      });
    }, [t, tone]);
    const fmt = props.format ?? "number";
    return (
      <div className="a2-card a2-chart a2-enter flex w-full min-w-0 flex-col items-center px-4 pb-3 pt-3.5">
        {props.title ? <div className="w-full truncate text-[13.5px] font-semibold tracking-tight text-foreground">{props.title}</div> : null}
        <div className="relative mt-2 w-full max-w-[240px] overflow-hidden" style={{ height: 124 }}>
          <div className="absolute inset-x-0 top-0" style={{ height: 240 }}>
            <Chart definition={definition} height={240} ariaLabel={props.title ?? "Gauge"} />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 text-center">
            <div className="text-[26px] font-semibold leading-none tabular-nums tracking-tight text-foreground">{fmtValue(value, fmt)}</div>
            {props.label ? <div className="mt-1.5 text-[11.5px] text-muted-foreground">{props.label}</div> : null}
          </div>
        </div>
        <div className="mt-1 flex w-full max-w-[240px] justify-between text-[10.5px] tabular-nums text-muted-foreground">
          <span>{fmtValue(min, fmt === "currency" ? "currency" : "compact")}</span>
          <span>{fmtValue(max, fmt === "currency" ? "currency" : "compact")}</span>
        </div>
      </div>
    );
  },
};
