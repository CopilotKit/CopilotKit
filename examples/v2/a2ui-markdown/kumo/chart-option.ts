import { ChartPalette } from "@cloudflare/kumo";
import type { StandardProps } from "./types";

type ChartProps = Omit<StandardProps<"Chart">, never>;
type ChartFormat = ChartProps["format"];
type Row = Record<string, unknown>;
type Formatter = (value: unknown) => string;

/** One ECharts series, as this module builds it. */
export interface ChartSeriesOption {
  type: "bar" | "line" | "scatter" | "pie";
  name?: string;
  data: unknown[];
  stack?: string;
  showSymbol?: boolean;
  symbolSize?: number;
  smooth?: boolean;
  areaStyle?: { opacity: number };
  itemStyle?: { color?: string; borderRadius?: number | number[] };
  label?: {
    show: boolean;
    position?: string;
    formatter?: (params: { value: unknown }) => string;
  };
  labelLine?: { show: boolean };
  radius?: [number | string, number | string];
  startAngle?: number;
  clockwise?: boolean;
  padAngle?: number;
}

interface AxisOption {
  type: "category" | "value";
  data?: string[];
  name?: string;
  nameLocation?: "middle";
  nameGap?: number;
  min?: number;
  max?: number;
  boundaryGap?: boolean;
  splitLine?: { show: boolean };
  axisLabel?: { formatter?: (value: number) => string };
}

/** The ECharts option this module builds, a subset of Kumo's chart option. */
export interface ChartOption {
  color: string[];
  grid?: Record<string, unknown>;
  tooltip: {
    show: boolean;
    trigger?: "axis" | "item";
    valueFormatter?: Formatter;
  };
  xAxis?: AxisOption;
  yAxis?: AxisOption;
  series: ChartSeriesOption[];
}

// ---- Copied from the standard Chart (standard/Chart.tsx) ----

/**
 * The value formatter of the axis, the tooltip and the value labels, or
 * `undefined` when no `format` is set. Axis ticks stay short ("$1.6K",
 * "25%"): en-US, no decimals, and compact from 10,000.
 */
export function makeFormatter(
  format: ChartFormat,
  currency: string | undefined,
): Formatter | undefined {
  if (!format) return undefined;
  const style =
    format === "currency"
      ? "currency"
      : format === "percent"
        ? "percent"
        : "decimal";
  const build = (isCompact: boolean) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style,
        currency: format === "currency" ? (currency ?? "USD") : undefined,
        maximumFractionDigits: format === "percent" ? 1 : 0,
        notation: isCompact ? "compact" : undefined,
      });
    } catch {
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

// ---- Colors ----

/**
 * A series color token as a Kumo chart color. ECharts draws on a canvas,
 * which cannot read CSS variables, so tokens resolve to Kumo's semantic
 * chart colors. A CSS color passes through.
 */
const SEMANTIC_COLOR: Record<
  string,
  Parameters<typeof ChartPalette.semantic>[0]
> = {
  danger: "Attention",
  warning: "Warning",
  caution: "Warning",
  success: "Success",
  secondary: "Neutral",
  tertiary: "Neutral",
};
const PALETTE_TOKENS = new Set([
  "default",
  "prose",
  "primary",
  "emphasis",
  "info",
  "discovery",
]);

/** The color of series `index`: its token or CSS color, else the palette. */
export function seriesColorOf(
  color: string | undefined,
  index: number,
  palette: string[],
): string {
  if (color && SEMANTIC_COLOR[color]) {
    return ChartPalette.semantic(SEMANTIC_COLOR[color], false);
  }
  if (color && !PALETTE_TOKENS.has(color)) return color;
  return palette[index % palette.length];
}

// ---- Series ----

interface Series {
  key: string;
  label: string;
  color: string;
}

/**
 * The series with a label and a color each. Without series, every number
 * field of the first row except the x key, like the standard Chart.
 */
function seriesOf(props: ChartProps, data: Row[], palette: string[]): Series[] {
  const first = data[0];
  const isEmpty = props.series === undefined || props.series.length === 0;
  const list =
    isEmpty && first !== undefined
      ? Object.keys(first).filter(
          (key) => key !== props.xKey && typeof first[key] === "number",
        )
      : (props.series ?? []);
  return list.map((item, index) => {
    const entry = typeof item === "string" ? { key: item } : item;
    return {
      key: entry.key,
      label: ("label" in entry && entry.label) || entry.key,
      color: seriesColorOf(
        "color" in entry ? entry.color : undefined,
        index,
        palette,
      ),
    };
  });
}

const toNumber = (value: unknown) =>
  typeof value === "number"
    ? value
    : value === null || value === undefined
      ? null
      : Number(value);
const toLabel = (value: unknown) =>
  value === undefined || value === null ? "" : String(value);

// ---- Option ----

/**
 * The ECharts option of a standard Chart, for Kumo's Chart: bar, line,
 * area, scatter, pie and donut, with the standard defaults.
 */
export function toEChartsOption(
  props: ChartProps,
  palette: string[],
): ChartOption {
  const data = (props.data ?? []) as Row[];
  const chartType = props.chartType ?? "bar";
  const series = seriesOf(props, data, palette);
  const format = makeFormatter(props.format, props.currency);
  const showTooltip = props.showTooltip ?? true;
  const showGrid = props.showGrid ?? true;
  const colors = series.length > 0 ? series.map((item) => item.color) : palette;
  const valueLabel = props.showValueLabels
    ? (position: string) => ({
        show: true,
        position,
        formatter: (params: { value: unknown }) => {
          const value = Array.isArray(params.value)
            ? params.value[1]
            : params.value;
          return format ? format(value) : toLabel(value);
        },
      })
    : undefined;

  if (chartType === "pie" || chartType === "donut") {
    const first = series[0];
    const nameKey = props.xKey ?? "name";
    const startAngle = props.startAngle ?? 90;
    const endAngle = props.endAngle ?? -270;
    return {
      color: palette,
      tooltip: showTooltip
        ? { show: true, trigger: "item", valueFormatter: format }
        : { show: false },
      series: first
        ? [
            {
              type: "pie",
              name: first.label,
              radius: [
                props.innerRadius ?? (chartType === "donut" ? "55%" : 0),
                props.outerRadius ?? "80%",
              ],
              startAngle,
              clockwise: endAngle < startAngle,
              ...(props.paddingAngle !== undefined
                ? { padAngle: props.paddingAngle }
                : {}),
              itemStyle: { borderRadius: props.cornerRadius ?? 0 },
              label: valueLabel ? valueLabel("outside") : { show: false },
              labelLine: {
                show: props.showValueLabels
                  ? (props.showLabelLines ?? true)
                  : false,
              },
              data: data.map((row) => ({
                name: toLabel(row[nameKey]),
                value: toNumber(row[first.key]),
              })),
            },
          ]
        : [],
    };
  }

  const xKey = props.xKey ?? "";
  const isHorizontal = props.layout === "horizontal";
  const isScatter = chartType === "scatter";
  const isNumericX =
    isScatter &&
    data.length > 0 &&
    data.every((row) => typeof row[xKey] === "number");
  const valueAxis: AxisOption = {
    type: "value",
    ...(props.yAxis?.label
      ? { name: props.yAxis.label, nameLocation: "middle", nameGap: 44 }
      : {}),
    ...(props.yAxis?.min !== undefined ? { min: props.yAxis.min } : {}),
    ...(props.yAxis?.max !== undefined ? { max: props.yAxis.max } : {}),
    splitLine: { show: showGrid },
    ...(format
      ? { axisLabel: { formatter: (value: number) => format(value) } }
      : {}),
  };
  const categoryAxis: AxisOption = isNumericX
    ? { type: "value", splitLine: { show: false } }
    : {
        type: "category",
        data: data.map((row) => toLabel(row[xKey])),
        boundaryGap: chartType === "bar",
      };
  const barRadius = props.stacked
    ? 0
    : (props.barRadius ?? (isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]));
  return {
    color: colors,
    // ECharts 6 keeps the axis labels inside the grid by default.
    grid: { left: 8, right: 16, top: 16, bottom: 8 },
    tooltip: showTooltip
      ? {
          show: true,
          trigger: isScatter ? "item" : "axis",
          valueFormatter: format,
        }
      : { show: false },
    xAxis: isHorizontal ? valueAxis : categoryAxis,
    yAxis: isHorizontal ? categoryAxis : valueAxis,
    series: series.map((item) => {
      const values = data.map((row) => toNumber(row[item.key]));
      const common = {
        name: item.label,
        itemStyle: { color: item.color },
        ...(valueLabel
          ? { label: valueLabel(isHorizontal ? "right" : "top") }
          : {}),
      };
      if (isScatter) {
        return {
          ...common,
          type: "scatter" as const,
          symbolSize: 8,
          data: isNumericX
            ? data.map((row) => [row[xKey] as number, toNumber(row[item.key])])
            : values,
        };
      }
      if (chartType === "bar") {
        return {
          ...common,
          type: "bar" as const,
          data: values,
          ...(props.stacked ? { stack: "total" } : {}),
          itemStyle: { color: item.color, borderRadius: barRadius },
        };
      }
      return {
        ...common,
        type: "line" as const,
        data: values,
        smooth: true,
        showSymbol: props.showDots ?? false,
        ...(props.stacked ? { stack: "total" } : {}),
        ...(chartType === "area" ? { areaStyle: { opacity: 0.2 } } : {}),
      };
    }),
  };
}

/** One item of the Kumo legend under a chart. */
export interface LegendItem {
  name: string;
  color: string;
  value: string;
}

/**
 * The legend of a chart option: each series with its color, or each pie
 * slice with its color and value.
 */
export function legendItemsOf(
  option: ChartOption,
  format: Formatter | undefined,
): LegendItem[] {
  const show = (value: number) =>
    format ? format(value) : value.toLocaleString("en-US");
  const first = option.series[0];
  if (first?.type === "pie") {
    return (first.data as Array<{ name: string; value: number | null }>).map(
      (slice, index) => ({
        name: slice.name,
        color: option.color[index % option.color.length],
        value: show(slice.value ?? 0),
      }),
    );
  }
  // A series has no one value to show: a total is wrong for rates,
  // averages and prices.
  return option.series.map((series, index) => ({
    name: series.name ?? "",
    color: series.itemStyle?.color ?? option.color[index % option.color.length],
    value: "",
  }));
}
