"use client";

import { useMemo } from "react";
import type { ExpensePolicy, Transaction } from "@/app/api/v1/data";
import { cn, formatCurrency } from "@/lib/utils";
import { StatisticsChart } from "@/components/statistics-chart";

// Brand-leading palette for multi-series charts (violet → indigo → supporting
// hues). Hand-picked to sit on the lavender surface and read distinctly in the
// donut legend. No charting dependency — every chart here is plain SVG/CSS,
// matching StatisticsChart's "lightweight, hand-rolled" approach.
const PALETTE = [
  "hsl(252 83% 67%)", // brand violet
  "hsl(248 84% 60%)", // brand indigo
  "hsl(199 89% 56%)", // sky
  "hsl(160 70% 45%)", // emerald
  "hsl(38 92% 55%)", // amber
  "hsl(330 75% 60%)", // pink
];

/**
 * Spend-over-time trend. Buckets expenses by calendar month (oldest → newest)
 * and feeds StatisticsChart, falling back to representative seeded points when
 * there isn't enough history — mirrors the dashboard's Statistics rail so the
 * chat trend and the dashboard trend tell the same story.
 */
export function SpendingTrendChart({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const { stats, labels } = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const t of transactions) {
      if (t.amount >= 0) continue;
      const d = new Date(t.date);
      if (Number.isNaN(d.getTime())) continue;
      byMonth.set(
        `${d.getFullYear()}-${d.getMonth()}`,
        (byMonth.get(`${d.getFullYear()}-${d.getMonth()}`) ?? 0) +
          Math.abs(t.amount),
      );
    }
    const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short" });
    const sorted = [...byMonth.entries()].sort(([a], [b]) => {
      const [ay, am] = a.split("-").map(Number);
      const [by, bm] = b.split("-").map(Number);
      return ay - by || am - bm;
    });
    if (sorted.length >= 3) {
      return {
        stats: sorted.map(([, v]) => v),
        labels: sorted.map(([k]) => {
          const [y, m] = k.split("-").map(Number);
          return monthFmt.format(new Date(y, m, 1));
        }),
      };
    }
    return {
      stats: [3200, 4100, 3600, 5200, 4800, 6400],
      labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    };
  }, [transactions]);

  return <StatisticsChart data={stats} labels={labels} />;
}

/**
 * Budget usage per expense policy — a horizontal bar of `spent / limit` for
 * each team's policy. Bars use the brand gradient; a policy already past its
 * limit turns red and calls out the overage. This is "how's our budget?" at a
 * glance.
 */
export function BudgetUsageChart({ policies }: { policies: ExpensePolicy[] }) {
  if (!policies.length) {
    return (
      <p className="text-sm text-ink-muted">No expense policies to show.</p>
    );
  }
  return (
    <div className="space-y-3.5">
      {policies.map((policy) => {
        const pct = policy.limit > 0 ? (policy.spent / policy.limit) * 100 : 0;
        const over = policy.spent > policy.limit;
        return (
          <div key={policy.id} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-ink">{policy.type}</span>
              <span className="tabular-nums text-ink-muted">
                {formatCurrency(policy.spent)}
                <span className="text-ink-muted/60">
                  {" "}
                  / {formatCurrency(policy.limit)}
                </span>
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  over ? "bg-negative" : "brand-gradient",
                )}
                style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
              />
            </div>
            {over && (
              <p className="text-xs font-medium text-negative">
                Over limit by {formatCurrency(policy.spent - policy.limit)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Spend breakdown — a donut of each policy's spend as a share of total, with a
 * legend. Built with stroke-dasharray segments on a rotated circle (no arc
 * math, no dependency); the total sits in the center hole.
 */
export function SpendBreakdownChart({
  policies,
}: {
  policies: ExpensePolicy[];
}) {
  const segments = policies
    .filter((p) => p.spent > 0)
    .map((p, i) => ({
      label: p.type,
      value: p.spent,
      color: PALETTE[i % PALETTE.length],
    }));
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (!total) {
    return (
      <p className="text-sm text-ink-muted">No spend to break down yet.</p>
    );
  }

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  // Precompute each arc's length and its start offset (cumulative length of the
  // preceding arcs) without a mutable accumulator, so the render stays pure.
  const arcs = segments.map((s, i) => ({
    ...s,
    len: (s.value / total) * circumference,
    offset: segments
      .slice(0, i)
      .reduce((sum, x) => sum + (x.value / total) * circumference, 0),
  }));

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-32 w-32 flex-none">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="hsl(var(--hairline))"
            strokeWidth="12"
          />
          {arcs.map((s) => (
            <circle
              key={s.label}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth="12"
              strokeDasharray={`${s.len} ${circumference - s.len}`}
              strokeDashoffset={-s.offset}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[0.65rem] uppercase tracking-wide text-ink-muted">
            Total
          </span>
          <span className="text-sm font-semibold tabular-nums text-ink">
            {formatCurrency(total)}
          </span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 flex-none rounded-full"
              style={{ background: s.color }}
            />
            <span className="truncate text-ink">{s.label}</span>
            <span className="ml-auto tabular-nums text-ink-muted">
              {Math.round((s.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A single labelled meter bar (label · value · proportional fill). Module-level
// so it isn't re-created on every IncomeExpenseChart render.
function MeterRow({
  label,
  value,
  max,
  fill,
  text,
}: {
  label: string;
  value: number;
  max: number;
  fill: string;
  text: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-ink-muted">{label}</span>
        <span className={cn("font-semibold tabular-nums", text)}>
          {formatCurrency(value)}
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-surface-muted">
        <div
          className={cn("h-full rounded-full", fill)}
          style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Income vs expenses — two proportional bars (incoming green, outgoing red)
 * plus the net. Summed straight from the transaction amounts.
 */
export function IncomeExpenseChart({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const income = transactions
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
  const expenses = transactions
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const max = Math.max(income, expenses, 1);
  const net = income - expenses;

  return (
    <div className="space-y-3.5">
      <MeterRow
        label="Income"
        value={income}
        max={max}
        fill="bg-positive"
        text="text-positive"
      />
      <MeterRow
        label="Expenses"
        value={expenses}
        max={max}
        fill="bg-negative"
        text="text-negative"
      />
      <div className="flex items-baseline justify-between border-t border-hairline pt-2.5 text-sm">
        <span className="font-medium text-ink">Net</span>
        <span
          className={cn(
            "font-semibold tabular-nums",
            net >= 0 ? "text-positive" : "text-negative",
          )}
        >
          {net >= 0 ? "+" : "−"}
          {formatCurrency(Math.abs(net))}
        </span>
      </div>
    </div>
  );
}
