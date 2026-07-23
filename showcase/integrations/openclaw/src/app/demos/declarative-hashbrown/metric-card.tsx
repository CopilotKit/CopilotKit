"use client";

interface MetricCardProps {
  label: string;
  value: string;
  trend?: string;
}

export function MetricCard({ label, value, trend }: MetricCardProps) {
  const isPositive =
    trend?.startsWith("+") || trend?.toLowerCase().includes("up");
  const isNegative =
    trend?.startsWith("-") || trend?.toLowerCase().includes("down");
  const trendColor = isPositive
    ? "text-green-600 dark:text-green-400"
    : isNegative
      ? "text-red-600 dark:text-red-400"
      : "text-[var(--muted-foreground)]";

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
        <p data-testid="metric-trend" className={`text-sm mt-1 ${trendColor}`}>
          {trend}
        </p>
      )}
    </div>
  );
}
