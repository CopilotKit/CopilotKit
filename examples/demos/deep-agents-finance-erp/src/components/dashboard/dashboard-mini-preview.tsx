"use client";

import type { DashboardWidget } from "@/types/dashboard";

const TYPE_COLORS: Record<string, string> = {
  "kpi-cards": "bg-blue-400/60",
  "revenue-chart": "bg-emerald-400/60",
  "expense-breakdown": "bg-amber-400/60",
  "recent-transactions": "bg-purple-400/60",
  "outstanding-invoices": "bg-rose-400/60",
  "custom-chart": "bg-teal-400/60",
  "cash-waterfall": "bg-cyan-400/60",
  "ar-aging-gauge": "bg-orange-400/60",
  "budget-variance": "bg-indigo-400/60",
  "spend-heatmap": "bg-violet-400/60",
  "revenue-forecast": "bg-lime-400/60",
  "metric-cards": "bg-sky-400/60",
};

/**
 * Tiny 4-column grid preview of a dashboard layout.
 * Used in gallery cards and the toolbar dropdown.
 */
export function DashboardMiniPreview({
  widgets,
}: {
  widgets: DashboardWidget[];
}) {
  const sorted = [...widgets].sort((a, b) => a.order - b.order);

  return (
    <div className="grid grid-cols-4 gap-1" style={{ minHeight: 48 }}>
      {sorted.map((w) => (
        <div
          key={w.id}
          className={`rounded-sm ${TYPE_COLORS[w.type] ?? "bg-muted-foreground/30"}`}
          style={{
            gridColumn: `span ${Math.min(w.colSpan, 4)}`,
            height: 12,
          }}
        />
      ))}
    </div>
  );
}
