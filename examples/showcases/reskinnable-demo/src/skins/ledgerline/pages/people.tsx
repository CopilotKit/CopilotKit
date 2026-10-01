"use client";

import { formatMoney, useLedger } from "../data/client";
import { byEmployee } from "../data/derive";
import { Avatar, Badge, Card, PageHeader } from "../components/ui";

/** Everyone who submits expense reports, with what is outstanding for each. */
export function PeoplePage() {
  const { data } = useLedger();
  const rows = byEmployee(data).sort((a, b) => b.outstanding - a.outstanding);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="People"
        subtitle={`${rows.length} people submit expense reports at ${data.company}`}
      />
      <Card>
        <table className="w-full text-[0.82rem]">
          <thead className="text-[0.68rem] uppercase tracking-[0.05em] text-ink-muted">
            <tr className="border-b border-hairline text-left">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Department</th>
              <th className="px-4 py-2 font-medium">Home cost center</th>
              <th className="px-4 py-2 font-medium">Reports</th>
              <th className="px-4 py-2 text-right font-medium">Outstanding</th>
              <th className="px-4 py-2 text-right font-medium">Reimbursed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(
              ({ employee: e, reports, awaiting, outstanding, reimbursed }) => (
                <tr
                  key={e.id}
                  className="border-b border-hairline last:border-0"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={e.name} />
                      <div>
                        <div className="font-medium">{e.name}</div>
                        <div className="text-[0.7rem] text-ink-muted">
                          {e.title}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{e.department}</td>
                  <td className="px-4 py-2.5 font-mono text-[0.74rem]">
                    {e.homeCostCenterId}
                  </td>
                  <td className="px-4 py-2.5">
                    {reports}{" "}
                    {awaiting ? (
                      <Badge tone="warn">{awaiting} waiting</Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatMoney(outstanding)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                    {formatMoney(reimbursed)}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
