"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { budgetVsActual } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";
import type { BudgetVarianceWidget } from "@/types/dashboard";

export function BudgetVarianceChart({
  config,
}: {
  config: BudgetVarianceWidget["config"];
}) {
  const title = config.title ?? "Budget vs Actual Variance";
  const subtitle =
    config.subtitle ??
    "Current quarter — green = under budget, red = over budget";

  const filtered = config.categories
    ? budgetVsActual.filter((d) => config.categories!.includes(d.category))
    : budgetVsActual;

  // Positive variance = under budget (good), negative = over budget (bad)
  const chartData = filtered.map((d) => ({
    name: d.category,
    variance: d.variance,
    budget: d.budget,
    actual: d.actual,
    pctVariance: d.budget !== 0 ? (d.variance / d.budget) * 100 : 0,
  }));

  const totalBudget = filtered.reduce((s, d) => s + d.budget, 0);
  const totalActual = filtered.reduce((s, d) => s + d.actual, 0);
  const totalVariance = totalBudget - totalActual;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            {subtitle && <CardDescription>{subtitle}</CardDescription>}
          </div>
          <div className="flex gap-4 text-xs">
            <div className="text-right">
              <p className="text-muted-foreground">Budget</p>
              <p className="font-semibold text-foreground">
                {formatCurrency(totalBudget)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-muted-foreground">Actual</p>
              <p className="font-semibold text-foreground">
                {formatCurrency(totalActual)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-muted-foreground">Variance</p>
              <p
                className={`font-semibold ${totalVariance >= 0 ? "text-emerald-600" : "text-red-600"}`}
              >
                {totalVariance >= 0 ? "+" : ""}
                {formatCurrency(totalVariance)}
              </p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 5, right: 60, left: 10, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e7eb"
              horizontal={false}
            />
            <XAxis
              type="number"
              tick={{ fill: "#6b7280", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => {
                if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}K`;
                return `$${v}`;
              }}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fill: "#374151", fontSize: 12, fontWeight: 500 }}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Tooltip
              contentStyle={{
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                fontSize: "12px",
                color: "#111827",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(_: any, __: any, props: any) => {
                const d = props?.payload;
                if (!d) return [null, null];
                return [
                  `Budget: ${formatCurrency(d.budget)} | Actual: ${formatCurrency(d.actual)} | Variance: ${d.variance >= 0 ? "+" : ""}${formatCurrency(d.variance)}`,
                  "",
                ];
              }}
              labelStyle={{ fontWeight: 600 }}
            />
            <ReferenceLine x={0} stroke="#9ca3af" strokeWidth={1.5} />
            <Bar dataKey="variance" radius={[0, 6, 6, 0]} barSize={28}>
              {chartData.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.variance >= 0 ? "#22c55e" : "#ef4444"}
                  fillOpacity={0.85}
                />
              ))}
              <LabelList
                dataKey="variance"
                position="right"
                formatter={(v: number) =>
                  `${v >= 0 ? "+" : ""}${formatCurrency(v)}`
                }
                style={{ fill: "#6b7280", fontSize: 11, fontWeight: 500 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Under
            Budget (savings)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Over Budget
            (overrun)
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
