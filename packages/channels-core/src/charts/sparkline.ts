import { createElement as h } from "react";
import type { ReactElement } from "react";
import { DEFAULT_CHART_COLORS } from "./types.js";
import type { ChartStyleProps } from "./types.js";

export interface SparklineProps extends ChartStyleProps {
  /** Series of numbers, plotted left→right. */
  data: number[];
}

/** A compact inline trend line (SVG). Meant to sit inside a larger card. */
export function Sparkline(props: SparklineProps): ReactElement {
  const {
    data,
    colors = DEFAULT_CHART_COLORS,
    width = 120,
    height = 28,
    className,
    style,
  } = props;
  const max = Math.max(...data),
    min = Math.min(...data);
  const span = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const points = data
    .map((v, i) => `${i * step},${height - ((v - min) / span) * height}`)
    .join(" ");
  return h(
    "svg",
    { width, height, viewBox: `0 0 ${width} ${height}`, className, style },
    h("polyline", { points, fill: "none", stroke: colors[0], strokeWidth: 2 }),
  );
}
