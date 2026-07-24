import { createElement as h } from "react";
import type { ReactElement } from "react";
import {
  DEFAULT_CHART_COLORS,
  extent,
  finiteOr0,
  formatCompact,
} from "./types.js";
import type { ChartDatum, ChartStyleProps } from "./types.js";

export interface LineChartProps extends ChartStyleProps {
  data: ChartDatum[];
}

/**
 * A single-series line chart. The line/grid/points are inline SVG, but every
 * label (title, y-axis scale, x-axis) is HTML — Takumi rasterizes HTML text but
 * NOT SVG `<text>`, so labels drawn inside the `<svg>` would be invisible. The
 * SVG is a fixed-size plot; HTML title/axes are laid out around it.
 */
export function LineChart(props: LineChartProps): ReactElement {
  const {
    data,
    colors = DEFAULT_CHART_COLORS,
    width = 480,
    height = 240,
    title,
    className,
    style,
    labelClassName,
    gridColor = "#e5e7eb",
    showGrid = true,
  } = props;
  const palette = colors && colors.length > 0 ? colors : DEFAULT_CHART_COLORS;

  // Reserve HTML gutters for the labels, then the SVG fills what's left.
  const titleH = title ? 26 : 0;
  const xAxisH = 22;
  const yAxisW = 48;
  const svgW = Math.max(1, width - yAxisW);
  const svgH = Math.max(1, height - titleH - xAxisH);
  const inset = 8; // keeps the line/points off the plot edges

  const plotW = Math.max(1, svgW - inset * 2);
  const plotH = Math.max(1, svgH - inset * 2);
  const vals = data.map((d) => finiteOr0(d.value));
  // Auto-scale to the data's own min/max (parity with Sparkline/Scatter).
  const { min, max } = extent(vals);
  const span = max - min || 1;
  const step = data.length > 1 ? plotW / (data.length - 1) : 0;
  const px = (i: number) => inset + i * step;
  const py = (v: number) => inset + plotH - ((v - min) / span) * plotH;
  const points = vals.map((v, i) => `${px(i)},${py(v)}`).join(" ");

  const gridFractions = [0, 0.25, 0.5, 0.75, 1];
  const grid = showGrid
    ? gridFractions.map((f, i) =>
        h("line", {
          key: `g${i}`,
          x1: 0,
          x2: svgW,
          y1: inset + plotH * f,
          y2: inset + plotH * f,
          strokeWidth: 1,
          style: { stroke: gridColor },
        }),
      )
    : [];

  const svg = h(
    "svg",
    { width: svgW, height: svgH, viewBox: `0 0 ${svgW} ${svgH}` },
    ...grid,
    h("polyline", {
      points,
      strokeWidth: 2,
      style: { fill: "none", stroke: palette[0] },
    }),
    ...vals.map((v, i) =>
      h("circle", {
        key: `p${i}`,
        cx: px(i),
        cy: py(v),
        r: 3,
        style: { fill: palette[0] },
      }),
    ),
  );

  // HTML y-axis: top label is `max`, bottom is `min`, spaced to the gridlines.
  const yAxis = h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: yAxisW,
        height: svgH,
        paddingRight: 6,
        boxSizing: "border-box",
      },
    },
    ...gridFractions.map((f, i) =>
      h(
        "div",
        {
          key: `y${i}`,
          className: labelClassName,
          style: { fontSize: 11, textAlign: "right" },
        },
        formatCompact(max - f * span),
      ),
    ),
  );

  // HTML x-axis: one evenly-spaced label per datum, under the plot.
  const xAxis = h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "row",
        height: xAxisH,
        paddingLeft: yAxisW,
      },
    },
    ...data.map((d, i) =>
      h(
        "div",
        {
          key: `x${i}`,
          className: labelClassName,
          style: { flex: 1, fontSize: 11, textAlign: "center" },
        },
        d.label,
      ),
    ),
  );

  return h(
    "div",
    {
      className,
      style: {
        display: "flex",
        flexDirection: "column",
        width,
        height,
        backgroundColor: "#ffffff",
        ...style,
      },
    },
    title
      ? h(
          "div",
          {
            className: labelClassName,
            style: { height: titleH, fontSize: 15, fontWeight: 600 },
          },
          title,
        )
      : null,
    h(
      "div",
      { style: { display: "flex", flexDirection: "row", height: svgH } },
      yAxis,
      svg,
    ),
    xAxis,
  );
}
