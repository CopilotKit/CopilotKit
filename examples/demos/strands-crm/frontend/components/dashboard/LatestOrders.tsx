"use client";
import { formatCurrency, STAGE_STYLES } from "@/lib/crm";
import type { CrmState, Deal, Product, Salesperson } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { OwnerAvatar, ProductThumb, SectionCard } from "./primitives";

/**
 * Section 6 — a table of the latest ~6 orders (deals). Each row shows the first
 * line item's product photo, the deal + account, the owner avatar, the amount
 * (tabular) and a stage chip. Rows hover and select the deal on click — the
 * drawer that opens lives in the app shell.
 *
 * Deals carry no created-at, so "latest" is ordered by closeDate descending,
 * which surfaces the most recently/soonest-resolving orders first.
 */
export function LatestOrders({
  crm,
  onSelect,
}: {
  crm: CrmState;
  onSelect: (id: string) => void;
}) {
  const productById = new Map<string, Product>(
    crm.products.map((p) => [p.id, p]),
  );
  const repById = new Map<string, Salesperson>(
    crm.salespeople.map((s) => [s.id, s]),
  );
  const deals: Deal[] = [...crm.deals]
    .sort(
      (a, b) =>
        new Date(b.closeDate).getTime() - new Date(a.closeDate).getTime(),
    )
    .slice(0, 6);

  return (
    <SectionCard title="Latest orders">
      {deals.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No orders yet. Ask the assistant to build a quote to get started.
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-muted-foreground">
                <th className="px-1 pb-2 font-medium">Order</th>
                <th className="px-1 pb-2 font-medium">Owner</th>
                <th className="px-1 pb-2 text-right font-medium">Amount</th>
                <th className="px-1 pb-2 font-medium">Stage</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => {
                const account = crm.accounts.find((a) => a.id === d.accountId);
                const owner = repById.get(d.ownerId);
                const firstProduct = d.lineItems[0]
                  ? productById.get(d.lineItems[0].productId)
                  : undefined;
                return (
                  <tr
                    key={d.id}
                    onClick={() => onSelect(d.id)}
                    className="cursor-pointer border-t border-border/70 transition hover:bg-secondary/60"
                  >
                    <td className="px-1 py-2">
                      <div className="flex items-center gap-2.5">
                        <ProductThumb
                          src={firstProduct?.photoUrl}
                          alt={firstProduct?.name}
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{d.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {account?.name}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-1 py-2">
                      <div className="flex items-center gap-2">
                        <OwnerAvatar
                          src={owner?.avatarUrl}
                          name={owner?.name ?? d.ownerName}
                          size={24}
                        />
                        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                          {owner?.name ?? d.ownerName}
                        </span>
                      </div>
                    </td>
                    <td className="px-1 py-2 text-right font-medium tabular-nums">
                      {formatCurrency(d.amount)}
                    </td>
                    <td className="px-1 py-2">
                      <span
                        className={cn(
                          "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
                          STAGE_STYLES[d.stage],
                        )}
                      >
                        {d.stage}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
