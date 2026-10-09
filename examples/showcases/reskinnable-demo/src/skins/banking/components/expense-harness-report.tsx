"use client";

import type {
  ExpenseVerdict,
  HarnessSummary,
} from "@/skins/banking/harness/types";

/**
 * The React widget the beat ends on — the payoff after a multi-minute agentic
 * run.
 *
 * It takes a finished `HarnessSummary` and NOTHING else: no progress events, no
 * channel id, no EventSource, no knowledge of which process produced the run.
 * That is what let the beat swap its entire agent runtime underneath without
 * touching this file — the summary arrives as an ordinary AG-UI tool result
 * whether a local `BuiltInAgent` or the remote Python deep agent produced it.
 *
 * A `HarnessSummary`'s amounts are POSITIVE — they mirror the uploaded CSV. The
 * banking ledger stores a filed charge as a negative transaction, but that is a
 * storage concern on the other side of `filedTransactionId` and never reaches
 * this widget, so there is no sign flip to undo here.
 */

const money = (value: number): string =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

const duration = (seconds: number): string =>
  `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

const DECISION_STYLE = {
  expensable: "text-positive",
  personal: "text-negative",
  unclear: "text-ink/60",
} as const;

/**
 * What a verdict's status cell says, and how it reads.
 *
 * Keyed off `filedTransactionId` and NEVER off `decision` alone. The harness is
 * instructed to leave that id unset and explain itself in the row's `reason` when
 * a filing call does not come back 201, so "expensable" and "filed" are two
 * different facts — printing "Filed" because the decision was expensable would
 * claim a filing that never happened.
 *
 * An expensable row whose filing did NOT land is the one row a presenter must not
 * miss, so it must not wear the same green as a filed one. It gets the negative
 * tint plus a heavier weight (the weight is also what separates it from a plain
 * `personal` row, which is an ordinary outcome rather than a failure) and an
 * explicit "not filed" line under it.
 */
const statusCell = (
  verdict: ExpenseVerdict,
): { label: string; className: string; unfiled: boolean } => {
  if (verdict.filedTransactionId) {
    return {
      label: "Filed",
      className: DECISION_STYLE.expensable,
      unfiled: false,
    };
  }
  if (verdict.decision === "expensable") {
    return {
      label: verdict.decision,
      className: "font-semibold text-negative",
      unfiled: true,
    };
  }
  return {
    label: verdict.decision,
    className: DECISION_STYLE[verdict.decision],
    unfiled: false,
  };
};

export const ExpenseHarnessReport = ({
  summary,
}: {
  summary: HarnessSummary;
}) => (
  <div className="rounded-[--radius] border border-hairline bg-surface p-4 shadow-soft">
    <div className="mb-4 grid grid-cols-4 gap-3 text-center">
      {[
        { label: "rows read", value: String(summary.rowsRead) },
        {
          label: "merchants researched",
          value: String(summary.merchantsSearched),
        },
        { label: "reimbursable", value: money(summary.totalExpensable) },
        { label: "run time", value: duration(summary.elapsedSeconds) },
      ].map((stat) => (
        // `data-stat` lets a test scope an assertion to ONE tile — "14 is in the
        // rows-read tile", which is the claim worth making — without coupling to
        // the tile's internal element depth or to value-before-label order.
        <div key={stat.label} data-stat={stat.label}>
          <div className="text-lg font-semibold text-ink">{stat.value}</div>
          <div className="text-xs text-ink/60">{stat.label}</div>
        </div>
      ))}
    </div>

    <ul className="divide-y divide-hairline">
      {summary.verdicts.map((verdict) => {
        const status = statusCell(verdict);
        return (
          <li
            key={`${verdict.merchant}-${verdict.date}`}
            className="flex items-start justify-between gap-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">
                {verdict.merchant}
                {verdict.merchantKind ? (
                  <span className="ml-2 text-xs font-normal text-ink/50">
                    {verdict.merchantKind}
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-ink/60">{verdict.reason}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm text-ink">{money(verdict.amount)}</div>
              <div className={`text-xs ${status.className}`}>
                {status.label}
              </div>
              {status.unfiled ? (
                <div className="text-xs font-semibold text-negative">
                  not filed
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  </div>
);
