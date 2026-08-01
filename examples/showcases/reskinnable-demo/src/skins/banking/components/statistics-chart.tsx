import { useId, useMemo, useRef, useState } from "react";
import { formatCurrency } from "@/lib/utils";

interface StatisticsChartProps {
  /** Series of values, oldest → newest. At least 2 points recommended. */
  data: number[];
  /** Optional labels aligned with `data` (e.g. month abbreviations). */
  labels?: string[];
  /** Width/height of the drawing surface in px (viewBox units). */
  width?: number;
  height?: number;
  className?: string;
}

/** Compact dollar label for axis ticks: $6.4k, $980. */
const fmtCompact = (v: number): string =>
  Math.abs(v) >= 1000
    ? `$${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`
    : formatCurrency(v);

/**
 * Lightweight hand-rolled SVG area + line chart — no charting dependency.
 * Violet→indigo gradient stroke over a soft area fill, with a labelled y-axis
 * (three $-gridlines), x-axis labels, and an interactive hover: moving the
 * pointer across the chart highlights the nearest point and shows its exact
 * label + amount in a tooltip. The caller feeds it numbers derived from real
 * data (falls back to seeded points).
 */
export function StatisticsChart({
  data,
  labels,
  width = 320,
  height = 140,
  className,
}: StatisticsChartProps) {
  const gradientId = useId();
  const areaId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  // Left gutter reserves room for the y-axis dollar labels.
  const padL = 40;
  const padR = 10;
  const padY = 16;

  const { linePath, areaPath, points, ticks } = useMemo(() => {
    const series = data.length >= 2 ? data : [0, 0];
    const innerW = width - padL - padR;
    const innerH = height - padY * 2;

    const maxV = Math.max(...series);
    const minV = Math.min(...series);
    const span = maxV - minV || 1;

    const toY = (value: number) =>
      padY + innerH - ((value - minV) / span) * innerH;

    const pts = series.map((value, i) => ({
      x: padL + (innerW * i) / (series.length - 1),
      y: toY(value),
      value,
    }));

    // Smooth-ish line via simple cubic segments between consecutive points.
    const toPath = (nodes: typeof pts) =>
      nodes
        .map((p, i) => {
          if (i === 0) return `M ${p.x} ${p.y}`;
          const prev = nodes[i - 1];
          const cx = (prev.x + p.x) / 2;
          return `C ${cx} ${prev.y} ${cx} ${p.y} ${p.x} ${p.y}`;
        })
        .join(" ");

    const line = toPath(pts);
    const area = `${line} L ${pts[pts.length - 1].x} ${height - padY} L ${pts[0].x} ${height - padY} Z`;

    // Three horizontal gridlines: min, midpoint, max of the series.
    const tickValues = [minV, minV + span / 2, maxV];
    const axisTicks = tickValues.map((value) => ({ value, y: toY(value) }));

    return { linePath: line, areaPath: area, points: pts, ticks: axisTicks };
  }, [data, width, height]);

  const last = points[points.length - 1];
  const active = hovered != null ? points[hovered] : null;

  // Map pointer x (container px) to the nearest data point. Points are evenly
  // spaced, so a proportional index lookup is exact.
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el || points.length < 2) return;
    const rect = el.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const innerW = width - padL - padR;
    const idx = Math.round(((relX - padL) / innerW) * (points.length - 1));
    setHovered(Math.max(0, Math.min(points.length - 1, idx)));
  };

  return (
    <div className={className}>
      <div
        ref={wrapRef}
        className="relative"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHovered(null)}
        data-testid="statistics-chart"
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label="Spending statistics trend"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="hsl(252 83% 67%)" />
              <stop offset="100%" stopColor="hsl(248 84% 60%)" />
            </linearGradient>
            <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(252 83% 67% / 0.28)" />
              <stop offset="100%" stopColor="hsl(252 83% 67% / 0)" />
            </linearGradient>
          </defs>

          {/* Y-axis gridlines + compact dollar labels */}
          {ticks.map((tick) => (
            <g key={tick.y}>
              <line
                x1={padL}
                x2={width - padR}
                y1={tick.y}
                y2={tick.y}
                stroke="currentColor"
                className="text-hairline"
                strokeDasharray="3 4"
                strokeWidth={1}
              />
              <text
                x={padL - 6}
                y={tick.y + 3}
                textAnchor="end"
                fontSize={10}
                fill="currentColor"
                className="text-ink-muted"
              >
                {fmtCompact(tick.value)}
              </text>
            </g>
          ))}

          <path d={areaPath} fill={`url(#${areaId})`} />
          <path
            d={linePath}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Hover guide: vertical line + highlighted point */}
          {active && (
            <>
              <line
                x1={active.x}
                x2={active.x}
                y1={padY}
                y2={height - padY}
                stroke="hsl(248 84% 60% / 0.35)"
                strokeWidth={1}
              />
              <circle
                cx={active.x}
                cy={active.y}
                r={5}
                fill="white"
                stroke="hsl(248 84% 60%)"
                strokeWidth={2.5}
              />
            </>
          )}

          {/* Emphasized latest point (hidden while hovering another) */}
          {last && (!active || active === last) && (
            <circle
              cx={last.x}
              cy={last.y}
              r={6}
              fill="white"
              stroke="hsl(248 84% 60%)"
              strokeWidth={3}
            />
          )}
        </svg>

        {/* Tooltip: exact label + amount for the hovered point */}
        {active && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs shadow-soft"
            style={{
              left: `${(active.x / width) * 100}%`,
              top: `${(active.y / height) * 100}%`,
              marginTop: "-8px",
            }}
            data-testid="statistics-chart-tooltip"
          >
            {hovered != null && labels?.[hovered] ? (
              <span className="mr-1.5 text-ink-muted">{labels[hovered]}</span>
            ) : null}
            <span className="font-semibold text-ink">
              {formatCurrency(active.value)}
            </span>
          </div>
        )}
      </div>

      {/* X-axis labels, in HTML for crisp text; aligned under the plot area. */}
      <div
        className="mt-2 flex items-center justify-between text-[0.7rem] text-ink-muted"
        style={{
          paddingLeft: `${(padL / width) * 100}%`,
          paddingRight: `${(padR / width) * 100}%`,
        }}
      >
        {(labels ?? []).map((label, i) => (
          <span
            key={`${label}-${i}`}
            className={
              i === (labels?.length ?? 0) - 1
                ? "font-semibold text-brand-indigo dark:text-brand-violet"
                : undefined
            }
          >
            {label}
          </span>
        ))}
      </div>
      <p className="sr-only">
        Latest {formatCurrency(last?.value ?? 0)}; range{" "}
        {formatCurrency(Math.min(...data))}–{formatCurrency(Math.max(...data))}.
      </p>
    </div>
  );
}
