import type { CSSProperties } from "react";

/** One `(label, value)` datum. */
export interface ChartDatum {
  label: string;
  value: number;
}

/**
 * Fixed default palette. The image renderer (Takumi) does not resolve CSS
 * `var()`/theme tokens for SVG `stroke`/`fill` (or for `backgroundColor` on
 * box-model charts in a theme-independent way), so these are plain hex
 * values rather than shadcn `--chart-N` custom properties. Pass your own
 * `colors` prop per chart to theme it explicitly.
 */
export const DEFAULT_CHART_COLORS: readonly string[] = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
];

/**
 * Styling knobs shared by every chart component. Not every field is honored
 * by every chart: BarChart/StackedBar fill their container and ignore both
 * `width` and `height`; Meter also fills its container width-wise and
 * ignores `width`, but honors `height` as the bar's thickness; the SVG
 * charts (LineChart/PieChart/Scatter/Sparkline) honor both `width` and
 * `height` as the canvas size. `gridColor`/`showGrid` apply only to the SVG
 * cartesian charts (LineChart/Scatter); `title` is honored by
 * BarChart/StackedBar/LineChart/PieChart/Scatter, not Meter/Sparkline.
 */
export interface ChartStyleProps {
  className?: string;
  style?: CSSProperties;
  width?: number;
  height?: number;
  colors?: string[];
  gridColor?: string;
  labelClassName?: string;
  showGrid?: boolean;
  title?: string;
}
