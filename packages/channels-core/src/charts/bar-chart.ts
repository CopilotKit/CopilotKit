import { createElement as h } from "react";
import type { ReactElement } from "react";
import { DEFAULT_CHART_COLORS, extent, finiteOr0 } from "./types.js";
import type { ChartDatum, ChartStyleProps } from "./types.js";

export interface BarChartProps extends ChartStyleProps {
  data: ChartDatum[];
}

/** A vertical bar chart drawn with the CSS box model (no browser, no SVG). */
export function BarChart(props: BarChartProps): ReactElement {
  const {
    data,
    colors = DEFAULT_CHART_COLORS,
    title,
    className,
    style,
    labelClassName,
  } = props;
  const palette = colors && colors.length > 0 ? colors : DEFAULT_CHART_COLORS;
  const vals = data.map((d) => finiteOr0(d.value));
  const { max } = extent(vals);
  const safeMax = max > 0 ? max : 1;
  return h(
    "div",
    {
      className,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "100%",
        height: "100%",
        backgroundColor: "#ffffff",
        padding: 16,
        ...style,
      },
    },
    title
      ? h(
          "div",
          {
            className: labelClassName,
            style: { fontSize: 16, fontWeight: 600 },
          },
          title,
        )
      : null,
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "flex-end",
          gap: 8,
          flex: 1,
          minHeight: 0,
        },
      },
      ...data.map((d, i) =>
        h(
          "div",
          {
            key: i,
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              flex: 1,
              height: "100%",
            },
          },
          h("div", {
            style: {
              width: "100%",
              height: `${Math.max(0, (finiteOr0(d.value) / safeMax) * 100)}%`,
              backgroundColor: palette[i % palette.length],
              borderRadius: 4,
            },
          }),
          h(
            "div",
            {
              className: labelClassName,
              style: { fontSize: 12, marginTop: 4 },
            },
            d.label,
          ),
        ),
      ),
    ),
  );
}
