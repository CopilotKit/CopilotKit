"use client";

import { KPICard } from "@/components/ui/kpi-card";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { ExpenseChart } from "@/components/charts/expense-chart";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable } from "@/components/ui/data-table";
import { DashboardCustomChart } from "@/components/dashboard/dashboard-custom-chart";
import { CashWaterfallChart } from "@/components/charts/cash-waterfall-chart";
import { ArAgingGauge } from "@/components/charts/ar-aging-gauge";
import { BudgetVarianceChart } from "@/components/charts/budget-variance-chart";
import { SpendHeatmap } from "@/components/charts/spend-heatmap";
import { RevenueForecastChart } from "@/components/charts/revenue-forecast-chart";
import { MetricCards } from "@/components/dashboard/metric-cards";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { kpis, transactions, invoices } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { Transaction, Invoice } from "@/types/erp";
import type { DashboardWidget } from "@/types/dashboard";

const COL_SPAN_CLASS: Record<number, string> = {
  1: "col-span-1 md:col-span-1 xl:col-span-1",
  2: "col-span-1 md:col-span-1 xl:col-span-2",
  3: "col-span-1 md:col-span-2 xl:col-span-3",
  4: "col-span-1 md:col-span-2 xl:col-span-4",
};

export function colSpanClass(span: number) {
  return COL_SPAN_CLASS[span] || COL_SPAN_CLASS[2];
}

export function WidgetRenderer({ widget }: { widget: DashboardWidget }) {
  switch (widget.type) {
    case "kpi-cards":
      return <KpiCardsSection config={widget.config} />;
    case "revenue-chart":
      return <RevenueChart config={widget.config} />;
    case "expense-breakdown":
      return <ExpenseChart config={widget.config} />;
    case "recent-transactions":
      return <RecentTransactionsSection config={widget.config} />;
    case "outstanding-invoices":
      return <OutstandingInvoicesSection config={widget.config} />;
    case "custom-chart":
      return (
        <DashboardCustomChart config={widget.config} colSpan={widget.colSpan} />
      );
    case "cash-waterfall":
      return <CashWaterfallChart config={widget.config} />;
    case "ar-aging-gauge":
      return <ArAgingGauge config={widget.config} />;
    case "budget-variance":
      return <BudgetVarianceChart config={widget.config} />;
    case "spend-heatmap":
      return <SpendHeatmap config={widget.config} />;
    case "revenue-forecast":
      return <RevenueForecastChart config={widget.config} />;
    case "metric-cards":
      return <MetricCards config={widget.config} />;
    default:
      return null;
  }
}

function KpiCardsSection({ config }: { config: { metrics?: string[] } }) {
  const filtered = config.metrics
    ? kpis.filter((k) => config.metrics!.includes(k.label))
    : kpis;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {filtered.map((kpi) => (
        <KPICard key={kpi.label} kpi={kpi} />
      ))}
    </div>
  );
}

function RecentTransactionsSection({ config }: { config: { limit?: number } }) {
  const limit = config.limit ?? 5;

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <CardTitle>Recent Transactions</CardTitle>
          <Link
            href="/accounts"
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <DataTable<Transaction>
          keyExtractor={(row) => row.id}
          columns={[
            {
              header: "Description",
              accessor: "description",
              className: "text-foreground font-medium",
            },
            {
              header: "Amount",
              accessor: (row) => (
                <span
                  className={
                    row.type === "credit"
                      ? "text-emerald-600"
                      : "text-foreground"
                  }
                >
                  {row.type === "credit" ? "+" : "-"}
                  {formatCurrency(row.amount)}
                </span>
              ),
            },
            {
              header: "Status",
              accessor: (row) => <StatusBadge status={row.status} />,
            },
          ]}
          data={transactions.slice(0, limit)}
        />
      </CardContent>
    </Card>
  );
}

function OutstandingInvoicesSection({
  config,
}: {
  config: { statuses?: ("pending" | "overdue")[] };
}) {
  const statuses = config.statuses ?? ["pending", "overdue"];
  const filtered = invoices.filter((inv) =>
    statuses.includes(inv.status as "pending" | "overdue"),
  );

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <CardTitle>Outstanding Invoices</CardTitle>
          <Link
            href="/invoices"
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <DataTable<Invoice>
          keyExtractor={(row) => row.id}
          columns={[
            {
              header: "Invoice",
              accessor: (row) => (
                <div>
                  <p className="font-medium text-foreground">{row.number}</p>
                  <p className="text-xs text-muted-foreground">{row.client}</p>
                </div>
              ),
            },
            {
              header: "Amount",
              accessor: (row) => (
                <span className="text-foreground">
                  {formatCurrency(row.amount)}
                </span>
              ),
            },
            {
              header: "Due",
              accessor: "dueDate",
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
  );
}
