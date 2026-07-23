import type { CSSProperties } from "react";

/** One `(label, value)` datum. */
export interface ChartDatum {
  label: string;
  value: number;
}

/**
 * Default palette: shadcn `--chart-1..5` tokens with neutral hex fallbacks, so
 * charts adopt the app theme when the compiled CSS is passed via render.stylesheets,
 * and still render in color when it isn't. (`var()` + fallback are standard CSS,
 * resolved by Takumi.)
 */
export const DEFAULT_CHART_COLORS: string[] = [
  "var(--chart-1, #6366f1)",
  "var(--chart-2, #22c55e)",
  "var(--chart-3, #f59e0b)",
  "var(--chart-4, #ef4444)",
  "var(--chart-5, #06b6d4)",
];

/** Styling knobs shared by every chart component. */
export interface ChartStyleProps {
  className?: string;
  style?: CSSProperties;
  width?: number;
  height?: number;
  colors?: string[];
  gridColor?: string;
  labelClassName?: string;
  showLegend?: boolean;
  showGrid?: boolean;
  title?: string;
}
