"use client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLES, formatCurrency } from "@/lib/crm";
import type { ProductCategory } from "@/lib/crm";

interface QuoteLineItem {
  productId: string;
  name: string;
  category: ProductCategory;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  photoUrl: string;
}

export interface QuoteResult {
  accountId: string;
  accountName: string;
  useCase?: string;
  seats?: number;
  lineItems: QuoteLineItem[];
  subtotal: number;
  note: string;
}

export function QuoteCard({
  result,
  status,
  onApprove,
  onAddToDeal,
}: {
  result?: QuoteResult;
  status: string;
  onApprove?: (quote: QuoteResult) => void;
  onAddToDeal?: () => void;
}) {
  if (status !== "complete") {
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        Building a hardware quote…
      </div>
    );
  }
  if (!result || !Array.isArray(result.lineItems)) {
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        A quote isn’t available right now.
      </div>
    );
  }

  const subtitleBits = [
    result.useCase,
    typeof result.seats === "number" ? `${result.seats} seats` : undefined,
  ].filter(Boolean) as string[];

  return (
    <div className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">
            Hardware quote
          </div>
          <div className="truncate text-base font-semibold text-foreground">
            {result.accountName}
          </div>
          {subtitleBits.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {subtitleBits.join(" · ")}
            </div>
          )}
        </div>
      </div>

      <ul className="divide-y divide-border">
        {result.lineItems.map((li) => (
          <li key={li.productId} className="flex items-center gap-3 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={li.photoUrl}
              alt={li.name}
              className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-foreground">
                  {li.name}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    CATEGORY_STYLES[li.category],
                  )}
                >
                  {li.category}
                </span>
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {li.qty} × {formatCurrency(li.unitPrice)}
              </div>
            </div>
            <div className="shrink-0 text-right font-medium text-foreground tabular-nums">
              {formatCurrency(li.lineTotal)}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-sm font-semibold text-foreground">Subtotal</span>
        <span className="text-base font-semibold text-foreground tabular-nums">
          {formatCurrency(result.subtotal)}
        </span>
      </div>

      {result.note && (
        <p className="mt-2 text-xs text-muted-foreground">{result.note}</p>
      )}

      {(onApprove || onAddToDeal) && (
        <div className="mt-3 flex gap-2">
          {onApprove && (
            <Button size="sm" onClick={() => onApprove(result)}>
              Approve quote
            </Button>
          )}
          {onAddToDeal && (
            <Button size="sm" variant="outline" onClick={onAddToDeal}>
              Add to deal
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
