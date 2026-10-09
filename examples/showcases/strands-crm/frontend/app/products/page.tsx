"use client";
import { useState } from "react";
import { useCrmContext } from "@/components/crm-context";
import { ProductCard } from "@/components/ProductCard";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CATEGORY_STYLES } from "@/lib/crm";
import type { Product, ProductCategory } from "@/lib/crm";

const CATEGORIES = Object.keys(CATEGORY_STYLES) as ProductCategory[];
type Filter = "All" | ProductCategory;
const FILTERS: Filter[] = ["All", ...CATEGORIES];

const CATEGORY_ORDER: Record<ProductCategory, number> = Object.fromEntries(
  CATEGORIES.map((c, i) => [c, i]),
) as Record<ProductCategory, number>;

function sortProducts(products: Product[]): Product[] {
  return [...products].sort(
    (a, b) =>
      CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
      a.unitPrice - b.unitPrice,
  );
}

export default function ProductsPage() {
  const { crm, loading } = useCrmContext();
  const [filter, setFilter] = useState<Filter>("All");

  const products = sortProducts(
    filter === "All"
      ? crm.products
      : crm.products.filter((p) => p.category === filter),
  );

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Products</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Enterprise computers, workstations, servers, displays, and
            accessories.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-medium transition",
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-[16/9] w-full rounded-xl" />
                <Skeleton className="h-4 w-2/3 rounded-full" />
                <Skeleton className="h-4 w-1/3 rounded-full" />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No products in this category.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
