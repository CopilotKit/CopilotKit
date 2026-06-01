"use client";

import type { MetricCardTrendDirection } from "./types";

export interface MetricCardComponentProps {
  label: string;
  value: string;
  /** Optional trend copy, e.g. "+12% vs last quarter". */
  trend?: string | null;
  /** Optional trend direction hint, drives the colored badge. */
  trendDirection?: MetricCardTrendDirection | null;
}

/**
 * Presentational metric card used by the json-render catalog.
 *
 * The component is intentionally self-contained — the catalog shape
 * (`{ label, value, trend }`) mirrors Wave 4a's hashbrown MetricCard
 * so the two BYOC demos are directly comparable.
 */
export function MetricCard({
  label,
  value,
  trend,
  trendDirection,
}: MetricCardComponentProps) {
  const resolvedDirection =
    trendDirection ?? inferTrendDirection(trend ?? null);

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
          className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(
            resolvedDirection,
          )}`}
        >
          {trend}
        </div>
      ) : null}
    </div>
  );
}

function inferTrendDirection(trend: string | null): MetricCardTrendDirection {
  if (!trend) return "neutral";
  const normalized = trend.trim();
  if (normalized.startsWith("+")) return "up";
  if (normalized.startsWith("-") || normalized.startsWith("−")) {
    return "down";
  }
  return "neutral";
}

function badgeClass(direction: MetricCardTrendDirection): string {
  switch (direction) {
    case "up":
      return "bg-[color-mix(in_oklab,var(--primary)_15%,transparent)] text-[var(--primary)]";
    case "down":
      return "bg-[color-mix(in_oklab,var(--destructive)_15%,transparent)] text-[var(--destructive)]";
    case "neutral":
    default:
      return "bg-[var(--secondary)] text-[var(--muted-foreground)]";
  }
}
