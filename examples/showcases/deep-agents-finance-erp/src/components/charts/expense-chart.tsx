"use client";

import { expenseBreakdown } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

interface ExpenseChartConfig {
  categories?: string[];
}

export function ExpenseChart({ config }: { config?: ExpenseChartConfig }) {
  const items = config?.categories
    ? expenseBreakdown.filter((e) => config.categories!.includes(e.category))
    : expenseBreakdown;
  const total = items.reduce((sum, item) => sum + item.amount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Expense Breakdown</CardTitle>
        <CardDescription>By category, YTD</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.category}>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="text-foreground">{item.category}</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">
                    {formatCurrency(item.amount)}
                  </span>
                  <span className="w-8 text-right text-xs text-muted-foreground">
                    {item.percentage}%
                  </span>
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${item.percentage}%`,
                    backgroundColor: item.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              Total Expenses
            </span>
            <span className="text-lg font-bold text-foreground">
              {formatCurrency(total)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
