"use client";

import { AlertTriangle } from "lucide-react";

import type { ExpensePolicy, Transaction } from "@/app/api/v1/data";
import { isOverLimit } from "@/lib/over-limit";
import { cn } from "@/lib/utils";

/**
 * The spend summary, as a component rather than a wall of prose.
 *
 * This is also where the demo's "remembered preference" becomes visible in the
 * UI instead of only in wording: the agent recalls how Alex likes spend
 * summarized and passes that back as PROPS — `overLimitFirst` reorders the
 * sections, `rounded` switches the figures to whole dollars. So the memory
 * changes the structure of what renders, not just the sentence around it.
 *
 * Figures are computed here from live policies/transactions, so the agent never
 * supplies numbers and cannot drift from the ledger.
 */
export function SpendSummaryCard({
  policies,
  transactions,
  overLimitFirst = true,
  rounded = true,
  note,
}: {
  policies: ExpensePolicy[];
  transactions: Transaction[];
  overLimitFirst?: boolean;
  rounded?: boolean;
  note?: string;
}) {
  const money = (n: number) =>
    rounded
      ? `$${Math.round(n).toLocaleString("en-US")}`
      : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Over-limit comes from the shared `isOverLimit` helper, never a local
  // reimplementation: it also treats a charge with a filed clearing exception as
  // no longer over limit, so a hand-rolled spent+amount>limit check here would
  // start disagreeing with the rest of the app the moment an exception is filed
  // mid-demo.
  const overLimit = transactions.filter(
    (t) => t.status === "pending" && isOverLimit(t, policies),
  );

  const teams = policies.map((policy) => {
    const pending = transactions.filter(
      (t) => t.status === "pending" && t.policyId === policy.id,
    );
    const pct = policy.limit > 0 ? (policy.spent / policy.limit) * 100 : 0;
    return { policy, pending, pct };
  });

  const OverLimitSection = overLimit.length > 0 && (
    <section aria-label="Over policy limit">
      <div className="mb-1.5 flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 text-negative" aria-hidden />
        <h4 className="text-xs font-semibold text-negative">
          Over policy limit
        </h4>
      </div>
      <ul className="space-y-1">
        {overLimit.map((t) => {
          const policy = policies.find((p) => p.id === t.policyId);
          return (
            <li
              key={t.id}
              className="flex items-baseline justify-between gap-3 rounded-lg bg-negative-soft/50 px-2.5 py-1.5 text-[0.8125rem]"
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
    </section>
  );

  const ByTeamSection = (
    <section aria-label="By team">
      <h4 className="mb-1.5 text-xs font-semibold text-ink-muted">By team</h4>
      <ul className="space-y-2">
        {teams.map(({ policy, pending, pct }) => (
          <li key={policy.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
              <span className="truncate font-medium text-ink">
                {policy.type}
                {pending.length > 0 && (
                  <span className="ml-1.5 text-[0.6875rem] font-normal text-ink-muted">
                    {pending.length} pending
                  </span>
                )}
              </span>
              <span className="flex-none tabular-nums text-ink-muted">
                <span className="font-semibold text-ink">
                  {money(policy.spent)}
                </span>
                {" / "}
                {money(policy.limit)}
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
              role="img"
              aria-label={`${policy.type} at ${Math.round(pct)}% of limit`}
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  pct >= 100 ? "bg-negative" : "brand-gradient",
                )}
                style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="space-y-3.5 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
      <h3 className="text-sm font-semibold text-ink">Spend summary</h3>
      {overLimitFirst ? (
        <>
          {OverLimitSection}
          {ByTeamSection}
        </>
      ) : (
        <>
          {ByTeamSection}
          {OverLimitSection}
        </>
      )}
      {note && (
        <p className="border-t border-hairline pt-2.5 text-xs leading-relaxed text-ink-muted">
          {note}
        </p>
      )}
    </div>
  );
}

export default SpendSummaryCard;
