import { cn } from "@/lib/utils";

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/**
 * Donut chart with a side legend showing each slice's value. Dependency-free
 * SVG. Slice colors fall back to the blue-led chart palette, cycling for >5
 * slices. Renders an empty ring when the total is zero.
 */
export function DonutChart({
  data,
  centerLabel,
  centerValue,
  className,
}: {
  data: { label: string; value: number; color?: string }[];
  centerLabel?: string;
  centerValue?: string;
  className?: string;
}) {
  const SIZE = 160;
  const R = 64;
  const STROKE = 22;
  const C = SIZE / 2;
  const circumference = 2 * Math.PI * R;
  const total = data.reduce((s, d) => s + d.value, 0);

  let offset = 0;

  return (
    <div className={cn("flex flex-wrap items-center gap-5", className)}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-40 w-40 shrink-0"
        role="img"
      >
        {/* track */}
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke="var(--border)"
          strokeWidth={STROKE}
          opacity={0.4}
        />
        {total > 0 &&
          data.map((d, i) => {
            const frac = d.value / total;
            const len = frac * circumference;
            const dash = `${len} ${circumference - len}`;
            const seg = (
              <circle
                key={i}
                cx={C}
                cy={C}
                r={R}
                fill="none"
                stroke={d.color ?? PALETTE[i % PALETTE.length]}
                strokeWidth={STROKE}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${C} ${C})`}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return seg;
          })}
        {(centerValue || centerLabel) && (
          <>
            {centerValue && (
              <text
                x={C}
                y={C - 1}
                textAnchor="middle"
                fontSize={20}
                className="fill-foreground tabular-nums"
                fontWeight={600}
              >
                {centerValue}
              </text>
            )}
            {centerLabel && (
              <text
                x={C}
                y={C + 16}
                textAnchor="middle"
                fontSize={10}
                className="fill-muted-foreground"
              >
                {centerLabel}
              </text>
            )}
          </>
        )}
      </svg>

      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {data.length === 0 && (
          <li className="text-muted-foreground">No data yet</li>
        )}
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{
                backgroundColor: d.color ?? PALETTE[i % PALETTE.length],
              }}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {d.label}
            </span>
            <span className="shrink-0 font-medium tabular-nums">
              {Intl.NumberFormat("en-US", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(d.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
