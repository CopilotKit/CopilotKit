"use client";

import { Shell } from "@/components/layout/shell";
import { Header } from "@/components/layout/header";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable } from "@/components/ui/data-table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { accounts, transactions } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";
import type { Account, Transaction } from "@/types/erp";

const accountTypeColors: Record<string, string> = {
  asset: "text-emerald-700 bg-emerald-50",
  liability: "text-rose-700 bg-rose-50",
  equity: "text-blue-700 bg-blue-50",
  revenue: "text-sky-700 bg-sky-50",
  expense: "text-amber-700 bg-amber-50",
};

export default function AccountsPage() {
  const totalAssets = accounts
    .filter((a) => a.type === "asset")
    .reduce((sum, a) => sum + a.balance, 0);
  const totalLiabilities = accounts
    .filter((a) => a.type === "liability")
    .reduce((sum, a) => sum + a.balance, 0);

  return (
    <Shell>
      <Header title="Accounts" subtitle="Chart of accounts and transactions" />

      <div className="space-y-6 p-8">
        {/* Balance Summary */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Total Assets
              </p>
              <p className="mt-2 text-2xl font-bold text-emerald-600">
                {formatCurrency(totalAssets)}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Total Liabilities
              </p>
              <p className="mt-2 text-2xl font-bold text-rose-600">
                {formatCurrency(totalLiabilities)}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Net Position
              </p>
              <p className="mt-2 text-2xl font-bold text-primary">
                {formatCurrency(totalAssets - totalLiabilities)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Chart of Accounts */}
        <Card className="p-0">
          <CardHeader className="border-b">
            <CardTitle>Chart of Accounts</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable<Account>
              keyExtractor={(row) => row.id}
              columns={[
                {
                  header: "Code",
                  accessor: "code",
                  className: "font-mono text-muted-foreground",
                },
                {
                  header: "Account Name",
                  accessor: "name",
                  className: "text-foreground font-medium",
                },
                {
                  header: "Type",
                  accessor: (row) => (
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${accountTypeColors[row.type]}`}
                    >
                      {row.type}
                    </span>
                  ),
                },
                {
                  header: "Balance",
                  accessor: (row) => (
                    <span className="font-medium text-foreground">
                      {formatCurrency(row.balance)}
                    </span>
                  ),
                },
              ]}
              data={accounts}
            />
          </CardContent>
        </Card>

        {/* Transaction Ledger */}
        <Card className="p-0">
          <CardHeader className="border-b">
            <CardTitle>Transaction Ledger</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable<Transaction>
              keyExtractor={(row) => row.id}
              columns={[
                {
                  header: "Date",
                  accessor: "date",
                  className: "text-muted-foreground",
                },
                {
                  header: "Description",
                  accessor: "description",
                  className: "text-foreground font-medium",
                },
                {
                  header: "Category",
                  accessor: "category",
                  className: "text-muted-foreground",
                },
                {
                  header: "Account",
                  accessor: "accountCode",
                  className: "font-mono text-muted-foreground",
                },
                {
                  header: "Amount",
                  accessor: (row) => (
                    <span
                      className={
                        row.type === "credit"
                          ? "font-medium text-emerald-600"
                          : "font-medium text-foreground"
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
              data={transactions}
            />
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
