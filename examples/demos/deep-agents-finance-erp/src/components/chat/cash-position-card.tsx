"use client";

import { DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { ToolCallStatus } from "@copilotkit/react-core/v2";

type AccountRow = {
  name: string;
  balance: number;
};

type Args = {
  accounts: AccountRow[];
  totalCash: number;
  totalLiabilities: number;
  netPosition: number;
};

type Props = {
  args: Args | Partial<Args>;
  status: string;
};

export function CashPositionCard({ args, status }: Props) {
  if (status === "inProgress" || !args.accounts) {
    return (
      <div className="my-2 animate-in fade-in slide-in-from-bottom-2 rounded-2xl border border-border bg-card p-5 duration-300 ease-out">
        <div className="flex items-center gap-2 text-muted-foreground">
          <DollarSign className="h-4 w-4 animate-pulse" />
          <span className="text-sm">Calculating cash position...</span>
        </div>
      </div>
    );
  }

  const { accounts, totalCash, totalLiabilities, netPosition } = args as Args;

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(n);

  const isPositive = netPosition >= 0;

  return (
    <div className="my-2 animate-in fade-in slide-in-from-bottom-2 rounded-2xl border border-border bg-card p-5 duration-300 ease-out">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <DollarSign className="h-4 w-4 text-primary" />
        </div>
        <p className="text-sm font-semibold text-foreground">
          Cash Position Summary
        </p>
      </div>

      {/* Accounts table */}
      <div className="mb-4 rounded-xl border border-border/50 bg-muted/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.name} className="border-b border-border/30">
                <td className="px-3 py-2 text-foreground">{account.name}</td>
                <td className="px-3 py-2 text-right font-medium text-foreground">
                  {formatCurrency(account.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="space-y-2 rounded-xl border border-border/50 bg-muted/50 px-3 py-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-medium text-muted-foreground">Total Cash</span>
          <span className="font-semibold text-foreground">
            {formatCurrency(totalCash)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-medium text-muted-foreground">
            Total Liabilities
          </span>
          <span className="font-semibold text-foreground">
            {formatCurrency(totalLiabilities)}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="font-medium text-muted-foreground">
            Net Position
          </span>
          <span
            className={`flex items-center gap-1 text-sm font-bold ${isPositive ? "text-emerald-600" : "text-red-600"}`}
          >
            {isPositive ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {formatCurrency(netPosition)}
          </span>
        </div>
      </div>
    </div>
  );
}
