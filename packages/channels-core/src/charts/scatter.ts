import { createElement as h } from "react";
import type { ReactElement } from "react";
import { DEFAULT_CHART_COLORS, extent, finiteOr0 } from "./types.js";
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
    title,
    className,
    style,
    labelClassName,
    gridColor = "#e5e7eb",
    showGrid = true,
  } = props;
  const palette = colors && colors.length > 0 ? colors : DEFAULT_CHART_COLORS;
  const pad = 12;
  const titleEl = title
    ? h(
        "div",
        {
          className: labelClassName,
          style: { fontSize: 16, fontWeight: 600 },
        },
        title,
      )
    : null;
  if (points.length === 0) {
    return h(
      "div",
      {
        className,
        // White default on the wrapper div so `style.backgroundColor` (and any
        // other style) overrides uniformly; the inner <svg> stays transparent.
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 8,
          backgroundColor: "#ffffff",
          ...style,
        },
      },
      titleEl,
      h("svg", {
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
      }),
    );
  }
  const pts = points.map((p) => ({ x: finiteOr0(p.x), y: finiteOr0(p.y) }));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const { min: xMin, max: xMax } = extent(xs);
  const { min: yMin, max: yMax } = extent(ys);
  const xDegenerate = xMax === xMin;
  const yDegenerate = yMax === yMin;
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const px = (x: number) =>
    xDegenerate
      ? pad + (width - pad * 2) / 2
      : pad + ((x - xMin) / xSpan) * (width - pad * 2);
  const py = (y: number) =>
    yDegenerate
      ? pad + (height - pad * 2) / 2
      : height - pad - ((y - yMin) / ySpan) * (height - pad * 2);
  const grid = showGrid
    ? [0.25, 0.5, 0.75].map((f, i) =>
        h("line", {
          key: `g${i}`,
          x1: pad,
          x2: width - pad,
          y1: pad + (height - pad * 2) * f,
          y2: pad + (height - pad * 2) * f,
          strokeWidth: 1,
          style: { stroke: gridColor },
        }),
      )
    : [];
  return h(
    "div",
    {
      className,
      // White default on the wrapper div so `style.backgroundColor` (and any
      // other style) overrides uniformly; the inner <svg> stays transparent.
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        backgroundColor: "#ffffff",
        ...style,
      },
    },
    titleEl,
    h(
      "svg",
      {
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
      },
      ...grid,
      ...pts.map((p, i) =>
        h("circle", {
          key: `p${i}`,
          cx: px(p.x),
          cy: py(p.y),
          r: 4,
          style: { fill: palette[0] },
        }),
      ),
    ),
  );
}
