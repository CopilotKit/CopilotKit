export interface MetricCardProps {
  label: string;
  value: string;
  trend?: {
    direction: "up" | "down" | "neutral";
    percentage: number;
  };
}

const TREND_STYLES: Record<
  "up" | "down" | "neutral",
  { color: string; arrow: string }
> = {
  up: { color: "text-green-600 dark:text-green-400", arrow: "\u2191" },
  down: { color: "text-red-600 dark:text-red-400", arrow: "\u2193" },
  neutral: {
    color: "text-[var(--muted-foreground)]",
    arrow: "\u2192",
  },
};

export function MetricCard({ label, value, trend }: MetricCardProps) {
  return (
    <div
      data-testid="metric-card"
      className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4"
    >
      <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wider font-medium">
        {label}
      </p>
      <p className="text-2xl font-bold text-[var(--foreground)] mt-1">
        {value}
      </p>
      {trend && (
        <p
          data-testid="trend-indicator"
          className={`text-sm font-medium mt-1 ${TREND_STYLES[trend.direction].color}`}
        >
          {TREND_STYLES[trend.direction].arrow} {trend.percentage}%
        </p>
      )}
    </div>
  );
}
