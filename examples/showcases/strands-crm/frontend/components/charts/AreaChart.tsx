"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Smooth area + line chart with x-axis labels and an optional hover dot.
 * Dependency-free SVG: a fixed 600×220 viewBox scaled responsively. The hover
 * tooltip is drawn inside the SVG (viewBox coords) so it scales with the chart.
 */
export function AreaChart({
  data,
  height = 220,
  className,
}: {
  data: { label: string; value: number }[];
  height?: number;
  className?: string;
}) {
  const [active, setActive] = React.useState<number | null>(null);
  const W = 600;
  const H = 220;
  const PAD = { top: 16, right: 16, bottom: 28, left: 16 };
  const n = data.length;

  if (n === 0) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-lg border border-dashed text-sm text-muted-foreground",
          className,
        )}
        style={{ height }}
      >
        No data yet
      </div>
    );
  }

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const x = (i: number) =>
    PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  // Smooth path via Catmull-Rom -> cubic Bézier.
  const pts = data.map((d, i) => [x(i), y(d.value)] as const);
  const smooth = (p: readonly (readonly [number, number])[]) => {
    if (p.length < 2) return `M${p[0][0]},${p[0][1]}`;
    let d = `M${p[0][0]},${p[0][1]}`;
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] ?? p[i];
      const p1 = p[i];
      const p2 = p[i + 1];
      const p3 = p[i + 2] ?? p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    }
    return d;
  };
  const line = smooth(pts);
  const baseY = PAD.top + innerH;
  const area = `${line} L${pts[n - 1][0].toFixed(2)},${baseY} L${pts[0][0].toFixed(2)},${baseY} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("w-full", className)}
      style={{ height }}
      role="img"
      onMouseLeave={() => setActive(null)}
    >
      <defs>
        <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* horizontal gridlines */}
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <line
          key={t}
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + innerH * (1 - t)}
          y2={PAD.top + innerH * (1 - t)}
          stroke="var(--border)"
          strokeWidth={1}
          opacity={0.5}
        />
      ))}

      <path d={area} fill="url(#area-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* x-axis labels */}
      {data.map((d, i) => (
        <text
          key={i}
          x={x(i)}
          y={H - 8}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={11}
        >
          {d.label}
        </text>
      ))}

      {/* hover hit regions + dot */}
      {data.map((d, i) => (
        <rect
          key={i}
          x={x(i) - innerW / (2 * Math.max(1, n))}
          y={PAD.top}
          width={innerW / Math.max(1, n)}
          height={innerH}
          fill="transparent"
          onMouseEnter={() => setActive(i)}
        />
      ))}
      {active !== null && (
        <>
          <line
            x1={x(active)}
            x2={x(active)}
            y1={PAD.top}
            y2={baseY}
            stroke="var(--chart-1)"
            strokeWidth={1}
            opacity={0.4}
          />
          <circle
            cx={x(active)}
            cy={y(data[active].value)}
            r={4}
            fill="var(--chart-1)"
            stroke="white"
            strokeWidth={1.5}
          />
          <g
            transform={`translate(${Math.min(Math.max(x(active), PAD.left + 28), W - PAD.right - 28)}, ${PAD.top})`}
          >
            <rect
              x={-28}
              y={-2}
              width={56}
              height={18}
              rx={4}
              fill="var(--popover)"
              stroke="var(--border)"
            />
            <text
              x={0}
              y={11}
              textAnchor="middle"
              fontSize={11}
              className="fill-foreground tabular-nums"
            >
              {Intl.NumberFormat("en-US", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(data[active].value)}
            </text>
          </g>
        </>
      )}
    </svg>
  );
}
