"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useLedger } from "../data/client";
import { spendByCostCenter } from "../data/derive";
import { Chip, Id, Money, PageHeader, td, th } from "../components/ui";
import { formatMoney } from "../data/format";
import { emitScreenContext } from "../learning/recorder";

/**
 * Cost centers: the budgets reports are charged to, with each one's BUDGET
 * TYPE. This page is the only place that says which cost center owns the
 * events budget, so reading it is part of the detective path.
 */
export function CostCentersPage() {
  const { data } = useLedger();
  const spend = spendByCostCenter(data);
  const emitted = useRef(false);

  useEffect(() => {
    if (emitted.current) return;
    emitted.current = true;
    const events = data.costCenters.filter((c) => c.budgetType === "events");
    emitScreenContext(
      `Cost centers: ${events.map((c) => `${c.id} ${c.name}`).join(", ")} owns the events budget`,
      {
        view: "cost-centers",
        budgetTypes: data.costCenters.map((c) => ({
          id: c.id,
          name: c.name,
          budgetType: c.budgetType,
          owner: c.owner,
        })),
      },
    );
  }, [data.costCenters]);

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        title="Cost centers"
        subtitle="Who owns each budget, what it is for, and how much of this quarter is used"
      />
      <div className="overflow-hidden rounded-[10px] border border-hairline">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Cost center</th>
              <th className={th}>Budget type</th>
              <th className={th}>Owner</th>
              <th className={cn(th, "text-right")}>Reports</th>
              <th className={cn(th, "text-right")}>Committed</th>
              <th className={cn(th, "w-[15rem]")}>Quarter budget</th>
            </tr>
          </thead>
          <tbody>
            {data.costCenters.map((cc) => {
              const s = spend.get(cc.id) ?? {
                committed: 0,
                pending: 0,
                reports: 0,
              };
              return (
                <tr
                  key={cc.id}
                  data-testid={`cost-center-${cc.id}`}
                  className="hover:bg-surface-muted/60"
                >
                  <td className={td}>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Id>{cc.id}</Id>
                      <span className="font-medium">{cc.name}</span>
                    </div>
                  </td>
                  <td className={td}>
                    <Chip tone={cc.budgetType === "events" ? "blue" : "gray"}>
                      {cc.budgetType}
                    </Chip>
                  </td>
                  <td className={cn(td, "whitespace-nowrap text-ink-muted")}>
                    {cc.owner}
                  </td>
                  <td className={cn(td, "ll-num text-right")}>{s.reports}</td>
                  <td className={cn(td, "text-right")}>
                    <Money value={s.committed} />
                  </td>
                  <td className={td}>
                    <BudgetCell
                      committed={s.committed}
                      pending={s.pending}
                      budget={cc.quarterBudget}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** $6.8K, $18K: short enough for one line beside the meter. */
function compactMoney(n: number): string {
  if (n < 1000) return `$${Math.round(n)}`;
  const k = Math.round(n / 100) / 10;
  return `$${k >= 10 ? Math.round(k) : k}K`;
}

/**
 * One line: a meter (committed solid, pending lighter), the share used, and
 * "used of budget". The exact figures and the pending share are in the tooltip.
 */
function BudgetCell({
  committed,
  pending,
  budget,
}: {
  committed: number;
  pending: number;
  budget: number;
}) {
  const used = committed + pending;
  const pct = budget > 0 ? used / budget : 0;
  const width = (n: number) =>
    `${Math.min(100, budget > 0 ? (n / budget) * 100 : 0)}%`;
  const tone =
    pct > 1
      ? "bg-negative"
      : pct > 0.8
        ? "bg-[hsl(var(--ll-amber))]"
        : "bg-ink";
  const detail = `${formatMoney(used)} of ${formatMoney(budget)} used${
    pending ? `, including ${formatMoney(pending)} pending approval` : ""
  }`;
  return (
    <div
      className="flex items-center gap-2.5 whitespace-nowrap"
      title={detail}
      aria-label={detail}
    >
      <div className="flex h-1.5 w-20 flex-none overflow-hidden rounded-full bg-surface-muted">
        <div
          className={cn("h-full", tone)}
          style={{ width: width(committed) }}
        />
        <div
          className={cn("h-full opacity-35", tone)}
          style={{ width: width(pending) }}
        />
      </div>
      <span className="ll-num w-9 text-right text-[12px] font-medium">
        {Math.round(pct * 100)}%
      </span>
      <span className="ll-num text-[12px] text-[hsl(var(--ll-faint))]">
        {compactMoney(used)} of {compactMoney(budget)}
      </span>
    </div>
  );
}
