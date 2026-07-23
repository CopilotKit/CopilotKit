import { createElement as h } from "react";
import type { ReactElement } from "react";
import { DEFAULT_CHART_COLORS } from "./types.js";
import type { ChartDatum, ChartStyleProps } from "./types.js";

export interface LineChartProps extends ChartStyleProps {
  data: ChartDatum[];
}

/** A single-series line chart (inline SVG). */
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
  const pad = { l: 8, r: 8, t: title ? 28 : 8, b: 24 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const max = Math.max(1, ...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const span = max - min || 1;
  const step = data.length > 1 ? plotW / (data.length - 1) : 0;
  const x = (i: number) => pad.l + i * step;
  const y = (v: number) => pad.t + plotH - ((v - min) / span) * plotH;
  const points = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const grid = showGrid
    ? [0, 0.25, 0.5, 0.75, 1].map((f, i) =>
        h("line", {
          key: `g${i}`,
          x1: pad.l,
          x2: pad.l + plotW,
          y1: pad.t + plotH * f,
          y2: pad.t + plotH * f,
          stroke: gridColor,
          strokeWidth: 1,
        }),
      )
    : [];
  return h(
    "svg",
    {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      className,
      style: { backgroundColor: "#ffffff", ...style },
    },
    title
      ? h(
          "text",
          {
            x: pad.l,
            y: 18,
            className: labelClassName,
            style: { fontSize: 15, fontWeight: 600 },
          },
          title,
        )
      : null,
    ...grid,
    h("polyline", { points, fill: "none", stroke: colors[0], strokeWidth: 2 }),
    ...data.map((d, i) =>
      h("circle", {
        key: `p${i}`,
        cx: x(i),
        cy: y(d.value),
        r: 3,
        fill: colors[0],
      }),
    ),
    ...data.map((d, i) =>
      h(
        "text",
        {
          key: `l${i}`,
          x: x(i),
          y: height - 8,
          textAnchor: "middle",
          className: labelClassName,
          style: { fontSize: 11 },
        },
        d.label,
      ),
    ),
  );
}
