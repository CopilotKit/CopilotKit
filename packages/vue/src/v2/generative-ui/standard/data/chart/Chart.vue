<script setup lang="ts">
import { computed, h, ref, shallowRef, watch } from "vue";
import type { CSSProperties, FunctionalComponent } from "vue";
import {
  FONT_WEIGHT,
  VISUALLY_HIDDEN,
  backgroundColor,
  borderColor,
  chartConfig,
  isRecord,
  jsonEqual,
  makeFormatter,
  normalizeSeries,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type {
  ChartConstructor,
  ChartProps,
} from "@copilotkit/shared/generative-ui";
import {
  GENERATIVE_UI_CHART_LOADER,
  useGenerativeUILibrary,
} from "../../loaders";
import { useStandardStyles } from "../../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIChart" });

/**
 * A bar, line, area, scatter, pie or donut chart on chart.js, loaded through
 * the `@copilotkit/vue/v2/generative-ui/chart` plugin. Without it, the chart
 * is a data table. The drawing is hidden from screen readers. They read a
 * data table of the same values.
 *
 * The boolean props default to `undefined`, not `false`, so the chart.js
 * config applies its own defaults (a legend, a grid and a tooltip).
 */
const props = withDefaults(
  defineProps<{
    chartType?: ChartProps["chartType"];
    data?: ChartProps["data"];
    xKey?: ChartProps["xKey"];
    series?: ChartProps["series"];
    stacked?: ChartProps["stacked"];
    layout?: ChartProps["layout"];
    yAxis?: ChartProps["yAxis"];
    showDots?: ChartProps["showDots"];
    barRadius?: ChartProps["barRadius"];
    innerRadius?: ChartProps["innerRadius"];
    outerRadius?: ChartProps["outerRadius"];
    startAngle?: ChartProps["startAngle"];
    endAngle?: ChartProps["endAngle"];
    cornerRadius?: ChartProps["cornerRadius"];
    paddingAngle?: ChartProps["paddingAngle"];
    showLabelLines?: ChartProps["showLabelLines"];
    height?: ChartProps["height"];
    showLegend?: ChartProps["showLegend"];
    showGrid?: ChartProps["showGrid"];
    showTooltip?: ChartProps["showTooltip"];
    showValueLabels?: ChartProps["showValueLabels"];
    format?: ChartProps["format"];
    currency?: ChartProps["currency"];
    title?: ChartProps["title"];
  }>(),
  {
    stacked: undefined,
    showDots: undefined,
    showLabelLines: undefined,
    showLegend: undefined,
    showGrid: undefined,
    showTooltip: undefined,
    showValueLabels: undefined,
  },
);

const DEFAULT_HEIGHT = 240;

const FIGURE_STYLE: CSSProperties = {
  position: "relative",
  margin: 0,
  width: "100%",
  minWidth: 0,
};
const CAPTION_STYLE: CSSProperties = {
  ...textFont("sm"),
  fontWeight: FONT_WEIGHT.semibold,
  marginBottom: "8px",
};
const CELL_STYLE: CSSProperties = {
  ...textFont("sm"),
  padding: "4px 8px",
  textAlign: "start",
  borderBottom: `1px solid ${borderColor("subtle")}`,
};
const ROW_HEADER_STYLE: CSSProperties = { ...CELL_STYLE, fontWeight: "normal" };
const TABLE_STYLE: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};
const HIDDEN_TABLE_STYLE: CSSProperties = {
  ...TABLE_STYLE,
  ...VISUALLY_HIDDEN,
};

/** A `chart.js` module exports `Chart`; a bundler may give it as `default`. */
function isChartConstructor(value: unknown): value is ChartConstructor {
  return typeof value === "function";
}

function chartConstructorOf(module: unknown) {
  if (!isRecord(module)) return null;
  const constructor = module.Chart ?? module.default;
  return isChartConstructor(constructor) ? constructor : null;
}

function text(value: unknown) {
  return String(value ?? "");
}

/**
 * The previous props while the new ones have the same JSON, so the chart
 * does not redraw for nothing.
 */
const chart = shallowRef<ChartProps>({ ...props });
watch(
  () => ({ ...props }),
  (next) => {
    if (!jsonEqual(chart.value, next)) chart.value = next;
  },
);

useStandardStyles();
const { library, status } = useGenerativeUILibrary(GENERATIVE_UI_CHART_LOADER);
const chartLib = computed(() => chartConstructorOf(library.value));
/** True when chart.js could not draw: the table takes its place. */
const drawFailed = ref(false);

/** `loading` shows a placeholder, `ready` the canvas, `fallback` the table. */
const view = computed(() => {
  if (status.value === "loading") return "loading";
  const canDraw = chartLib.value !== null && !drawFailed.value;
  return status.value === "ready" && canDraw ? "ready" : "fallback";
});

const heightPx = computed(() => `${props.height ?? DEFAULT_HEIGHT}px`);
const areaStyle = computed<CSSProperties>(() => ({
  minHeight: heightPx.value,
  height: view.value === "ready" ? heightPx.value : undefined,
  width: "100%",
  overflowX: "auto",
}));
const placeholderStyle = computed<CSSProperties>(() => ({
  height: heightPx.value,
  borderRadius: "8px",
  background: backgroundColor("surface-secondary"),
}));

const rows = computed(() => chart.value.data ?? []);
const tableSeries = computed(() =>
  normalizeSeries(chart.value.series, rows.value, chart.value.xKey),
);
const formatValue = computed(
  () => makeFormatter(chart.value.format, chart.value.currency) ?? text,
);

/**
 * The chart data as a table. Screen readers read the visually hidden one
 * next to the chart. It is also the visible chart when chart.js is not
 * there.
 */
const ChartTable: FunctionalComponent<{ visuallyHidden?: boolean }> = (
  tableProps,
) => {
  const xKey = chart.value.xKey;
  const series = tableSeries.value;
  const format = formatValue.value;
  return h(
    "table",
    { style: tableProps.visuallyHidden ? HIDDEN_TABLE_STYLE : TABLE_STYLE },
    [
      h(
        "thead",
        h("tr", [
          xKey ? h("th", { scope: "col", style: CELL_STYLE }, xKey) : null,
          ...series.map((item) =>
            h(
              "th",
              { key: item.key, scope: "col", style: CELL_STYLE },
              item.label,
            ),
          ),
        ]),
      ),
      h(
        "tbody",
        rows.value.map((row, index) =>
          h("tr", { key: index }, [
            xKey
              ? h(
                  "th",
                  { scope: "row", style: ROW_HEADER_STYLE },
                  text(row[xKey]),
                )
              : null,
            ...series.map((item) =>
              h(
                "td",
                { key: item.key, style: CELL_STYLE },
                format(row[item.key]),
              ),
            ),
          ]),
        ),
      ),
    ],
  );
};
ChartTable.props = { visuallyHidden: Boolean };

const figure = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);

// The canvas exists only in the browser, after mount, so the chart is never
// created on the server. A new chart replaces the old one when the props
// change; the last one is destroyed on unmount.
watch(
  [canvas, chart, chartLib],
  ([canvasElement, chartProps, ChartLib], _previous, onCleanup) => {
    const element = figure.value;
    if (!canvasElement || !ChartLib || !element) return;
    try {
      // The figure resolves the color tokens, dark values included.
      const instance = new ChartLib(
        canvasElement,
        chartConfig(chartProps, element),
      );
      onCleanup(() => instance.destroy());
    } catch {
      drawFailed.value = true;
    }
  },
  { flush: "post" },
);
</script>

<template>
  <figure ref="figure" data-a2ui-std="" :style="FIGURE_STYLE">
    <figcaption v-if="props.title" :style="CAPTION_STYLE">
      {{ props.title }}
    </figcaption>
    <div
      aria-hidden="true"
      :data-a2ui-chart="props.chartType ?? 'bar'"
      :style="areaStyle"
    >
      <canvas v-if="view === 'ready'" ref="canvas" />
      <ChartTable v-else-if="view === 'fallback'" />
      <div v-else aria-hidden="true" :style="placeholderStyle" />
    </div>
    <ChartTable visually-hidden />
  </figure>
</template>
