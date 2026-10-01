"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useLedger } from "../data/client";
import { spendByCostCenter } from "../data/derive";
import { Chip, Id, Meter, Money, PageHeader, td, th } from "../components/ui";
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
              <th className={cn(th, "w-60")}>Quarter budget</th>
            </tr>
          </thead>
          <tbody>
            {data.costCenters.map((cc) => {
              const s = spend.get(cc.id) ?? {
                committed: 0,
                pending: 0,
                reports: 0,
              };
              const used = s.committed + s.pending;
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
                    <Meter value={used} max={cc.quarterBudget} />
                    <div className="mt-1 text-[11.5px] text-[hsl(var(--ll-faint))]">
                      <Money value={used} /> of{" "}
                      <Money value={cc.quarterBudget} />
                      {s.pending ? (
                        <span>
                          {" "}
                          (incl. <Money value={s.pending} /> pending)
                        </span>
                      ) : null}
                    </div>
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
