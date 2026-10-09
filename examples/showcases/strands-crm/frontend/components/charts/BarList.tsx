import { cn } from "@/lib/utils";

/**
 * Horizontal ranked bar list (e.g. a rep leaderboard). Each row shows a label,
 * a proportional bar, an optional secondary caption and the formatted value.
 * Pure CSS bars (no SVG needed); `max` overrides the auto-scaled maximum and
 * `format` customizes the value rendering. Subtle row hover.
 */
export function BarList({
  data,
  max,
  format = (v) =>
    Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v),
  className,
}: {
  data: { label: string; value: number; secondary?: string }[];
  max?: number;
  format?: (value: number) => string;
  className?: string;
}) {
  if (data.length === 0) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        No data yet
      </div>
    );
  }
  const top = max ?? Math.max(1, ...data.map((d) => d.value));

  return (
    <ul className={cn("space-y-2.5", className)}>
      {data.map((d, i) => (
        <li
          key={i}
          className="group rounded-md px-1 py-0.5 transition hover:bg-secondary/60"
        >
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-medium">{d.label}</span>
            <span className="shrink-0 tabular-nums">{format(d.value)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-chart-1 transition-[width] duration-500"
                style={{ width: `${Math.min(100, (d.value / top) * 100)}%` }}
              />
            </div>
            {d.secondary ? (
              <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {d.secondary}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
