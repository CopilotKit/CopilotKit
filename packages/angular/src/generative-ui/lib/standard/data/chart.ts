import {
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import {
  CHART_PALETTE,
  FONT_WEIGHT,
  backgroundColor,
  borderColor,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type { ChartProps, ChartSeries } from "@copilotkit/shared/generative-ui";
import { GenerativeUIStyles } from "../../styles";
import { GENERATIVE_UI_CHART_LOADER } from "../loaders";
import { VISUALLY_HIDDEN, jsonEqual } from "../style";
import type { StyleMap } from "../style";

const DEFAULT_HEIGHT = 240;

type ChartData = NonNullable<ChartProps["data"]>;

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
        CHART_PALETTE[index % CHART_PALETTE.length]!,
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
 * A CSS color the canvas can paint. The tokens are `var(--name, fallback)`
 * strings; the custom property comes from the computed style of `element`,
 * else the fallback.
 */
function resolveCssColor(value: string, element: Element): string {
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

/** `#rrggbb` with an alpha, else the color as it is. */
function withAlpha(color: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const hex = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${match[1]}${hex}`;
}

/** A chart.js constructor, as `chart.js/auto` exports it. */
type ChartConstructor = new (
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
 * Draws the value of each bar, point and slice, the way recharts does for
 * `showValueLabels`: chart.js has no value labels of its own. Bar and point
 * labels sit above the mark (next to it in a horizontal layout); slice
 * labels sit outside the arc, with a line unless `showLabelLines` is false.
 */
function valueLabelsPlugin(
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
          const raw = dataset.data[index];
          const value =
            typeof raw === "object" && raw !== null && "y" in raw
              ? (raw as { y: unknown }).y
              : raw;
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
 * The chart.js config of the props: the same marks, colors, axes, legend,
 * tooltip and value labels as the React chart draws with recharts.
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
            const value =
              typeof parsed === "object" && parsed !== null && "y" in parsed
                ? (parsed as { y: unknown }).y
                : parsed;
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

/**
 * @internal
 * The chart data as a table. Screen readers read it next to the chart. It
 * is also the visible chart when chart.js is not there.
 */
@Component({
  selector: "table[copilotGenerativeUIChartTable]",
  template: `
    <thead>
      <tr>
        @if (chart().xKey; as xKey) {
          <th scope="col" [style]="cell">{{ xKey }}</th>
        }
        @for (item of series(); track item.key) {
          <th scope="col" [style]="cell">{{ item.label }}</th>
        }
      </tr>
    </thead>
    <tbody>
      @for (row of rows(); track $index) {
        <tr>
          @if (chart().xKey; as xKey) {
            <th scope="row" [style]="rowHeader">{{ text(row[xKey]) }}</th>
          }
          @for (item of series(); track item.key) {
            <td [style]="cell">{{ format()(row[item.key]) }}</td>
          }
        </tr>
      }
    </tbody>
  `,
  host: { "[style]": "style()" },
})
export class CopilotGenerativeUIChartTable {
  readonly chart = input.required<ChartProps>();
  readonly hidden = input(false);

  protected readonly cell: StyleMap = {
    ...textFont("sm"),
    padding: "4px 8px",
    textAlign: "start",
    borderBottom: `1px solid ${borderColor("subtle")}`,
  };
  protected readonly rowHeader: StyleMap = {
    ...this.cell,
    fontWeight: "normal",
  };
  protected readonly rows = computed(() => this.chart().data ?? []);
  protected readonly series = computed(() =>
    normalizeSeries(this.chart().series, this.rows(), this.chart().xKey),
  );
  protected readonly format = computed(
    () =>
      makeFormatter(this.chart().format, this.chart().currency) ??
      ((value: unknown) => String(value ?? "")),
  );
  protected readonly style = computed<StyleMap>(() => ({
    width: "100%",
    borderCollapse: "collapse",
    ...(this.hidden() ? VISUALLY_HIDDEN : {}),
  }));

  protected text(value: unknown) {
    return String(value ?? "");
  }
}

/**
 * A bar, line, area, scatter, pie or donut chart on chart.js, loaded through
 * `provideGenerativeUIChart()`. Without it, the chart is a data table. The
 * drawing is hidden from screen readers; they read a data table of the same
 * values.
 */
@Component({
  selector: "figure[copilotGenerativeUIChart]",
  imports: [CopilotGenerativeUIChartTable],
  template: `
    @if (title(); as title) {
      <figcaption [style]="captionStyle">{{ title }}</figcaption>
    }
    <div
      aria-hidden="true"
      [attr.data-a2ui-chart]="chartType() ?? 'bar'"
      [style]="areaStyle()"
    >
      @switch (status()) {
        @case ("ready") {
          <canvas #canvas></canvas>
        }
        @case ("fallback") {
          <table copilotGenerativeUIChartTable [chart]="props()"></table>
        }
        @default {
          <div aria-hidden="true" [style]="placeholderStyle()"></div>
        }
      }
    </div>
    <table copilotGenerativeUIChartTable [chart]="props()" [hidden]="true"></table>
  `,
  host: {
    "data-a2ui-std": "",
    style: "position:relative;margin:0;width:100%;min-width:0",
  },
})
export class CopilotGenerativeUIChart {
  readonly chartType = input<ChartProps["chartType"]>();
  readonly data = input<ChartProps["data"]>();
  readonly xKey = input<string>();
  readonly series = input<ChartProps["series"]>();
  readonly stacked = input<boolean>();
  readonly layout = input<ChartProps["layout"]>();
  readonly yAxis = input<ChartProps["yAxis"]>();
  readonly showDots = input<boolean>();
  readonly barRadius = input<number>();
  readonly innerRadius = input<number | string>();
  readonly outerRadius = input<number | string>();
  readonly startAngle = input<number>();
  readonly endAngle = input<number>();
  readonly cornerRadius = input<number>();
  readonly paddingAngle = input<number>();
  readonly showLabelLines = input<boolean>();
  readonly height = input<number>();
  readonly showLegend = input<boolean>();
  readonly showGrid = input<boolean>();
  readonly showTooltip = input<boolean>();
  readonly showValueLabels = input<boolean>();
  readonly format = input<ChartProps["format"]>();
  readonly currency = input<string>();
  readonly title = input<string>();

  readonly #element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #loader = inject(GENERATIVE_UI_CHART_LOADER);
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly canvas =
    viewChild<ElementRef<HTMLCanvasElement>>("canvas");
  protected readonly status = signal<"loading" | "ready" | "fallback">(
    "loading",
  );
  #chartLib: ChartConstructor | undefined;

  protected readonly captionStyle: StyleMap = {
    ...textFont("sm"),
    fontWeight: FONT_WEIGHT.semibold,
    marginBottom: "8px",
  };
  /** The previous props while the new ones have the same JSON, so the chart does not redraw for nothing. */
  protected readonly props = computed<ChartProps>(
    () => ({
      chartType: this.chartType(),
      data: this.data(),
      xKey: this.xKey(),
      series: this.series(),
      stacked: this.stacked(),
      layout: this.layout(),
      yAxis: this.yAxis(),
      showDots: this.showDots(),
      barRadius: this.barRadius(),
      innerRadius: this.innerRadius(),
      outerRadius: this.outerRadius(),
      startAngle: this.startAngle(),
      endAngle: this.endAngle(),
      cornerRadius: this.cornerRadius(),
      paddingAngle: this.paddingAngle(),
      showLabelLines: this.showLabelLines(),
      height: this.height(),
      showLegend: this.showLegend(),
      showGrid: this.showGrid(),
      showTooltip: this.showTooltip(),
      showValueLabels: this.showValueLabels(),
      format: this.format(),
      currency: this.currency(),
      title: this.title(),
    }),
    { equal: jsonEqual },
  );
  protected readonly heightPx = computed(
    () => `${this.height() ?? DEFAULT_HEIGHT}px`,
  );
  protected readonly areaStyle = computed<StyleMap>(() => ({
    minHeight: this.heightPx(),
    height: this.status() === "ready" ? this.heightPx() : undefined,
    width: "100%",
    overflowX: "auto",
  }));
  protected readonly placeholderStyle = computed<StyleMap>(() => ({
    height: this.heightPx(),
    borderRadius: "8px",
    background: backgroundColor("surface-secondary"),
  }));

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
    const loader = this.#loader;
    if (!loader || !this.#isBrowser) {
      this.status.set("fallback");
    } else {
      let isActive = true;
      inject(DestroyRef).onDestroy(() => (isActive = false));
      loader().then(
        (module) => {
          if (!isActive) return;
          const record = module as { Chart?: unknown; default?: unknown };
          const ctor = record.Chart ?? record.default;
          if (typeof ctor !== "function") {
            this.status.set("fallback");
            return;
          }
          this.#chartLib = ctor as ChartConstructor;
          this.status.set("ready");
        },
        () => {
          if (isActive) this.status.set("fallback");
        },
      );
    }
    effect((onCleanup) => {
      const status = this.status();
      const canvas = this.canvas()?.nativeElement;
      const props = this.props();
      const ChartLib = this.#chartLib;
      if (status !== "ready" || !canvas || !ChartLib) return;
      const chart = untracked(() => {
        try {
          return new ChartLib(canvas, chartConfig(props, this.#element));
        } catch {
          this.status.set("fallback");
          return undefined;
        }
      });
      onCleanup(() => chart?.destroy());
    });
  }
}
