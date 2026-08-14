"use client";

import type { HarnessSummary } from "@/skins/banking/harness/types";

/**
 * The React widget the beat ends on. SHARED BY BOTH ARMS, byte-identical on
 * purpose: holding the payoff frame constant is what makes the comparison about
 * the four minutes in the middle rather than about the ending.
 *
 * Nothing here may be specific to Arm A's side channel — no progress events, no
 * channel id, no EventSource. It takes a finished `HarnessSummary` and nothing
 * else.
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
        <div key={stat.label}>
          <div className="text-lg font-semibold text-ink">{stat.value}</div>
          <div className="text-xs text-ink/60">{stat.label}</div>
        </div>
      ))}
    </div>

    <ul className="divide-y divide-hairline">
      {summary.verdicts.map((verdict) => (
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
            <div className={`text-xs ${DECISION_STYLE[verdict.decision]}`}>
              {verdict.filedTransactionId ? "Filed" : verdict.decision}
            </div>
          </div>
        </li>
      ))}
    </ul>
  </div>
);
