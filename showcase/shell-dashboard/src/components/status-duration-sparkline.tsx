"use client";
/**
 * StatusDurationSparkline — pure-SVG inline sparkline for run-duration trend.
 *
 * Convention: `durations` is ordered oldest → newest, so the rightmost
 * point is the most recent run. We pick this orientation so the sparkline
 * reads like time on the x-axis.
 *
 * No external charting deps — just inline SVG so the panel stays cheap and
 * works in static / SSR contexts. Color comes from the parent via
 * `currentColor`, so callers can drive it with Tailwind text utilities.
 */
import type { CSSProperties } from "react";

export interface StatusDurationSparklineProps {
  durations: number[];
  width?: number;
  height?: number;
  /** CSS class applied to the SVG element (defaults to a muted text color). */
  className?: string;
}

const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 24;
const PADDING = 2;

export function StatusDurationSparkline({
  durations,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  className,
}: StatusDurationSparklineProps) {
  const innerW = width - PADDING * 2;
  const innerH = height - PADDING * 2;

  // Fewer than 2 points OR a viewport too small to draw inside —
  // render a flat dash so the layout doesn't collapse and the
  // operator gets an obvious "no data / not enough room" cue. The
  // small-viewport guard prevents negative or zero inner dimensions
  // from producing NaN / out-of-bounds coords downstream.
  if (durations.length < 2 || innerW <= 0 || innerH <= 0) {
    return (
      <svg
        data-testid="status-sparkline"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className ?? "text-[var(--text-muted)]"}
        aria-hidden="true"
      >
        <line
          data-testid="status-sparkline-dash"
          x1={PADDING}
          y1={height / 2}
          x2={Math.max(PADDING, width - PADDING)}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  const min = Math.min(...durations);
  const max = Math.max(...durations);
  const range = max - min;

  const points = durations.map((d, i) => {
    // durations.length >= 2 here (early return covers <2), so the
    // divisor is always positive — no need for the dead length===1
    // branch the original code carried.
    const xFrac = i / (durations.length - 1);
    const x = PADDING + xFrac * innerW;
    // Higher duration → lower y (visually "up"). When the input is flat
    // (range === 0) we center the line vertically rather than dividing
    // by zero.
    const yFrac = range === 0 ? 0.5 : 1 - (d - min) / range;
    const y = PADDING + yFrac * innerH;
    return `${roundCoord(x)},${roundCoord(y)}`;
  });

  const style: CSSProperties = { fill: "none" };

  return (
    <svg
      data-testid="status-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className ?? "text-[var(--text-muted)]"}
      aria-hidden="true"
    >
      <polyline
        data-testid="status-sparkline-polyline"
        points={points.join(" ")}
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
        style={style}
      />
    </svg>
  );
}

/** Round to 2 decimals so the rendered DOM string stays compact and stable. */
function roundCoord(n: number): number {
  return Math.round(n * 100) / 100;
}
