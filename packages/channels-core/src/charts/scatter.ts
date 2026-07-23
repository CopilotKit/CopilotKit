import { createElement as h } from "react";
import type { ReactElement } from "react";
import { DEFAULT_CHART_COLORS } from "./types.js";
import type { ChartStyleProps } from "./types.js";

export interface ScatterPoint {
  x: number;
  y: number;
}
export interface ScatterProps extends ChartStyleProps {
  points: ScatterPoint[];
}

/** A scatter plot (inline SVG circles). */
export function Scatter(props: ScatterProps): ReactElement {
  const {
    points,
    colors = DEFAULT_CHART_COLORS,
    width = 360,
    height = 240,
    className,
    style,
    gridColor = "#e5e7eb",
    showGrid = true,
  } = props;
  const pad = 12;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const px = (x: number) => pad + ((x - xMin) / xSpan) * (width - pad * 2);
  const py = (y: number) =>
    height - pad - ((y - yMin) / ySpan) * (height - pad * 2);
  const grid = showGrid
    ? [0.25, 0.5, 0.75].map((f, i) =>
        h("line", {
          key: i,
          x1: pad,
          x2: width - pad,
          y1: pad + (height - pad * 2) * f,
          y2: pad + (height - pad * 2) * f,
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
    ...grid,
    ...points.map((p, i) =>
      h("circle", { key: i, cx: px(p.x), cy: py(p.y), r: 4, fill: colors[0] }),
    ),
  );
}
