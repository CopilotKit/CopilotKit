"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Sparkles } from "lucide-react";
import type { Report, ExpensePolicy, Transaction } from "@/app/api/v1/data";
import useCreditCards from "@/app/actions";

/**
 * Fold a report's document-sourced additions (e.g. figures pulled from an
 * uploaded invoice) INTO the live ledger figures, so the report's charts show
 * the augmented picture: add spend onto the matching policy segment (or a new
 * segment) for the breakdown, and add an equivalent expense for income-vs-
 * expenses. Reports with no additions render the live figures unchanged.
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
import {
  SpendBreakdownChart,
  IncomeExpenseChart,
} from "@/components/analytics-charts";
import { useAskCopilot } from "./use-ask-copilot";
import { REPORTS_CHANGED_EVENT } from "./report-tool";

const REPORT_PILL_MESSAGE =
  "Prepare a Q2 spend report for the board: summarize spend against budgets, call out anything over limit or pending, and file it as a report.";

/**
 * The dashboard's Reports tab: copilot-generated artifacts that outlive the
 * conversation. The narrative (summary + highlights) is the agent's; the
 * charts are rendered live from the same data the narrative describes. Empty
 * state carries the pill that asks the copilot to write the first one.
 */
export function ReportsView() {
  const askCopilot = useAskCopilot();
  const { policies, transactions } = useCreditCards();
  const [reports, setReports] = useState<Report[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/reports");
      if (res.ok) setReports(await res.json());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener(REPORTS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(REPORTS_CHANGED_EVENT, refresh);
  }, [refresh]);

  if (!loaded) return null;

  if (!reports.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-hairline bg-surface/60 p-12 text-center">
        <FileText className="h-8 w-8 text-ink-muted" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">No reports yet</p>
          <p className="text-sm text-ink-muted">
            Ask the copilot to write one — it files the finished report right
            here.
          </p>
        </div>
        <button
          type="button"
          data-testid="reports-empty-pill"
          onClick={() => askCopilot(REPORT_PILL_MESSAGE)}
          className="flex items-center gap-2 rounded-full border border-hairline bg-brand-soft/60 px-4 py-2 text-sm font-medium text-brand-indigo transition-colors hover:bg-brand-soft dark:text-brand-violet"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          Prep the Q2 spend report for the board
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {reports.map((report) => {
        const chart = augmentForReport(report, policies, transactions);
        return (
          <article
            key={report.id}
            data-testid="report-card"
            className="space-y-4 rounded-2xl border border-hairline bg-surface p-6 shadow-soft"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold text-ink">{report.title}</h3>
              <p className="text-xs text-ink-muted">
                {new Date(report.createdAt).toLocaleString()} ·{" "}
                {report.createdBy}
              </p>
            </header>
            <p className="text-sm leading-relaxed text-ink">{report.summary}</p>
            {report.highlights.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
                {report.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            )}
            <div className="grid gap-5 border-t border-hairline pt-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Spend breakdown
                </p>
                <SpendBreakdownChart policies={chart.policies} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Income vs expenses
                </p>
                <IncomeExpenseChart transactions={chart.transactions} />
              </div>
            </div>
          </article>
        );
      })}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => askCopilot(REPORT_PILL_MESSAGE)}
          className="flex items-center gap-2 rounded-full border border-hairline bg-brand-soft/60 px-3 py-1.5 text-xs font-medium text-brand-indigo transition-colors hover:bg-brand-soft dark:text-brand-violet"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Ask for another report
        </button>
      </div>
    </div>
  );
}

export default ReportsView;
