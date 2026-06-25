"use client";
import { useState } from "react";
import { formatCurrency, dealRisk } from "@/lib/crm";
import type { Deal, Account, Product, Salesperson } from "@/lib/crm";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

function initials(name?: string) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Small rounded product thumbnail with a graceful icon fallback. */
function ProductThumb({ product }: { product?: Product }) {
  const [failed, setFailed] = useState(false);
  if (!product || failed || !product.photoUrl) {
    return (
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground"
        title={product?.name}
      >
        <Package className="h-4 w-4" />
      </div>
    );
  }
  return (
    <img
      src={product.photoUrl}
      alt={product.name}
      title={product.name}
      onError={() => setFailed(true)}
      className="h-9 w-9 shrink-0 rounded-lg border border-border object-cover"
    />
  );
}

export function DealCard({
  deal,
  account,
  contactName,
  product,
  owner,
  selected,
  onSelect,
}: {
  deal: Deal;
  account?: Account;
  contactName?: string;
  /** Resolved product for the deal's first line item (for the thumbnail). */
  product?: Product;
  /** Resolved deal owner (for the avatar). */
  owner?: Salesperson;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const risk = dealRisk(deal);
  const ownerName = owner?.name ?? deal.ownerName;
  return (
    <button
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", deal.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onSelect(deal.id)}
      className={cn(
        "w-full cursor-grab rounded-xl border bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md active:cursor-grabbing",
        selected ? "border-primary ring-1 ring-ring" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <ProductThumb product={product} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground">
              {account?.name}
            </span>
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: `var(--risk-${risk})` }}
              title={`Risk: ${risk}`}
            />
          </div>
          <div className="mt-1 truncate text-sm font-medium">{deal.name}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-semibold tabular-nums">
          {formatCurrency(deal.amount)}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {deal.probability}%
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${deal.probability}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {contactName ?? "No contact"}
        </span>
        <div
          className="flex items-center gap-1.5"
          title={ownerName ? `Owner: ${ownerName}` : undefined}
        >
          <Avatar size="sm">
            {owner?.avatarUrl ? (
              <AvatarImage src={owner.avatarUrl} alt={ownerName} />
            ) : null}
            <AvatarFallback>{initials(ownerName)}</AvatarFallback>
          </Avatar>
        </div>
      </div>
    </button>
  );
}
