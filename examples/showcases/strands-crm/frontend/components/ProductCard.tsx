"use client";
import { useState } from "react";
import { Cpu, Keyboard, Laptop, Monitor, Server } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLES, formatCurrency } from "@/lib/crm";
import type { Product, ProductCategory } from "@/lib/crm";

const CATEGORY_ICONS: Record<ProductCategory, typeof Laptop> = {
  Laptop,
  Workstation: Cpu,
  Server,
  Display: Monitor,
  Accessory: Keyboard,
};

export function ProductCard({ product }: { product: Product }) {
  const [broken, setBroken] = useState(false);
  const Icon = CATEGORY_ICONS[product.category];

  return (
    <Card className="gap-0 overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-secondary">
        {broken ? (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Icon className="h-10 w-10" aria-hidden />
          </div>
        ) : (
          <img
            src={product.photoUrl}
            alt={product.name}
            loading="lazy"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              CATEGORY_STYLES[product.category],
            )}
          >
            {product.category}
          </span>
          <span className="shrink-0 font-semibold tabular-nums">
            {formatCurrency(product.unitPrice)}
          </span>
        </div>
        <div className="mt-0.5 font-medium leading-tight">{product.name}</div>
        <div className="text-xs text-muted-foreground">{product.specs}</div>
        <p className="mt-1 text-sm text-muted-foreground">{product.blurb}</p>
      </div>
    </Card>
  );
}
