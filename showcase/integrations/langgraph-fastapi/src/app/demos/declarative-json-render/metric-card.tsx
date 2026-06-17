"use client";

export interface MetricCardComponentProps {
  label: string;
  value: string;
  trend?: string | null;
}

export function MetricCard({ label, value, trend }: MetricCardComponentProps) {
  const direction = inferTrendDirection(trend);

  return (
    <div
      data-testid="metric-card"
      className="max-w-xs mx-auto my-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5"
    >
      <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-[var(--foreground)]">
        {value}
      </div>
      {trend ? (
        <div
          className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_CLASS[direction]}`}
        >
          {trend}
        </div>
      ) : null}
    </div>
  );
}

function inferTrendDirection(
  trend: string | null | undefined,
): "up" | "down" | "neutral" {
  const t = trend?.trim();
  if (!t) return "neutral";
  if (t.startsWith("+")) return "up";
  if (t.startsWith("-") || t.startsWith("−")) return "down";
  return "neutral";
}

const BADGE_CLASS = {
  up: "bg-[color-mix(in_oklab,var(--primary)_15%,transparent)] text-[var(--primary)]",
  down: "bg-[color-mix(in_oklab,var(--destructive)_15%,transparent)] text-[var(--destructive)]",
  neutral: "bg-[var(--secondary)] text-[var(--muted-foreground)]",
} as const;
