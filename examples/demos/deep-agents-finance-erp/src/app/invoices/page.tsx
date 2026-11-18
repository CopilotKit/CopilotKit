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
import { invoices } from "@/lib/data";
import { formatCurrency, cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import type { Invoice } from "@/types/erp";

export default function InvoicesPage() {
  return (
    <Suspense>
      <InvoicesContent />
    </Suspense>
  );
}

function InvoicesContent() {
  const searchParams = useSearchParams();
  const activeFilter = searchParams.get("filter") || "all";

  const filtered =
    activeFilter === "all"
      ? invoices
      : invoices.filter((inv) => inv.status === activeFilter);

  const totalOutstanding = invoices
    .filter((inv) => inv.status === "pending" || inv.status === "overdue")
    .reduce((sum, inv) => sum + inv.amount, 0);

  const totalPaid = invoices
    .filter((inv) => inv.status === "paid")
    .reduce((sum, inv) => sum + inv.amount, 0);

  const overdueCount = invoices.filter(
    (inv) => inv.status === "overdue",
  ).length;

  return (
    <Shell>
      <Header title="Invoices" subtitle="Manage billing and payments" />

      <div className="space-y-6 p-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Outstanding
              </p>
              <p className="mt-2 text-2xl font-bold text-amber-600">
                {formatCurrency(totalOutstanding)}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Collected YTD
              </p>
              <p className="mt-2 text-2xl font-bold text-emerald-600">
                {formatCurrency(totalPaid)}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Overdue
              </p>
              <p className="mt-2 text-2xl font-bold text-red-600">
                {overdueCount} invoice{overdueCount !== 1 && "s"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Actions Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {["all", "paid", "pending", "overdue", "draft"].map((f) => (
              <Link
                key={f}
                href={f === "all" ? "/invoices" : `/invoices?filter=${f}`}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  activeFilter === f
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {f}
              </Link>
            ))}
          </div>
          <Button>
            <Plus className="h-4 w-4" />
            New Invoice
          </Button>
        </div>

        {/* Invoice Table */}
        <Card className="p-0">
          <CardContent className="p-0">
            <DataTable<Invoice>
              keyExtractor={(row) => row.id}
              columns={[
                {
                  header: "Invoice",
                  accessor: (row) => (
                    <div>
                      <p className="font-medium text-foreground">
                        {row.number}
                      </p>
                    </div>
                  ),
                },
                {
                  header: "Client",
                  accessor: "client",
                  className: "text-foreground",
                },
                {
                  header: "Amount",
                  accessor: (row) => (
                    <span className="font-medium text-foreground">
                      {formatCurrency(row.amount)}
                    </span>
                  ),
                },
                {
                  header: "Issued",
                  accessor: "issuedDate",
                  className: "text-muted-foreground",
                },
                {
                  header: "Due Date",
                  accessor: "dueDate",
                  className: "text-muted-foreground",
                },
                {
                  header: "Items",
                  accessor: (row) => (
                    <span className="text-muted-foreground">
                      {row.items.length}
                    </span>
                  ),
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
