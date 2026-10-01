"use client";

import { formatMoney, useLedger } from "../data/client";
import { spendByCostCenter } from "../data/derive";
import { Badge, Card, Meter, PageHeader } from "../components/ui";

/** Budgets the reports are charged to. */
export function CostCentersPage() {
  const { data } = useLedger();
  const spend = spendByCostCenter(data);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Cost centers"
        subtitle="This quarter's expense-report budgets, by owner"
      />
      <Card>
        <table className="w-full text-[0.82rem]">
          <thead className="text-[0.68rem] uppercase tracking-[0.05em] text-ink-muted">
            <tr className="border-b border-hairline text-left">
              <th className="px-4 py-2 font-medium">Cost center</th>
              <th className="px-4 py-2 font-medium">Owner</th>
              <th className="px-4 py-2 font-medium">Reports</th>
              <th className="px-4 py-2 text-right font-medium">Committed</th>
              <th className="px-4 py-2 text-right font-medium">Pending</th>
              <th className="w-56 px-4 py-2 font-medium">Budget used</th>
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
                  className="border-b border-hairline last:border-0"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[0.72rem] text-ink-muted">
                        {cc.id}
                      </span>
                      <span className="font-medium">{cc.name}</span>
                      {cc.kind === "events" ? (
                        <Badge tone="brand">Events budget</Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{cc.owner}</td>
                  <td className="px-4 py-2.5 tabular-nums">{s.reports}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatMoney(s.committed)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                    {formatMoney(s.pending)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Meter value={used} max={cc.quarterBudget} />
                    <div className="mt-1 text-[0.66rem] text-ink-muted">
                      {formatMoney(used)} of {formatMoney(cc.quarterBudget)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
