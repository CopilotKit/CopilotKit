import { createElement as h } from "react";
import type { ReactElement } from "react";
import { DEFAULT_CHART_COLORS, finiteOr0 } from "./types.js";
import type { ChartStyleProps } from "./types.js";

export interface MeterProps extends ChartStyleProps {
  /** Fraction 0..1 (values outside are clamped). */
  value: number;
  /** Optional right-aligned caption (e.g. "72%"). */
  caption?: string;
}

/** A horizontal progress meter (box model). */
export function Meter(props: MeterProps): ReactElement {
  const {
    value,
    colors = DEFAULT_CHART_COLORS,
    height = 12,
    className,
    style,
    caption,
    labelClassName,
  } = props;
  const palette = colors && colors.length > 0 ? colors : DEFAULT_CHART_COLORS;
  const pct = Math.max(0, Math.min(1, finiteOr0(value))) * 100;
  return h(
    "div",
    {
      className,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        width: "100%",
        ...style,
      },
    },
    caption
      ? h(
          "div",
          {
            className: labelClassName,
            style: { fontSize: 12, textAlign: "right" },
          },
          caption,
        )
      : null,
    h(
      "div",
      {
        style: {
          width: "100%",
          height,
          backgroundColor: "#e5e7eb",
          borderRadius: 999,
          overflow: "hidden",
        },
      },
      h("div", {
        style: {
          width: `${pct}%`,
          height: "100%",
          backgroundColor: palette[0],
        },
      }),
    ),
  );
}
