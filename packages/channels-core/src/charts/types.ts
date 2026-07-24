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

/** Coerce a chart value to a finite number (non-finite → 0) so one bad datum can't poison a scale. */
export function finiteOr0(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Min and max of a numeric array in a single pass (a `for` loop), instead of
 * `Math.min(...nums)`/`Math.max(...nums)` — spreading a large array onto the
 * call stack can `RangeError` on huge inputs. Returns `{ min: 0, max: 0 }` for
 * an empty array; each caller applies its own fallback (e.g. a `span || 1`
 * guard, or `max > 0 ? max : 1`) to match its existing empty handling.
 */
export function extent(nums: readonly number[]): { min: number; max: number } {
  if (nums.length === 0) return { min: 0, max: 0 };
  let min = nums[0]!;
  let max = nums[0]!;
  for (let i = 1; i < nums.length; i++) {
    const n = nums[i]!;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  return { min, max };
}

/**
 * Compact number for axis/value labels: 1_500 → "1.5k", 2_400_000 → "2.4M",
 * smaller values rounded to an integer. Keeps labels short so they don't
 * overflow a bar or the y-axis gutter.
 */
export function formatCompact(n: number): string {
  const v = finiteOr0(n);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

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
  colors?: readonly string[];
  gridColor?: string;
  labelClassName?: string;
  showGrid?: boolean;
  title?: string;
}
