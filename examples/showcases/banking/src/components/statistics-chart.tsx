import { useId, useMemo } from "react";
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

/**
 * Lightweight hand-rolled SVG area + line "sparkline" — no charting dependency.
 * Renders a violet→indigo gradient stroke over a soft gradient area fill, with
 * the most recent point emphasized and labelled. Purely presentational; the
 * caller feeds it numbers derived from real data (falls back to seeded points).
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

  const { linePath, areaPath, points, max, min } = useMemo(() => {
    const series = data.length >= 2 ? data : [0, 0];
    const padX = 8;
    const padY = 16;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;

    const maxV = Math.max(...series);
    const minV = Math.min(...series);
    const span = maxV - minV || 1;

    const pts = series.map((value, i) => {
      const x = padX + (innerW * i) / (series.length - 1);
      // Invert Y (SVG origin is top-left); keep a little headroom.
      const y = padY + innerH - ((value - minV) / span) * innerH;
      return { x, y, value };
    });

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

    return {
      linePath: line,
      areaPath: area,
      points: pts,
      max: maxV,
      min: minV,
    };
  }, [data, width, height]);

  const last = points[points.length - 1];

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label="Spending statistics trend"
        preserveAspectRatio="none"
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

        <path d={areaPath} fill={`url(#${areaId})`} />
        <path
          d={linePath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Emphasized latest point */}
        {last && (
          <>
            <circle
              cx={last.x}
              cy={last.y}
              r={6}
              fill="white"
              stroke="hsl(248 84% 60%)"
              strokeWidth={3}
            />
          </>
        )}
      </svg>

      {/* Emphasized value label + axis labels, in HTML for crisp text. */}
      <div className="mt-2 flex items-center justify-between text-[0.7rem] text-ink-muted">
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
        {formatCurrency(min)}–{formatCurrency(max)}.
      </p>
    </div>
  );
}
