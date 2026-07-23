import { cn } from "@/lib/utils";

/**
 * Minimal trend line. Dependency-free SVG, drawn in a fixed 100×32 viewBox and
 * scaled responsively to its container. Renders a flat baseline when there is
 * not enough data to form a line.
 */
export function Sparkline({
  data,
  className,
  stroke = "var(--chart-1)",
}: {
  data: number[];
  className?: string;
  stroke?: string;
}) {
  const W = 100;
  const H = 32;
  const PAD = 2;
  const n = data.length;

  if (n < 2) {
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className={cn("h-8 w-full", className)}
        aria-hidden
      >
        <line
          x1={PAD}
          y1={H / 2}
          x2={W - PAD}
          y2={H / 2}
          stroke="var(--border)"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (n - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const line = data
    .map(
      (v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`,
    )
    .join(" ");
  const area = `${line} L${x(n - 1).toFixed(2)},${H} L${x(0).toFixed(2)},${H} Z`;
  const gid = `spark-${stroke.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("h-8 w-full", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
