"use client";

import type { DemandRow } from "@/lib/leads/derive";

interface DonutProps {
  rows: DemandRow[];
  size?: number;
  thickness?: number;
  colorFor: (label: string) => string;
}

/**
 * Pure-SVG donut. Each slice's fraction maps to an arc; we render with
 * stroke-dasharray on a single circle per slice, rotated to its offset.
 */
export function Donut({ rows, size = 160, thickness = 18, colorFor }: DonutProps) {
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2;
  const cy = size / 2;

  let offset = 0;
  const slices = rows.map((r) => {
    const fraction = total === 0 ? 0 : r.count / total;
    const dash = circumference * fraction;
    const gap = circumference - dash;
    const start = offset;
    offset += fraction;
    return { row: r, dash, gap, rotate: start * 360 };
  });

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          className="stroke-muted"
          strokeWidth={thickness}
        />
        {slices.map((s, i) => (
          <circle
            key={s.row.label + i}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            className={colorFor(s.row.label)}
            strokeWidth={thickness}
            strokeDasharray={`${s.dash} ${s.gap}`}
            strokeLinecap="butt"
            transform={`rotate(${s.rotate - 90} ${cx} ${cy})`}
          />
        ))}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground text-xl font-semibold"
        >
          {total}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-muted-foreground text-[10px] uppercase tracking-wider"
        >
          leads
        </text>
      </svg>
      <ul className="flex flex-col gap-1.5 text-xs">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            <span
              className={`size-2.5 rounded-full ${colorFor(r.label).replace("stroke-", "bg-")}`}
            />
            <span className="text-muted-foreground">{r.label}</span>
            <span className="ml-auto pl-3 font-medium tabular-nums text-foreground">
              {r.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
