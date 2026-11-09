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
  FONT_WEIGHT,
  VISUALLY_HIDDEN,
  backgroundColor,
  borderColor,
  chartConfig,
  jsonEqual,
  makeFormatter,
  normalizeSeries,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type {
  ChartConstructor,
  ChartProps,
  StyleMap,
} from "@copilotkit/shared/generative-ui";
import { GenerativeUIStyles } from "../../styles";
import { GENERATIVE_UI_CHART_LOADER } from "../loaders";

const DEFAULT_HEIGHT = 240;

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
    <table
      copilotGenerativeUIChartTable
      [chart]="props()"
      [hidden]="true"
    ></table>
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
