import React, { Suspense, memo, useRef } from "react";
import type { CSSProperties, ComponentType } from "react";
import type * as Recharts from "recharts";
import { z } from "zod";
import {
  CHART_CURSOR,
  CHART_PALETTE,
  FONT_WEIGHT,
  SHADOW_MD,
  backgroundColor,
  borderColor,
  textColor,
  textFont,
} from "./tokens";

// ---- Schema ----

export const chartSeries = z.union([
  z.string(),
  z.object({
    key: z.string(),
    label: z.string().optional(),
    color: z.string().optional().describe("A text color token or a CSS color"),
  }),
]);
export type ChartSeries = z.output<typeof chartSeries>;

export const chartSchema = z.object({
  chartType: z
    .enum(["bar", "line", "area", "scatter", "pie", "donut"])
    .optional()
    .describe('Default "bar"'),
  data: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('A list of objects, or { "@path": "/x" }'),
  xKey: z.string().optional().describe("The field of the category axis"),
  series: z
    .array(chartSeries)
    .optional()
    .describe(
      'The value fields: strings or { "key", "label"?, "color"? }. Default: every number field except xKey',
    ),
  stacked: z.boolean().optional(),
  layout: z
    .enum(["vertical", "horizontal"])
    .optional()
    .describe(
      '"horizontal" draws the bars from left to right. Default "vertical"',
    ),
  yAxis: z
    .object({
      label: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      width: z.number().optional().describe("Pixels"),
    })
    .optional()
    .describe(
      'The value axis configuration object: {label?: string, min?: number, max?: number, width?: number}. Example: {label: "Revenue (USD)", min: 0, max: 100, width: 64}. In horizontal charts this controls the horizontal value axis.',
    ),
  showDots: z.boolean().optional().describe("Point markers on a line or area"),
  barRadius: z
    .number()
    .optional()
    .describe("The corner radius of a bar, in pixels"),
  innerRadius: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Pie and donut"),
  outerRadius: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Pie and donut"),
  startAngle: z.number().optional().describe("Pie and donut. Default 90"),
  endAngle: z.number().optional().describe("Pie and donut. Default -270"),
  cornerRadius: z.number().optional().describe("The corners of a slice"),
  paddingAngle: z.number().optional().describe("The gap between slices"),
  showLabelLines: z
    .boolean()
    .optional()
    .describe("Leader lines of the slice labels. Default true"),
  height: z.number().optional().describe("Pixels. Default 240"),
  showLegend: z.boolean().optional().describe("Default true"),
  showGrid: z.boolean().optional().describe("Default true"),
  showTooltip: z.boolean().optional().describe("Default true"),
  showValueLabels: z.boolean().optional(),
  format: z
    .enum(["number", "currency", "percent"])
    .optional()
    .describe(
      'Number formatting. With "percent", data values and axis min/max are fractions: 0.4 displays as 40%. For 0% to 10%, use min: 0 and max: 0.1.',
    ),
  currency: z.string().optional().describe('ISO code. Default "USD"'),
  title: z.string().optional(),
});
export type ChartProps = z.output<typeof chartSchema>;

type ChartData = NonNullable<ChartProps["data"]>;

// ---- Helpers ----

const DEFAULT_HEIGHT = 240;

/** Hides an element on screen. Screen readers still read it. */
export const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Legend labels use the text color, not the series color. */
function legendFormatter(value: string) {
  return (
    <span style={{ color: textColor("default"), fontSize: 13 }}>{value}</span>
  );
}

const LEGEND_PROPS = {
  iconType: "circle",
  iconSize: 8,
  formatter: legendFormatter,
  wrapperStyle: { paddingTop: 8 },
} as const;

const TOOLTIP_PROPS = {
  contentStyle: {
    borderRadius: 10,
    border: `1px solid ${borderColor("subtle")}`,
    boxShadow: SHADOW_MD,
    fontSize: 13,
  },
  cursor: { fill: CHART_CURSOR },
};

interface NormalizedSeries {
  key: string;
  label: string;
  color: string;
}

/**
 * The series with a label and a color each. Without series, the chart shows
 * every number field of the first row, except the x key.
 */
function normalizeSeries(
  series: ChartSeries[] | undefined,
  data: ChartData,
  xKey: string | undefined,
): NormalizedSeries[] {
  const first = data[0];
  const isEmpty = series === undefined || series.length === 0;
  const list: ChartSeries[] =
    isEmpty && first !== undefined
      ? Object.keys(first).filter(
          (key) => key !== xKey && typeof first[key] === "number",
        )
      : (series ?? []);
  return list.map((item, index) => {
    const entry = typeof item === "string" ? { key: item } : item;
    return {
      key: entry.key,
      label: ("label" in entry && entry.label) || entry.key,
      color:
        textColor("color" in entry ? entry.color : undefined) ??
        CHART_PALETTE[index % CHART_PALETTE.length],
    };
  });
}

function numberStyle(format: NonNullable<ChartProps["format"]>) {
  switch (format) {
    case "currency":
      return "currency";
    case "percent":
      return "percent";
    case "number":
      return "decimal";
  }
}

/**
 * The value formatter of the axis, the tooltip and the value labels.
 * `undefined` when no `format` is set. Axis ticks must stay short ("$1.6K",
 * "25%"): en-US, no decimals, and compact from 10,000.
 */
function makeFormatter(
  format: ChartProps["format"],
  currency: string | undefined,
) {
  if (!format) return undefined;
  const build = (isCompact: boolean) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: numberStyle(format),
        currency: format === "currency" ? (currency ?? "USD") : undefined,
        maximumFractionDigits: format === "percent" ? 1 : 0,
        notation: isCompact ? "compact" : undefined,
      });
    } catch {
      // An unknown currency code throws. Plain numbers are a safe fallback.
      return new Intl.NumberFormat("en-US");
    }
  };
  const plain = build(false);
  const compact = build(true);
  return (value: unknown) =>
    typeof value === "number"
      ? (Math.abs(value) >= 10_000 ? compact : plain).format(value)
      : String(value ?? "");
}

/**
 * The previous value while the new value has the same JSON.
 *
 * A streaming surface can give a component new props objects with the same
 * content. Recharts rebuilds its SVG nodes on each render that it sees, and
 * the chart then flashes. So `Chart` gives the memoized chart one stable
 * props object, and the chart renders only when its content changes.
 */
export function useStableValue<Value>(value: Value) {
  const ref = useRef<{ value: Value; key: string } | null>(null);
  const key = JSON.stringify(value);
  if (ref.current === null || ref.current.key !== key) {
    ref.current = { value, key };
  }
  return ref.current.value;
}

// ---- Recharts chart ----

type RechartsModule = typeof Recharts;
type ChartComponent = ComponentType<{ props: ChartProps }>;

function cartesianChartOf(
  R: RechartsModule,
  chartType: "bar" | "line" | "area" | "scatter",
) {
  switch (chartType) {
    case "line":
      return R.LineChart;
    case "area":
      return R.AreaChart;
    case "scatter":
      return R.ScatterChart;
    case "bar":
      return R.BarChart;
  }
}

/** The chart component, built from the recharts module after it loads. */
function createRechartsChart(R: RechartsModule) {
  return memo(function RechartsChart({ props }: { props: ChartProps }) {
    const data = props.data ?? [];
    const chartType = props.chartType ?? "bar";
    const series = normalizeSeries(props.series, data, props.xKey);
    const format = makeFormatter(props.format, props.currency);
    const showLegend = props.showLegend ?? true;
    const showGrid = props.showGrid ?? true;
    const showTooltip = props.showTooltip ?? true;
    const height = props.height ?? DEFAULT_HEIGHT;
    const axisTick = { fontSize: 12, fill: textColor("secondary") };
    const valueLabel = props.showValueLabels
      ? { position: "top" as const, fontSize: 11, formatter: format }
      : undefined;
    const tooltip = showTooltip ? (
      <R.Tooltip formatter={format} {...TOOLTIP_PROPS} />
    ) : null;

    if (chartType === "pie" || chartType === "donut") {
      const first = series[0];
      return (
        <R.ResponsiveContainer
          width="100%"
          height={height}
          initialDimension={{ width: 320, height }}
        >
          <R.PieChart>
            {first ? (
              <R.Pie
                data={data}
                dataKey={first.key}
                nameKey={props.xKey ?? "name"}
                innerRadius={
                  props.innerRadius ?? (chartType === "donut" ? "55%" : 0)
                }
                outerRadius={props.outerRadius ?? "80%"}
                startAngle={props.startAngle ?? 90}
                endAngle={props.endAngle ?? -270}
                cornerRadius={props.cornerRadius}
                paddingAngle={props.paddingAngle}
                label={
                  props.showValueLabels
                    ? format
                      ? ({ value }) => format(value)
                      : true
                    : undefined
                }
                labelLine={
                  props.showValueLabels ? (props.showLabelLines ?? true) : false
                }
                isAnimationActive={false}
              >
                {data.map((_, index) => (
                  <R.Cell
                    key={`cell-${index}`}
                    fill={CHART_PALETTE[index % CHART_PALETTE.length]}
                  />
                ))}
              </R.Pie>
            ) : null}
            {tooltip}
            {showLegend ? <R.Legend {...LEGEND_PROPS} /> : null}
          </R.PieChart>
        </R.ResponsiveContainer>
      );
    }

    const CartesianChart = cartesianChartOf(R, chartType);
    const stackId = props.stacked ? "stack" : undefined;
    const isHorizontal = props.layout === "horizontal";
    const xKey = props.xKey;
    // Scatter uses numeric distances when all x values are numbers. Preserve
    // category spacing for string/mixed data and for the other chart types.
    const isNumericScatter =
      chartType === "scatter" &&
      xKey !== undefined &&
      data.length > 0 &&
      data.every(
        (row) => typeof row[xKey] === "number" && Number.isFinite(row[xKey]),
      );
    const domain: [number | "auto", number | "auto"] = [
      props.yAxis?.min ?? "auto",
      props.yAxis?.max ?? "auto",
    ];
    const valueAxisLabel = props.yAxis?.label
      ? {
          value: props.yAxis.label,
          position: isHorizontal
            ? ("insideBottom" as const)
            : ("insideLeft" as const),
          angle: isHorizontal ? 0 : -90,
          fontSize: 12,
          fill: textColor("secondary"),
        }
      : undefined;
    const dot = props.showDots ? { r: 3, strokeWidth: 0 } : false;
    const marks = series.map((item) => {
      const common = {
        dataKey: item.key,
        name: item.label,
        isAnimationActive: false,
      };
      switch (chartType) {
        case "line":
          return (
            <R.Line
              key={item.key}
              {...common}
              type="monotone"
              stroke={item.color}
              strokeWidth={2}
              dot={dot ? { ...dot, fill: item.color } : false}
              label={valueLabel}
            />
          );
        case "area":
          return (
            <R.Area
              key={item.key}
              {...common}
              type="monotone"
              stroke={item.color}
              fill={item.color}
              fillOpacity={0.2}
              stackId={stackId}
              dot={dot ? { ...dot, fill: item.color } : false}
              label={valueLabel}
            />
          );
        case "scatter":
          return <R.Scatter key={item.key} {...common} fill={item.color} />;
        case "bar":
          return (
            <R.Bar
              key={item.key}
              {...common}
              fill={item.color}
              stackId={stackId}
              radius={
                stackId
                  ? 0
                  : props.barRadius !== undefined
                    ? props.barRadius
                    : isHorizontal
                      ? [0, 4, 4, 0]
                      : [4, 4, 0, 0]
              }
              label={valueLabel}
            />
          );
      }
    });
    return (
      <R.ResponsiveContainer
        width="100%"
        height={height}
        initialDimension={{ width: 320, height }}
      >
        <CartesianChart
          data={data}
          // recharts calls the axis layout of a horizontal bar chart "vertical".
          layout={isHorizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          {showGrid ? (
            <R.CartesianGrid
              strokeDasharray="3 3"
              stroke={borderColor("subtle")}
              vertical={isHorizontal}
              horizontal={!isHorizontal}
            />
          ) : null}
          {isHorizontal ? (
            <>
              <R.XAxis
                type="number"
                domain={domain}
                tick={axisTick}
                tickLine={false}
                axisLine={{ stroke: borderColor("default") }}
                tickFormatter={format}
                label={valueAxisLabel}
              />
              <R.YAxis
                type={isNumericScatter ? "number" : "category"}
                dataKey={props.xKey}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                width={props.yAxis?.width ?? 96}
              />
            </>
          ) : (
            <>
              <R.XAxis
                type={isNumericScatter ? "number" : "category"}
                dataKey={props.xKey}
                tick={axisTick}
                tickLine={false}
                axisLine={{ stroke: borderColor("default") }}
              />
              <R.YAxis
                domain={domain}
                tick={axisTick}
                tickLine={false}
                axisLine={false}
                tickFormatter={format}
                width={props.yAxis?.width ?? 64}
                label={valueAxisLabel}
              />
            </>
          )}
          {tooltip}
          {showLegend && series.length > 0 ? (
            <R.Legend {...LEGEND_PROPS} />
          ) : null}
          {marks}
        </CartesianChart>
      </R.ResponsiveContainer>
    );
  });
}

/**
 * The chart data as a table. Screen readers read it next to the chart. It
 * is also the visible chart when recharts cannot load.
 */
function ChartDataTable({
  props,
  style,
}: {
  props: ChartProps;
  style?: CSSProperties;
}) {
  const data = props.data ?? [];
  const series = normalizeSeries(props.series, data, props.xKey);
  const format = makeFormatter(props.format, props.currency) ?? String;
  const xKey = props.xKey;
  const cell: CSSProperties = {
    ...textFont("sm"),
    padding: "4px 8px",
    textAlign: "start",
    borderBottom: `1px solid ${borderColor("subtle")}`,
  };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", ...style }}>
      <thead>
        <tr>
          {xKey ? (
            <th scope="col" style={cell}>
              {xKey}
            </th>
          ) : null}
          {series.map((item) => (
            <th key={item.key} scope="col" style={cell}>
              {item.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, index) => (
          <tr key={index}>
            {xKey ? (
              <th scope="row" style={{ ...cell, fontWeight: "normal" }}>
                {String(row[xKey] ?? "")}
              </th>
            ) : null}
            {series.map((item) => (
              <td key={item.key} style={cell}>
                {format(row[item.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VisibleDataTable({ props }: { props: ChartProps }) {
  return <ChartDataTable props={props} />;
}

/**
 * recharts loads on first render, so it stays out of the main bundle. When
 * the import fails, the chart becomes a plain data table.
 */
const LazyRechartsChart = React.lazy(() =>
  import("recharts").then(
    (R): { default: ChartComponent } => ({
      default: createRechartsChart(R),
    }),
    (): { default: ChartComponent } => ({ default: VisibleDataTable }),
  ),
);

function ChartPlaceholder({ height }: { height: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        height,
        borderRadius: 8,
        background: backgroundColor("surface-secondary"),
      }}
    />
  );
}

/**
 * A bar, line, area, scatter, pie or donut chart on recharts. The drawing
 * is hidden from screen readers. They read a data table of the same values.
 */
export function Chart(props: ChartProps) {
  const stable = useStableValue(props);
  const height = stable.height ?? DEFAULT_HEIGHT;
  const chartType = stable.chartType ?? "bar";
  return (
    <figure
      data-a2ui-std=""
      style={{ position: "relative", margin: 0, width: "100%", minWidth: 0 }}
    >
      {stable.title ? (
        <figcaption
          style={{
            ...textFont("sm"),
            fontWeight: FONT_WEIGHT.semibold,
            marginBottom: 8,
          }}
        >
          {stable.title}
        </figcaption>
      ) : null}
      <div
        aria-hidden="true"
        data-a2ui-chart={chartType}
        style={{ minHeight: height, width: "100%", overflowX: "auto" }}
      >
        <Suspense fallback={<ChartPlaceholder height={height} />}>
          <LazyRechartsChart props={stable} />
        </Suspense>
      </div>
      <ChartDataTable props={stable} style={VISUALLY_HIDDEN} />
    </figure>
  );
}
