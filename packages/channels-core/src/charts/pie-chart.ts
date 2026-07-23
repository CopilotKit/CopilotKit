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
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 8;
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
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
  // A single full slice can't be drawn as an arc (start==end); draw a full circle.
  if (data.length === 1) {
    return h(
      "div",
      {
        className,
        style: { display: "flex", flexDirection: "column", gap: 8, ...style },
      },
      titleEl,
      h(
        "svg",
        {
          width,
          height,
          viewBox: `0 0 ${width} ${height}`,
          style: { backgroundColor: "#ffffff" },
        },
        h("circle", { cx, cy, r, fill: colors[0] }),
      ),
    );
  }
  const slices = data.map((d, i) => {
    const a0 = a;
    a += (d.value / total) * Math.PI * 2;
    return h("path", {
      key: i,
      d: arcPath(cx, cy, r, a0, a),
      fill: colors[i % colors.length],
    });
  });
  return h(
    "div",
    {
      className,
      style: { display: "flex", flexDirection: "column", gap: 8, ...style },
    },
    titleEl,
    h(
      "svg",
      {
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        style: { backgroundColor: "#ffffff" },
      },
      ...slices,
    ),
  );
}
