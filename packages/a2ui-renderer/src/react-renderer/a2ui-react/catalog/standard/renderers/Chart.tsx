import React, { Suspense } from "react";
import type { RendererProps } from "../../../../create-catalog";
import type { ChartSeries } from "../definitions/data";
import {
  FONT_WEIGHT,
  borderColor,
  textColor,
  textFont,
  CHART_CURSOR,
  CHART_PALETTE,
  SHADOW_MD,
} from "../tokens";

import type * as Recharts from "recharts";

type RechartsModule = typeof Recharts;

// Series colours come from the shared tokens (`--a2ui-chart-N`).

/** Legend labels in ink, not in the series colour. */
const legendFormatter = (value: string) => (
  <span style={{ color: textColor("default"), fontSize: 13 }}>{value}</span>
);
const LEGEND_PROPS = {
  iconType: "circle" as const,
  iconSize: 8,
  formatter: legendFormatter,
  wrapperStyle: { paddingTop: 8 },
};
const TOOLTIP_STYLE = {
  contentStyle: {
    borderRadius: 10,
    border: `1px solid ${borderColor("subtle")}`,
    boxShadow: SHADOW_MD,
    fontSize: 13,
  },
  cursor: { fill: CHART_CURSOR },
};

export interface ChartProps {
  chartType?: "bar" | "line" | "area" | "scatter" | "pie" | "donut";
  data?: Record<string, unknown>[];
  xKey?: string;
  series?: ChartSeries[];
  stacked?: boolean;
  height?: number;
  showLegend?: boolean;
  showGrid?: boolean;
  showTooltip?: boolean;
  showValueLabels?: boolean;
  format?: "number" | "currency" | "percent";
  currency?: string;
  title?: string;
}

interface NormalizedSeries {
  key: string;
  label: string;
  color: string;
}

function normalizeSeries(
  series: ChartSeries[] | undefined,
  data: Record<string, unknown>[],
  xKey: string | undefined,
): NormalizedSeries[] {
  let list: ChartSeries[] = Array.isArray(series) ? series : [];
  if (list.length === 0 && data.length > 0) {
    // No series given: chart every numeric field except the x key.
    list = Object.keys(data[0]).filter(
      (k) => k !== xKey && typeof data[0][k] === "number",
    );
  }
  return list.map((s, i) => {
    const entry = typeof s === "string" ? { key: s } : s;
    return {
      key: entry.key,
      label: ("label" in entry && entry.label) || entry.key,
      color:
        textColor(("color" in entry && entry.color) || undefined) ??
        CHART_PALETTE[i % CHART_PALETTE.length],
    };
  });
}

function makeFormatter(
  format: ChartProps["format"],
  currency: string | undefined,
): ((value: unknown) => string) | undefined {
  if (!format) return undefined;
  // Axis ticks must stay short ("$1.6K", "25%"): en-US, no decimals, compact
  // above 10k. Tooltips use the same formatter, which keeps charts consistent.
  const build = (compact: boolean) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style:
          format === "currency"
            ? "currency"
            : format === "percent"
              ? "percent"
              : "decimal",
        currency: format === "currency" ? (currency ?? "USD") : undefined,
        maximumFractionDigits: format === "percent" ? 1 : 0,
        ...(compact ? { notation: "compact" as const } : {}),
      });
    } catch {
      return new Intl.NumberFormat("en-US");
    }
  };
  const plain = build(false);
  const compact = build(true);
  return (value) =>
    typeof value === "number"
      ? (Math.abs(value) >= 10_000 ? compact : plain).format(value)
      : String(value ?? "");
}

/** Builds the chart component from the lazily imported recharts module. */
function createRechartsChart(R: RechartsModule) {
  return function RechartsChart({ props }: { props: ChartProps }) {
    const data = Array.isArray(props.data) ? props.data : [];
    const chartType = props.chartType ?? "bar";
    const series = normalizeSeries(props.series, data, props.xKey);
    const fmt = makeFormatter(props.format, props.currency);
    const showLegend = props.showLegend ?? true;
    const showGrid = props.showGrid ?? true;
    const showTooltip = props.showTooltip ?? true;
    const height = props.height ?? 240;
    const axisTick = { fontSize: 12, fill: textColor("secondary") };
    const valueLabel = props.showValueLabels
      ? { position: "top" as const, fontSize: 11, formatter: fmt as any }
      : undefined;

    if (chartType === "pie" || chartType === "donut") {
      const s = series[0];
      return (
        <R.ResponsiveContainer
          width="100%"
          height={height}
          initialDimension={{ width: 320, height }}
        >
          <R.PieChart>
            {s ? (
              <R.Pie
                data={data}
                dataKey={s.key}
                nameKey={props.xKey ?? "name"}
                innerRadius={chartType === "donut" ? "55%" : 0}
                outerRadius="80%"
                startAngle={90}
                endAngle={-270}
                label={props.showValueLabels ? true : undefined}
                isAnimationActive={false}
              >
                {data.map((_, i) => (
                  <R.Cell
                    key={`cell-${i}`}
                    fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                  />
                ))}
              </R.Pie>
            ) : null}
            {showTooltip ? (
              <R.Tooltip formatter={fmt as any} {...TOOLTIP_STYLE} />
            ) : null}
            {showLegend ? <R.Legend {...LEGEND_PROPS} /> : null}
          </R.PieChart>
        </R.ResponsiveContainer>
      );
    }

    const CartesianChart =
      chartType === "line"
        ? R.LineChart
        : chartType === "area"
          ? R.AreaChart
          : chartType === "scatter"
            ? R.ScatterChart
            : R.BarChart;
    const stackId = props.stacked ? "stack" : undefined;

    return (
      <R.ResponsiveContainer
        width="100%"
        height={height}
        initialDimension={{ width: 320, height }}
      >
        <CartesianChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          {showGrid ? (
            <R.CartesianGrid
              strokeDasharray="3 3"
              stroke={borderColor("subtle")}
              vertical={false}
            />
          ) : null}
          <R.XAxis
            dataKey={props.xKey}
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: borderColor("default") }}
          />
          <R.YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmt as any}
            width={64}
          />
          {showTooltip ? (
            <R.Tooltip formatter={fmt as any} {...TOOLTIP_STYLE} />
          ) : null}
          {showLegend && series.length > 0 ? (
            <R.Legend {...LEGEND_PROPS} />
          ) : null}
          {series.map((s) => {
            const common = {
              dataKey: s.key,
              name: s.label,
              isAnimationActive: false,
            };
            if (chartType === "line") {
              return (
                <R.Line
                  key={s.key}
                  {...common}
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  label={valueLabel}
                />
              );
            }
            if (chartType === "area") {
              return (
                <R.Area
                  key={s.key}
                  {...common}
                  type="monotone"
                  stroke={s.color}
                  fill={s.color}
                  fillOpacity={0.2}
                  stackId={stackId}
                  label={valueLabel}
                />
              );
            }
            if (chartType === "scatter") {
              return <R.Scatter key={s.key} {...common} fill={s.color} />;
            }
            return (
              <R.Bar
                key={s.key}
                {...common}
                fill={s.color}
                stackId={stackId}
                radius={stackId ? 0 : [4, 4, 0, 0]}
                label={valueLabel}
              />
            );
          })}
        </CartesianChart>
      </R.ResponsiveContainer>
    );
  };
}

/** Shown when recharts cannot be loaded (e.g. a UMD build without it). */
function ChartDataTable({ props }: { props: ChartProps }) {
  const data = Array.isArray(props.data) ? props.data : [];
  const series = normalizeSeries(props.series, data, props.xKey);
  const fmt = makeFormatter(props.format, props.currency) ?? String;
  const cell: React.CSSProperties = {
    ...textFont("sm"),
    padding: "4px 8px",
    textAlign: "start",
    borderBottom: `1px solid ${borderColor("subtle")}`,
  };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {props.xKey ? <th style={cell}>{props.xKey}</th> : null}
          {series.map((s) => (
            <th key={s.key} style={cell}>
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            {props.xKey ? (
              <td style={cell}>{String(row[props.xKey] ?? "")}</td>
            ) : null}
            {series.map((s) => (
              <td key={s.key} style={cell}>
                {fmt(row[s.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// recharts is loaded on first render so it stays out of the main bundle. If
// the import fails, the chart degrades to a plain data table.
const LazyRechartsChart = React.lazy(() =>
  import("recharts").then(
    (R) => ({ default: createRechartsChart(R) }),
    () => ({ default: ChartDataTable }),
  ),
);

function ChartPlaceholder({ height }: { height: number }) {
  return (
    <div
      aria-hidden
      style={{
        height,
        borderRadius: 8,
        background: "var(--a2ui-color-surface-secondary, #f7f7f8)",
      }}
    />
  );
}

export function Chart({ props }: RendererProps<any>) {
  const p = props as ChartProps;
  const height = p.height ?? 240;
  return (
    <figure style={{ margin: 0, width: "100%", minWidth: 0 }}>
      {p.title ? (
        <figcaption
          style={{
            ...textFont("sm"),
            fontWeight: FONT_WEIGHT.semibold,
            marginBottom: 8,
          }}
        >
          {p.title}
        </figcaption>
      ) : null}
      <div
        data-a2ui-chart={p.chartType ?? "bar"}
        style={{ minHeight: height, width: "100%", overflowX: "auto" }}
      >
        <Suspense fallback={<ChartPlaceholder height={height} />}>
          <LazyRechartsChart props={p} />
        </Suspense>
      </div>
    </figure>
  );
}
