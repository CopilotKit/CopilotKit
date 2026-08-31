"use client";

import { useMemo } from "react";
import type { ExpensePolicy, Transaction } from "@/skins/banking/data/data";
import { cn, formatCurrency } from "@/lib/utils";
import { StatisticsChart } from "@/skins/banking/components/statistics-chart";

// Brand-leading palette for multi-series charts (violet → indigo → supporting
// hues). Hand-picked to sit on the lavender surface and read distinctly in the
// donut legend. No charting dependency — every chart here is plain SVG/CSS,
// matching StatisticsChart's "lightweight, hand-rolled" approach.
const PALETTE = [
  "hsl(252 83% 67%)", // brand violet
  "hsl(199 89% 56%)", // sky
  "hsl(160 70% 45%)", // emerald
  "hsl(38 92% 55%)", // amber
  "hsl(330 75% 60%)", // pink
  "hsl(248 84% 60%)", // brand indigo (last: too close to violet to pair early)
];

/**
 * A team's colour, fixed to the TEAM rather than to its position in a list.
 *
 * Two bugs this fixes. First, assigning `PALETTE[i]` by index gave Marketing
 * violet (252°) and Executive indigo (248°) — four degrees apart and
 * indistinguishable in a donut. Second, index assignment means a team's colour
 * changes when the set changes, so the same team could be violet in one chart
 * and sky in another. Keying off the team name makes a category's colour
 * identical in every chart on the page, which is what lets a reader connect the
 * donut to the budget bars at a glance.
 *
 * The three seeded teams get hues that are far apart on the wheel and none of
 * which reads as an error state (red/amber stay semantic).
 */
const TEAM_COLORS: Record<string, string> = {
  Marketing: "hsl(252 83% 67%)", // violet — the brand hue
  Executive: "hsl(199 89% 56%)", // sky
  Engineering: "hsl(160 70% 45%)", // emerald
};

/** Stable fallback for any team not in the map: hash the name so the same team
 *  always lands on the same swatch regardless of ordering. */
export function teamColor(team: string): string {
  const known = TEAM_COLORS[team];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < team.length; i++)
    hash = (hash * 31 + team.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

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
    // Chart whatever months the ledger actually has — even one or two.
    //
    // This used to substitute a hard-coded [3200, 4100, 3600, 5200, 4800, 6400]
    // Jan–Jun series whenever fewer than three months were present. That was
    // meant as an empty-state placeholder, but the seeded ledger only ever
    // spanned two months, so the fallback was the DEFAULT path: the report
    // rendered six invented figures under a card whose own contract promises
    // "every number is computed from the live ledger", and they were ~20x
    // smaller than the total shown directly above them. A sparse honest chart
    // beats a dense invented one.
    return {
      stats: sorted.map(([, v]) => v),
      labels: sorted.map(([k]) => {
        const [y, m] = k.split("-").map(Number);
        return monthFmt.format(new Date(y, m, 1));
      }),
    };
  }, [transactions]);

  if (!stats.length) {
    return (
      <div className="flex h-[120px] items-center justify-center rounded-xl border border-dashed border-hairline text-xs text-ink-muted">
        No spend recorded yet
      </div>
    );
  }

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
              <span className="flex items-center gap-1.5 font-medium text-ink">
                {/* Same swatch the donut uses for this team, so the two charts
                    read as one system instead of two unrelated pictures. */}
                <span
                  aria-hidden
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ backgroundColor: teamColor(policy.type) }}
                />
                {policy.type}
              </span>
              <span className="tabular-nums text-ink-muted">
                {formatCurrency(policy.spent)}
                <span className="text-ink-muted/60">
                  {" "}
                  / {formatCurrency(policy.limit)}
                </span>
              </span>
            </div>
            {/* The fill stays the TEAM colour (categorical). Over-limit is a
                STATE, so it is carried by a red ring on the track plus the red
                caption below — mixing the two into one red fill would have made
                severity and identity fight for the same channel. */}
            <div
              className={cn(
                "h-2.5 w-full overflow-hidden rounded-full bg-surface-muted",
                over && "ring-1 ring-inset ring-negative/60",
              )}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, Math.max(2, pct))}%`,
                  backgroundColor: teamColor(policy.type),
                }}
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
 * Spend by team — ranked horizontal bars, each optionally split into ledger
 * spend and spend contributed by an attached document.
 *
 * This replaces the donut on the report. A donut only works when the categories
 * are roughly comparable; once an attached invoice pushed Marketing to 96% of
 * total, the chart was one ring and two invisible slivers — the shape carried no
 * information and the two smaller teams could not be read at all. Ranked bars
 * degrade gracefully under that kind of dominance because every row keeps its
 * own label and figure regardless of how small its bar gets.
 *
 * Bars are scaled to the LARGEST team rather than to the total, so the
 * comparison stays legible instead of collapsing everything against a 96%
 * leader. The lighter segment is invoice-sourced spend, which is what actually
 * explains the dominance — the previous chart showed the imbalance without ever
 * saying where it came from.
 */
/**
 * The largest individual charges, ranked.
 *
 * This exists to be a DIFFERENT CUT from the share-of-total donut, not a second
 * rendering of it. The donut answers "which team is spending"; this answers
 * "which line items are actually driving that", which a three-team aggregate
 * can never show — one $15,000 charge and thirty $500 charges look identical
 * once summed into a team.
 *
 * Bars are still coloured by owning team, so a reader can tie a row back to its
 * slice in the donut without the two charts carrying the same information.
 */
export function TopChargesChart({
  transactions,
  policies,
  limit = 6,
}: {
  transactions: Transaction[];
  policies: ExpensePolicy[];
  limit?: number;
}) {
  const rows = useMemo(() => {
    const teamOf = new Map(policies.map((p) => [p.id, p.type]));
    return transactions
      .filter((t) => t.amount < 0)
      .map((t) => ({
        id: t.id,
        title: t.title,
        amount: Math.abs(t.amount),
        // Every charge carries a policyId, including ones folded in from an
        // attached document — `augmentForReport` resolves the addition's team to
        // a policy so its bar colours by the same rule as a ledger charge. The
        // fallback covers an addition whose team matches no policy, which is
        // possible because that field is model-authored free text.
        team: teamOf.get(t.policyId) ?? "",
        pending: t.status === "pending",
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit);
  }, [transactions, policies, limit]);

  const max = rows.reduce((m, r) => Math.max(m, r.amount), 0);

  if (!rows.length) {
    return <p className="text-sm text-ink-muted">No charges to rank yet.</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
            <span className="min-w-0 truncate text-ink">
              {r.title}
              {r.pending && (
                <span className="ml-1 text-[0.6875rem] text-ink-muted">
                  pending
                </span>
              )}
            </span>
            <span className="flex-none font-semibold tabular-nums text-ink">
              {formatCurrency(r.amount)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${max ? (r.amount / max) * 100 : 0}%`,
                backgroundColor: r.team
                  ? teamColor(r.team)
                  : "hsl(248 84% 60%)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SpendByTeamBars({
  policies,
  additionsByTeam = {},
}: {
  policies: ExpensePolicy[];
  additionsByTeam?: Record<string, number>;
}) {
  const rows = policies
    .map((p) => {
      const fromInvoice = additionsByTeam[p.type] ?? 0;
      // `p.spent` already includes additions when the caller passes augmented
      // policies, so derive the ledger portion rather than double-counting.
      const ledger = Math.max(0, p.spent - fromInvoice);
      return { team: p.type, ledger, fromInvoice, total: p.spent };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  const grand = rows.reduce((sum, r) => sum + r.total, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0);

  if (!grand) {
    return (
      <p className="text-sm text-ink-muted">No spend to break down yet.</p>
    );
  }

  const hasInvoice = rows.some((r) => r.fromInvoice > 0);

  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const color = teamColor(r.team);
        const share = (r.total / grand) * 100;
        return (
          <div key={r.team} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink">
                <span
                  aria-hidden
                  className="h-2 w-2 flex-none rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate">{r.team}</span>
              </span>
              <span className="flex-none tabular-nums text-ink-muted">
                <span className="font-semibold text-ink">
                  {formatCurrency(r.total)}
                </span>{" "}
                · {share.toFixed(0)}%
              </span>
            </div>
            <div
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-muted"
              role="img"
              aria-label={`${r.team}: ${formatCurrency(r.total)}, ${share.toFixed(0)}% of spend`}
            >
              {/* Scaled to the largest team so a dominant row does not flatten
                  every other bar to nothing. */}
              <div
                className="h-full"
                style={{
                  width: `${(r.ledger / max) * 100}%`,
                  backgroundColor: color,
                }}
              />
              <div
                className="h-full"
                style={{
                  width: `${(r.fromInvoice / max) * 100}%`,
                  backgroundColor: color,
                  opacity: 0.4,
                }}
              />
            </div>
          </div>
        );
      })}
      {hasInvoice && (
        <p className="pt-0.5 text-[0.6875rem] text-ink-muted">
          Lighter segment is spend from the attached invoice.
        </p>
      )}
    </div>
  );
}

/**
 * Spend breakdown — a donut of each policy's spend as a share of total, with a
 * legend. Built with stroke-dasharray segments on a rotated circle (no arc
 * math, no dependency); the total sits in the center hole.
 *
 * Used by BOTH the in-chat "where is the money going?" answer and the report.
 *
 * This used to warn that the report must use SpendByTeamBars instead, "because
 * an attached invoice can push one team to ~96% and a donut cannot survive
 * that" — while the report rendered the donut anyway. The warning was real but
 * its cause was the thin ledger, not the chart: against the old $137,000 base a
 * $900,000 invoice took one slice to 89%. The ledger now carries the full
 * ~$533,000 of approved Q2 spend across three policy envelopes, so reaching 89%
 * would take an invoice near $2.8M. Robust because the data is real, not
 * because a floor was added to the arc.
 */
export function SpendBreakdownChart({
  policies,
}: {
  policies: ExpensePolicy[];
}) {
  const segments = policies
    .filter((p) => p.spent > 0)
    .map((p) => ({
      label: p.type,
      value: p.spent,
      // Colour follows the TEAM, not its index, so this donut and the budget
      // bars agree on what each team looks like.
      color: teamColor(p.type),
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
