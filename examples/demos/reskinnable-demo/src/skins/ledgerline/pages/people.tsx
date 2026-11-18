"use client";

import { cn } from "@/lib/utils";
import { useLedger } from "../data/client";
import { byEmployee } from "../data/derive";
import { Avatar, Chip, Id, Money, PageHeader, td, th } from "../components/ui";

/** Everyone who submits expense reports, with what is outstanding for each. */
export function PeoplePage() {
  const { data } = useLedger();
  const rows = byEmployee(data).sort((a, b) => b.outstanding - a.outstanding);
  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        title="People"
        subtitle={`${rows.length} people submit expense reports at ${data.company}`}
      />
      <div className="overflow-hidden rounded-[10px] border border-hairline">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Department</th>
              <th className={th}>Home cost center</th>
              <th className={cn(th, "text-right")}>Reports</th>
              <th className={cn(th, "text-right")}>Outstanding</th>
              <th className={cn(th, "text-right")}>Reimbursed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(
              ({ employee: e, reports, awaiting, outstanding, reimbursed }) => (
                <tr key={e.id} className="hover:bg-surface-muted/60">
                  <td className={td}>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={e.name} />
                      <div className="leading-tight">
                        <div className="font-medium">{e.name}</div>
                        <div className="text-[11.5px] text-[hsl(var(--ll-faint))]">
                          {e.title}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className={cn(td, "text-ink-muted")}>{e.department}</td>
                  <td className={td}>
                    <Id>{e.homeCostCenterId}</Id>
                  </td>
                  <td className={cn(td, "text-right")}>
                    <span className="inline-flex items-center gap-1.5">
                      {awaiting ? (
                        <Chip tone="amber">{awaiting} waiting</Chip>
                      ) : null}
                      <span className="ll-num">{reports}</span>
                    </span>
                  </td>
                  <td className={cn(td, "text-right font-medium")}>
                    <Money value={outstanding} />
                  </td>
                  <td className={cn(td, "text-right text-ink-muted")}>
                    <Money value={reimbursed} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
