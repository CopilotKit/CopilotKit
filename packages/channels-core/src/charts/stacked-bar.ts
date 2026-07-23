import { createElement as h } from "react";
import type { ReactElement } from "react";
import { DEFAULT_CHART_COLORS } from "./types.js";
import type { ChartStyleProps } from "./types.js";

export interface StackedDatum {
  label: string;
  /** One value per series (series i uses colors[i]). */
  values: number[];
}
export interface StackedBarProps extends ChartStyleProps {
  data: StackedDatum[];
}

/** A stacked vertical bar chart (box model). */
export function StackedBar(props: StackedBarProps): ReactElement {
  const {
    data,
    colors = DEFAULT_CHART_COLORS,
    title,
    className,
    style,
    labelClassName,
  } = props;
  const palette = colors && colors.length > 0 ? colors : DEFAULT_CHART_COLORS;
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...totals);
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
          h(
            "div",
            {
              style: {
                width: "100%",
                height: `${Math.max(0, (totals[i]! / max) * 100)}%`,
                display: "flex",
                flexDirection: "column-reverse",
                borderRadius: 4,
                overflow: "hidden",
              },
            },
            ...d.values.map((v, s) =>
              h("div", {
                key: s,
                style: {
                  height: `${totals[i]! > 0 ? Math.max(0, (v / totals[i]!) * 100) : 0}%`,
                  backgroundColor: palette[s % palette.length],
                },
              }),
            ),
          ),
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
