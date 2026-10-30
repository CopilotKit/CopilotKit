"use client";

import { useMemo, useRef } from "react";
import {
  Chart as KumoChart,
  ChartLegend,
  ChartPalette,
  Text as KumoText,
} from "@cloudflare/kumo";
import type { KumoChartOption } from "@cloudflare/kumo";
import { useGenerativeUIAccessibility } from "@copilotkit/react-core/v2/generative-ui";
import { legendItemsOf, makeFormatter, toEChartsOption } from "./chart-option";
import type { ChartOption } from "./chart-option";
import { echarts } from "./echarts";
import { VISUALLY_HIDDEN } from "./style";
import type { StandardProps } from "./types";

const DEFAULT_HEIGHT = 240;
/**
 * A new chart type replaces the series instead of merging into them. One
 * object for every render: Kumo's Chart sets the option again whenever
 * this prop changes identity.
 */
const UPDATE_BEHAVIOR = { notMerge: true, lazyUpdate: true };
const PALETTE = [0, 1, 2, 3, 4, 5].map((index) =>
  ChartPalette.categorical(index, false),
);

/**
 * The previous value while the new one has the same JSON. A streaming
 * surface gives the chart new props objects with the same content; ECharts
 * should only redraw when the content changes.
 */
function useStableValue<Value>(value: Value) {
  const ref = useRef<{ value: Value; key: string } | null>(null);
  const key = JSON.stringify(value);
  if (ref.current === null || ref.current.key !== key) {
    ref.current = { value, key };
  }
  return ref.current.value;
}

/**
 * The chart data as a table for screen readers, like the standard Chart:
 * the canvas has no text. Each row is a category (or a slice), each column
 * a series.
 */
function ChartDataTable({
  option,
  title,
  xKey,
  format,
}: {
  option: ChartOption;
  title: string | undefined;
  xKey: string | undefined;
  format: ((value: unknown) => string) | undefined;
}) {
  const show = (value: unknown) =>
    format
      ? format(value)
      : value === null || value === undefined
        ? ""
        : String(value);
  const first = option.series[0];
  if (!first) return null;
  const isPie = first.type === "pie";
  const categoryAxis =
    option.xAxis?.type === "category" ? option.xAxis : option.yAxis;
  const rows: Array<{ label: string; values: unknown[] }> = isPie
    ? (first.data as Array<{ name: string; value: unknown }>).map((slice) => ({
        label: slice.name,
        values: [slice.value],
      }))
    : (
        categoryAxis?.data ??
        first.data.map((point) =>
          Array.isArray(point) ? String(point[0]) : "",
        )
      ).map((label, index) => ({
        label,
        values: option.series.map((series) => {
          const point = series.data[index];
          return Array.isArray(point) ? point[1] : point;
        }),
      }));
  return (
    <table style={VISUALLY_HIDDEN}>
      <caption>{title ?? "Chart data"}</caption>
      <thead>
        <tr>
          <th scope="col">{xKey ?? ""}</th>
          {option.series.map((series) => (
            <th key={series.name} scope="col">
              {series.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.label}-${index}`}>
            <th scope="row">{row.label}</th>
            {row.values.map((value, column) => (
              <td key={column}>{show(value)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Chart: Kumo's ECharts Chart, with the standard chart types and props,
 * Kumo's categorical palette and a Kumo legend.
 */
export function Chart(props: StandardProps<"Chart">) {
  const aria = useGenerativeUIAccessibility();
  const stable = useStableValue(props);
  const option = useMemo(() => toEChartsOption(stable, PALETTE), [stable]);
  const format = useMemo(
    () => makeFormatter(stable.format, stable.currency),
    [stable.format, stable.currency],
  );
  const legend = useMemo(() => legendItemsOf(option, format), [option, format]);
  const showLegend = (props.showLegend ?? true) && legend.length > 0;
  return (
    <figure
      {...aria}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "100%",
        minWidth: 0,
        margin: 0,
      }}
    >
      {props.title ? (
        <KumoText variant="heading" as="h4">
          {props.title}
        </KumoText>
      ) : null}
      <KumoChart
        echarts={echarts}
        options={option as unknown as KumoChartOption}
        optionUpdateBehavior={UPDATE_BEHAVIOR}
        height={props.height ?? DEFAULT_HEIGHT}
        isDarkMode={false}
      />
      {showLegend ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
          {legend.map((item) => (
            <ChartLegend.SmallItem
              key={item.name}
              name={item.name}
              color={item.color}
              value={item.value}
            />
          ))}
        </div>
      ) : null}
      <ChartDataTable
        option={option}
        title={props.title}
        xKey={props.xKey}
        format={format}
      />
    </figure>
  );
}

export const chartOverrides = { Chart: { component: Chart } };
