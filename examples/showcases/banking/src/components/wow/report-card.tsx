"use client";

import { AlertTriangle, Clock, FileText, TrendingUp } from "lucide-react";

import type { ExpensePolicy, Report, Transaction } from "@/app/api/v1/data";
import {
  SpendBreakdownChart,
  SpendingTrendChart,
  BudgetUsageChart,
} from "@/components/analytics-charts";
import { isOverLimit } from "@/lib/over-limit";
import { cn } from "@/lib/utils";

/**
 * Fold a report's document-sourced additions (figures pulled from an uploaded
 * invoice) INTO the live ledger figures so the charts show the augmented
 * picture: add spend onto the matching policy segment (or a new segment) for the
 * breakdown, and add an equivalent expense for income-vs-expenses. Reports with
 * no additions render the live figures unchanged.
 */
function augmentForReport(
  report: Report,
  policies: ExpensePolicy[],
  transactions: Transaction[],
): { policies: ExpensePolicy[]; transactions: Transaction[] } {
  const additions = report.additions ?? [];
  if (!additions.length) return { policies, transactions };

  const byTeam = new Map<string, number>();
  for (const a of additions)
    byTeam.set(a.team, (byTeam.get(a.team) ?? 0) + a.amount);

  const augPolicies: ExpensePolicy[] = policies.map((p) =>
    byTeam.has(p.type) ? { ...p, spent: p.spent + byTeam.get(p.type)! } : p,
  );
  for (const [team, amount] of byTeam) {
    if (!policies.some((p) => p.type === team)) {
      augPolicies.push({
        id: `add-${team}`,
        type: team as ExpensePolicy["type"],
        limit: 0,
        spent: amount,
      });
    }
  }

  const augTransactions: Transaction[] = [
    ...transactions,
    ...additions.map(
      (a, i) =>
        ({
          id: `add-tx-${report.id}-${i}`,
          title: a.label ?? `${a.team} (attached document)`,
          amount: -Math.abs(a.amount),
          date: report.createdAt,
          status: "approved",
        }) as Transaction,
    ),
  ];

  return { policies: augPolicies, transactions: augTransactions };
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** One headline figure. Tone encodes state in FORM as well as number, so what
 *  needs attention reads at a glance rather than requiring the label. */
function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "critical" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        tone === "critical"
          ? "border-negative/25 bg-negative-soft/40"
          : tone === "warning"
            ? "border-amber-500/25 bg-amber-500/5"
            : "border-hairline bg-surface-muted/40",
      )}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            tone === "critical"
              ? "text-negative"
              : tone === "warning"
                ? "text-amber-600 dark:text-amber-400"
                : "text-ink-muted",
          )}
        />
        <span className="text-[0.6875rem] font-medium text-ink-muted">
          {label}
        </span>
      </div>
      <p
        className={cn(
          "text-xl font-bold tabular-nums tracking-tight",
          tone === "critical" ? "text-negative" : "text-ink",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[0.6875rem] text-ink-muted">{sub}</p>}
    </div>
  );
}

/**
 * A filed report, rendered as a dashboard rather than a memo.
 *
 * The previous version led with a paragraph and five long prose bullets and
 * tucked two small charts underneath, so a board report read as a wall of text
 * with decoration at the bottom. Here the figures ARE the report: headline KPIs
 * first, then the charts at full width, then over-limit charges as scannable
 * rows. The agent's narrative is demoted to a single caption and at most three
 * short notes.
 *
 * Every number is computed here from the live ledger plus the report's own
 * document additions — the agent supplies narrative only, so a report can never
 * quote a figure the app disagrees with.
 */
export function ReportCard({
  report,
  policies,
  transactions,
}: {
  report: Report;
  policies: ExpensePolicy[];
  transactions: Transaction[];
}) {
  const chart = augmentForReport(report, policies, transactions);

  const additionsTotal = (report.additions ?? []).reduce(
    (sum, a) => sum + a.amount,
    0,
  );
  const overLimit = transactions.filter(
    (t) => t.status === "pending" && isOverLimit(t, policies),
  );
  const overLimitTotal = overLimit.reduce(
    (sum, t) => sum + Math.abs(t.amount),
    0,
  );
  const pending = transactions.filter((t) => t.status === "pending");
  const totalSpend =
    chart.policies.reduce((sum, p) => sum + p.spent, 0) || additionsTotal;

  return (
    <article
      data-testid="report-card"
      className="space-y-5 rounded-2xl border border-hairline bg-surface p-6 shadow-soft"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold text-ink">{report.title}</h3>
        <p className="text-xs text-ink-muted">
          {new Date(report.createdAt).toLocaleString()} · {report.createdBy}
        </p>
      </header>

      {/* Headline figures first — the report's answer, before any prose. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={TrendingUp}
          label="Total Q2 spend"
          value={money(totalSpend)}
          sub={
            additionsTotal > 0
              ? `incl. ${money(additionsTotal)} invoiced`
              : undefined
          }
        />
        <Kpi
          icon={AlertTriangle}
          label="Over policy limit"
          value={money(overLimitTotal)}
          sub={`${overLimit.length} charge${overLimit.length === 1 ? "" : "s"}`}
          tone={overLimit.length > 0 ? "critical" : "neutral"}
        />
        <Kpi
          icon={Clock}
          label="Pending approval"
          value={String(pending.length)}
          sub={money(pending.reduce((s, t) => s + Math.abs(t.amount), 0))}
          tone={pending.length > 0 ? "warning" : "neutral"}
        />
        <Kpi
          icon={FileText}
          label="From attached invoice"
          value={money(additionsTotal)}
          sub={
            report.additions?.length
              ? `${report.additions.length} line items`
              : "none attached"
          }
        />
      </div>

      {/* Charts at full width, three across — the substance, not a footnote.
          Three different shapes on purpose: a share-of-total pie, a time
          series, and a progress-against-limit bar set. Three bar charts in a row
          read as one repeated chart; mixing the forms means each column answers
          a visibly different question. */}
      <div className="grid gap-5 border-t border-hairline pt-5 lg:grid-cols-3">
        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">
            Spend by team
          </p>
          <SpendBreakdownChart policies={chart.policies} />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">
            Spend over time
          </p>
          <SpendingTrendChart transactions={chart.transactions} />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">
            Budget usage
          </p>
          <BudgetUsageChart policies={chart.policies} />
        </div>
      </div>

      {/* Over-limit charges as scannable rows rather than a prose sentence. */}
      {overLimit.length > 0 && (
        <div className="border-t border-hairline pt-4">
          <p className="mb-2 text-xs font-medium text-ink-muted">
            Needs a decision
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {overLimit.map((t) => {
              const policy = policies.find((p) => p.id === t.policyId);
              return (
                <li
                  key={t.id}
                  className="flex items-baseline justify-between gap-3 rounded-lg bg-negative-soft/40 px-2.5 py-1.5 text-[0.8125rem]"
                >
                  <span className="truncate text-ink">
                    {t.title}
                    {policy && (
                      <span className="text-ink-muted"> · {policy.type}</span>
                    )}
                  </span>
                  <span className="flex-none font-semibold tabular-nums text-negative">
                    {money(Math.abs(t.amount))}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* The narrative, demoted: one caption plus at most three short notes. */}
      <div className="space-y-1.5 border-t border-hairline pt-4">
        <p className="text-sm leading-relaxed text-ink">{report.summary}</p>
        {report.highlights.length > 0 && (
          <ul className="space-y-0.5">
            {report.highlights.slice(0, 3).map((highlight) => (
              <li
                key={highlight}
                className="flex gap-1.5 text-xs leading-relaxed text-ink-muted"
              >
                <span aria-hidden>·</span>
                <span>{highlight}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

export default ReportCard;
