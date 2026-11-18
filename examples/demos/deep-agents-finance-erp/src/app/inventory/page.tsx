"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Shell } from "@/components/layout/shell";
import { Header } from "@/components/layout/header";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable } from "@/components/ui/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inventoryItems } from "@/lib/data";
import { formatCurrency, cn } from "@/lib/utils";
import { AlertTriangle, Package, Plus } from "lucide-react";
import type { InventoryItem } from "@/types/erp";

export default function InventoryPage() {
  return (
    <Suspense>
      <InventoryContent />
    </Suspense>
  );
}

function InventoryContent() {
  const searchParams = useSearchParams();
  const activeFilter = searchParams.get("filter") || "all";

  const filtered =
    activeFilter === "all"
      ? inventoryItems
      : inventoryItems.filter((item) => item.status === activeFilter);

  const totalValue = inventoryItems.reduce(
    (sum, item) => sum + item.quantity * item.unitCost,
    0,
  );
  const lowStockCount = inventoryItems.filter(
    (item) => item.status === "low-stock" || item.status === "out-of-stock",
  ).length;
  const totalSKUs = inventoryItems.length;

  return (
    <Shell>
      <Header title="Inventory" subtitle="Stock management and tracking" />

      <div className="space-y-6 p-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card size="sm">
            <CardContent>
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Total SKUs
                </p>
              </div>
              <p className="mt-2 text-2xl font-bold text-foreground">
                {totalSKUs}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Inventory Value
              </p>
              <p className="mt-2 text-2xl font-bold text-foreground">
                {formatCurrency(totalValue)}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Low / Out of Stock
                </p>
              </div>
              <p className="mt-2 text-2xl font-bold text-amber-600">
                {lowStockCount} items
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {["all", "in-stock", "low-stock", "out-of-stock"].map((f) => (
              <Link
                key={f}
                href={f === "all" ? "/inventory" : `/inventory?filter=${f}`}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  activeFilter === f
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {f.replace("-", " ")}
              </Link>
            ))}
          </div>
          <Button>
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
        </div>

        {/* Inventory Table */}
        <Card className="p-0">
          <CardContent className="p-0">
            <DataTable<InventoryItem>
              keyExtractor={(row) => row.id}
              columns={[
                {
                  header: "SKU",
                  accessor: "sku",
                  className: "font-mono text-muted-foreground text-xs",
                },
                {
                  header: "Item Name",
                  accessor: "name",
                  className: "text-foreground font-medium",
                },
                {
                  header: "Category",
                  accessor: "category",
                  className: "text-muted-foreground",
                },
                {
                  header: "Qty",
                  accessor: (row) => (
                    <span
                      className={
                        row.quantity <= row.reorderLevel
                          ? "font-medium text-amber-600"
                          : "text-foreground"
                      }
                    >
                      {row.quantity}
                    </span>
                  ),
                },
                {
                  header: "Reorder Lvl",
                  accessor: (row) => (
                    <span className="text-muted-foreground">
                      {row.reorderLevel}
                    </span>
                  ),
                },
                {
                  header: "Unit Cost",
                  accessor: (row) => (
                    <span className="text-foreground">
                      {formatCurrency(row.unitCost)}
                    </span>
                  ),
                },
                {
                  header: "Location",
                  accessor: "location",
                  className: "text-muted-foreground",
                },
                {
                  header: "Status",
                  accessor: (row) => <StatusBadge status={row.status} />,
                },
              ]}
              data={filtered}
            />
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
