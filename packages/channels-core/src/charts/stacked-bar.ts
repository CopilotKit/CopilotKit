import { createElement as h } from "react";
import type { ReactElement } from "react";
import {
  DEFAULT_CHART_COLORS,
  extent,
  finiteOr0,
  formatCompact,
} from "./types.js";
import type { ChartStyleProps } from "./types.js";

export interface StackedDatum {
  label: string;
  /** One value per series (series i uses colors[i % colors.length], wrapping when there are more series than colors). */
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
  const values = data.map((d) => d.values.map((v) => finiteOr0(v)));
  const totals = values.map((vs) => vs.reduce((a, b) => a + b, 0));
  const { max: totalMax } = extent(totals);
  const max = Math.max(1, totalMax);
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
          // Total value above the stack — a readable y-value without an axis.
          h(
            "div",
            {
              className: labelClassName,
              style: { fontSize: 12, fontWeight: 600, marginBottom: 4 },
            },
            formatCompact(totals[i]!),
          ),
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
            ...values[i]!.map((v, s) =>
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
