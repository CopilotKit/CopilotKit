import { createElement as h } from "react";
import type { ReactElement } from "react";
import { DEFAULT_CHART_COLORS } from "./types.js";
import type { ChartDatum, ChartStyleProps } from "./types.js";

function arcPath(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
): string {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large},1 ${x1},${y1} Z`;
}

export interface PieChartProps extends ChartStyleProps {
  data: ChartDatum[];
}

/** A pie chart (inline SVG paths with arc commands). */
export function PieChart(props: PieChartProps): ReactElement {
  const {
    data,
    colors = DEFAULT_CHART_COLORS,
    width = 240,
    height = 240,
    title,
    className,
    style,
    labelClassName,
  } = props;
  const palette = colors && colors.length > 0 ? colors : DEFAULT_CHART_COLORS;
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.max(0, Math.min(width, height) / 2 - 8);
  // Pair each datum with its original index in `data` before filtering, so
  // both the single-slice and multi-slice branches below can color by that
  // stable original index rather than the filtered position.
  const positives = data
    .map((d, i) => ({ d, i }))
    .filter((x) => Number.isFinite(x.d.value) && x.d.value > 0);
  let a = -Math.PI / 2;
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
  // No positive data: render an empty canvas rather than misrepresenting
  // "no data" as one full category.
  if (positives.length === 0) {
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
  // A single positive slice can't be drawn as an arc (start==end); draw a
  // full circle instead. Both this branch and the multi-slice branch below
  // color by the slice's original index in `data`, so a datum's color is
  // stable regardless of how many other slices are positive.
  if (positives.length === 1) {
    const sliceColor = palette[positives[0]!.i % palette.length];
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
        h("circle", { cx, cy, r, style: { fill: sliceColor } }),
      ),
    );
  }
  // After the length===0 and length===1 early returns above, at least two
  // positive (finite, >0) values remain, so `total` is always > 0.
  const total = positives.reduce((sum, x) => sum + x.d.value, 0);
  const slices = positives.map(({ d, i }) => {
    const a0 = a;
    a += (d.value / total) * Math.PI * 2;
    return h("path", {
      key: i,
      d: arcPath(cx, cy, r, a0, a),
      style: { fill: palette[i % palette.length] },
    });
  });
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
      ...slices,
    ),
  );
}
