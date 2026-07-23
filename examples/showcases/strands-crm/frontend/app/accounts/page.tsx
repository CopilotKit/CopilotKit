"use client";
import { useCrmContext } from "@/components/crm-context";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/crm";
import type { Account, Deal } from "@/lib/crm";

function openDeals(deals: Deal[], accountId: string) {
  return deals.filter(
    (d) =>
      d.accountId === accountId &&
      d.stage !== "Closed Won" &&
      d.stage !== "Closed Lost",
  );
}

export default function AccountsPage() {
  const { crm, setSelectedDealId } = useCrmContext();
  const rows = crm.accounts
    .map((a: Account) => {
      const od = openDeals(crm.deals, a.id);
      return {
        a,
        count: od.length,
        pipeline: od.reduce((s, d) => s + d.amount, 0),
        top: od.sort((x, y) => y.amount - x.amount)[0],
      };
    })
    .sort((x, y) => y.pipeline - x.pipeline);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-3">
        {rows.map(({ a, count, pipeline, top }) => (
          <Card
            key={a.id}
            onClick={() => top && setSelectedDealId(top.id)}
            className={
              top
                ? "cursor-pointer p-4 transition hover:border-primary/40"
                : "p-4"
            }
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{a.name}</span>
                  {a.enrichment ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      Enriched ✓
                    </span>
                  ) : (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                      Not enriched
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-sm text-muted-foreground">
                  {a.domain}
                  {a.industry ? ` · ${a.industry}` : ""}
                  {a.location ? ` · ${a.location}` : ""}
                  {a.sizeEmployees ? ` · ${a.sizeEmployees} emp` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold tabular-nums">
                  {formatCurrency(pipeline)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {count} open deal{count === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
