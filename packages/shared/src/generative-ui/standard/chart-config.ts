// Framework-free chart helpers of the standard Chart component. They build a
// chart.js config without importing chart.js: the chart.js parts are typed
// structurally, so chart.js stays an optional peer of each framework package.
import { CHART_PALETTE, borderColor, textColor } from "./tokens";
import type { ChartProps, ChartSeries } from "./chart";

type ChartData = NonNullable<ChartProps["data"]>;

/**
 * The series of a chart, each with a key, a label and a color. Without
 * series, the chart shows every number field of the first row, except the
 * x key.
 *
 * @param series - The `series` prop of the chart.
 * @param data - The rows of the chart.
 * @param xKey - The field of the x axis (or of the slice names).
 */
export function normalizeSeries(
  series: ChartSeries[] | undefined,
  data: ChartData,
  xKey: string | undefined,
) {
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
    const color: string =
      textColor("color" in entry ? entry.color : undefined) ??
      CHART_PALETTE[index % CHART_PALETTE.length]!;
    return {
      key: entry.key,
      label: ("label" in entry && entry.label) || entry.key,
      color,
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
 * The value formatter of the axis, the tooltip, the value labels and the
 * data table. `undefined` when no `format` is set. Axis ticks must stay
 * short ("$1.6K", "25%"): en-US, no decimals, and compact from 10,000.
 *
 * @param format - The `format` prop of the chart.
 * @param currency - The ISO currency code for `"currency"`. Defaults to USD.
 */
export function makeFormatter(
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
 * A CSS color that a canvas can paint. The color tokens are
 * `var(--name, fallback)` strings: the custom property comes from the
 * computed style of `element`, else the fallback.
 *
 * @param value - A CSS color or a `var(...)` token.
 * @param element - The element whose computed style holds the custom properties.
 */
export function resolveCssColor(value: string, element: Element) {
  const match = /^var\((--[\w-]+)(?:,\s*(.*))?\)$/.exec(value.trim());
  if (!match) return value;
  const fallback = match[2]?.trim() ?? value;
  if (typeof getComputedStyle !== "function") return fallback;
  try {
    const resolved = getComputedStyle(element)
      .getPropertyValue(match[1]!)
      .trim();
    return resolved || fallback;
  } catch {
    return fallback;
  }
}

/**
 * A `#rrggbb` color with an alpha channel added. Any other color comes back
 * as it is.
 *
 * @example withAlpha("#ff0000", 0.2) // "#ff000033"
 */
export function withAlpha(color: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const hex = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${match[1]}${hex}`;
}

/** The `key` of a chart.js point (`{ x, y }`), or the value itself when it is not a point. */
function pointValue(value: unknown, key: "x" | "y") {
  if (typeof value !== "object" || value === null) return value;
  if (key === "x") return "x" in value ? value.x : value;
  return "y" in value ? value.y : value;
}

/**
 * A chart.js `Chart` constructor, as `chart.js/auto` exports it. Use it to
 * type the module that a chart loader resolves.
 */
export type ChartConstructor = new (
  canvas: HTMLCanvasElement,
  config: Record<string, unknown>,
) => { destroy(): void };

/** The part of a chart.js chart that the value labels plugin reads and draws on. */
interface ChartForLabels {
  ctx: CanvasRenderingContext2D;
  data: { datasets: { data: unknown[] }[] };
  options: { indexAxis?: string };
  getDatasetMeta(index: number): {
    hidden: boolean | null;
    type: string;
    data: {
      x: number;
      y: number;
      getProps?: (keys: string[], final?: boolean) => Record<string, number>;
    }[];
  };
}

/**
 * A chart.js plugin that draws the value of each bar, point and slice, for
 * `showValueLabels`: chart.js has no value labels of its own. Bar and point
 * labels sit above the mark (next to it in a horizontal layout); slice
 * labels sit outside the arc, with a line unless `showLabelLines` is false.
 *
 * @param props - The chart props.
 * @param format - The value formatter, from `makeFormatter`.
 * @param textFill - The canvas color of the label text.
 * @param lineStroke - The canvas color of the slice label lines.
 */
export function valueLabelsPlugin(
  props: ChartProps,
  format: ((value: unknown) => string) | undefined,
  textFill: string | undefined,
  lineStroke: string | undefined,
) {
  const showLines = props.showLabelLines ?? true;
  return {
    id: "a2uiValueLabels",
    afterDatasetsDraw(chart: ChartForLabels) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = "12px system-ui, sans-serif";
      if (textFill) ctx.fillStyle = textFill;
      if (lineStroke) ctx.strokeStyle = lineStroke;
      ctx.lineWidth = 1;
      const horizontal = chart.options.indexAxis === "y";
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        if (meta.hidden) return;
        meta.data.forEach((element, index) => {
          const value = pointValue(dataset.data[index], "y");
          if (typeof value !== "number" || !Number.isFinite(value)) return;
          const label = format ? format(value) : String(value);
          if (meta.type === "pie" || meta.type === "doughnut") {
            const arc = element.getProps?.(
              ["x", "y", "startAngle", "endAngle", "outerRadius"],
              true,
            );
            if (!arc) return;
            const angle = (arc.startAngle! + arc.endAngle!) / 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const edge = arc.outerRadius!;
            const fromX = arc.x! + cos * edge;
            const fromY = arc.y! + sin * edge;
            const toX = arc.x! + cos * (edge + 12);
            const toY = arc.y! + sin * (edge + 12);
            if (showLines) {
              ctx.beginPath();
              ctx.moveTo(fromX, fromY);
              ctx.lineTo(toX, toY);
              ctx.stroke();
            }
            ctx.textAlign = cos >= 0 ? "left" : "right";
            ctx.textBaseline = "middle";
            ctx.fillText(label, toX + (cos >= 0 ? 3 : -3), toY);
          } else if (horizontal) {
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(label, element.x + 4, element.y);
          } else {
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(label, element.x, element.y - 4);
          }
        });
      });
      ctx.restore();
    },
  };
}

/**
 * The chart.js config of the chart props: the marks, colors, axes, legend,
 * tooltip and value labels. Pass it to a chart.js `Chart` constructor.
 *
 * @param props - The chart props.
 * @param element - The chart element. Its computed style resolves the color tokens.
 */
export function chartConfig(
  props: ChartProps,
  element: Element,
): Record<string, unknown> {
  const color = (value: string | undefined) =>
    value === undefined ? undefined : resolveCssColor(value, element);
  const data = props.data ?? [];
  const chartType = props.chartType ?? "bar";
  const series = normalizeSeries(props.series, data, props.xKey);
  const format = makeFormatter(props.format, props.currency);
  const xKey = props.xKey;
  const secondary = color(textColor("secondary"));
  const plugins = props.showValueLabels
    ? [valueLabelsPlugin(props, format, color(textColor("default")), secondary)]
    : undefined;
  const legend = {
    display: (props.showLegend ?? true) && series.length > 0,
    labels: {
      usePointStyle: true,
      pointStyle: "circle",
      boxWidth: 8,
      boxHeight: 8,
      color: color(textColor("default")),
      font: { size: 13 },
    },
  };
  const tooltip = {
    enabled: props.showTooltip ?? true,
    callbacks: format
      ? {
          label: (context: {
            dataset: { label?: string };
            parsed: unknown;
            raw: unknown;
          }) => {
            const parsed = context.parsed;
            // A horizontal layout puts the value on the x axis. A scatter
            // point keeps its value in y whatever the layout.
            const valueKey =
              props.layout === "horizontal" && chartType !== "scatter"
                ? "x"
                : "y";
            const value = pointValue(parsed, valueKey);
            const label = context.dataset.label;
            return `${label ? `${label}: ` : ""}${format(value)}`;
          },
        }
      : undefined,
  };
  const common = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
  };

  if (chartType === "pie" || chartType === "donut") {
    const first = series[0];
    const labels = data.map((row) => String(row[xKey ?? "name"] ?? ""));
    return {
      type: chartType === "pie" ? "pie" : "doughnut",
      plugins,
      data: {
        labels,
        datasets: first
          ? [
              {
                label: first.label,
                data: data.map((row) => Number(row[first.key] ?? 0)),
                backgroundColor: data.map((_, index) =>
                  color(CHART_PALETTE[index % CHART_PALETTE.length]!),
                ),
                borderWidth: 0,
                borderRadius: props.cornerRadius ?? 0,
                spacing: props.paddingAngle ?? 0,
              },
            ]
          : [],
      },
      options: {
        ...common,
        cutout: props.innerRadius ?? (chartType === "donut" ? "55%" : 0),
        radius: props.outerRadius ?? "80%",
        rotation: props.startAngle === undefined ? 0 : 90 - props.startAngle,
        circumference:
          props.startAngle !== undefined && props.endAngle !== undefined
            ? Math.abs(props.startAngle - props.endAngle)
            : 360,
        plugins: { legend, tooltip },
      },
    };
  }

  const isHorizontal = props.layout === "horizontal";
  const stacked = props.stacked === true;
  // Scatter uses numeric distances when all x values are numbers. Preserve
  // category spacing for string/mixed data and for the other chart types.
  const isNumericScatter =
    chartType === "scatter" &&
    xKey !== undefined &&
    data.length > 0 &&
    data.every(
      (row) => typeof row[xKey] === "number" && Number.isFinite(row[xKey]),
    );
  const labels = data.map((row) => String((xKey ? row[xKey] : "") ?? ""));
  const pointRadius = props.showDots ? 3 : 0;
  const datasets = series.map((item) => {
    const paint = color(item.color);
    const values = data.map((row) => row[item.key]);
    switch (chartType) {
      case "line":
        return {
          label: item.label,
          data: values,
          borderColor: paint,
          backgroundColor: paint,
          borderWidth: 2,
          tension: 0.4,
          pointRadius,
          fill: false,
        };
      case "area":
        return {
          label: item.label,
          data: values,
          borderColor: paint,
          backgroundColor: withAlpha(paint ?? "", 0.2),
          borderWidth: 2,
          tension: 0.4,
          pointRadius,
          fill: stacked ? "stack" : "origin",
        };
      case "scatter":
        return {
          label: item.label,
          data: data.map((row, index) => ({
            x: isNumericScatter ? row[xKey!] : index,
            y: row[item.key],
          })),
          backgroundColor: paint,
          pointRadius: 4,
        };
      default:
        return {
          label: item.label,
          data: values,
          backgroundColor: paint,
          borderRadius: stacked ? 0 : (props.barRadius ?? 4),
          borderSkipped: stacked ? false : undefined,
        };
    }
  });
  const valueAxis = {
    stacked,
    min: props.yAxis?.min,
    max: props.yAxis?.max,
    grid: {
      display: props.showGrid ?? true,
      color: color(borderColor("subtle")),
    },
    border: { display: false },
    ticks: {
      color: secondary,
      font: { size: 12 },
      callback: format ? (value: unknown) => format(value) : undefined,
    },
    title: props.yAxis?.label
      ? {
          display: true,
          text: props.yAxis.label,
          color: secondary,
          font: { size: 12 },
        }
      : undefined,
  };
  const categoryAxis = {
    stacked,
    type: isNumericScatter ? "linear" : "category",
    grid: { display: false },
    border: { color: color(borderColor("default")) },
    ticks: { color: secondary, font: { size: 12 } },
  };
  return {
    type: chartType === "area" ? "line" : chartType,
    plugins,
    data: { labels: isNumericScatter ? undefined : labels, datasets },
    options: {
      ...common,
      indexAxis: isHorizontal ? "y" : "x",
      plugins: { legend, tooltip },
      scales: isHorizontal
        ? { x: valueAxis, y: categoryAxis }
        : { x: categoryAxis, y: valueAxis },
    },
  };
}
