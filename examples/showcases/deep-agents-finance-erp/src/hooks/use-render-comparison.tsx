"use client";

import { useRenderTool } from "@copilotkit/react-core/v2";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
} from "recharts";

type ViewMode = "absolute" | "variance" | "percent";

interface ComparisonData {
  metric: string;
  periodA: number;
  periodB: number;
}

function ComparisonCard({
  labelA,
  labelB,
  data,
  title,
}: {
  labelA: string;
  labelB: string;
  data: ComparisonData[];
  title: string;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("absolute");

  const getDisplayValue = (row: ComparisonData, period: "A" | "B") => {
    if (viewMode === "absolute") {
      return formatCurrency(period === "A" ? row.periodA : row.periodB);
    }
    if (viewMode === "variance") {
      const diff = row.periodB - row.periodA;
      const prefix = diff >= 0 ? "+" : "";
      return `${prefix}${formatCurrency(diff)}`;
    }
    // percent
    const pctChange = ((row.periodB - row.periodA) / Math.abs(row.periodA || 1)) * 100;
    const prefix = pctChange >= 0 ? "+" : "";
    return `${prefix}${pctChange.toFixed(1)}%`;
  };

  const chartData = data.map((row) => ({
    name: row.metric,
    variance: row.periodB - row.periodA,
    pctChange: ((row.periodB - row.periodA) / Math.abs(row.periodA || 1)) * 100,
  }));

  return (
    <Card className="w-full border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <div className="flex gap-1 bg-muted rounded-lg p-0.5">
            {(["absolute", "variance", "percent"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${
                  viewMode === mode
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {mode === "absolute" ? "Values" : mode === "variance" ? "Δ" : "%"}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Table */}
        <div className="rounded-lg border overflow-hidden mb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-2 font-medium text-muted-foreground">Metric</th>
                {viewMode === "absolute" ? (
                  <>
                    <th className="text-right p-2 font-medium text-muted-foreground">{labelA}</th>
                    <th className="text-right p-2 font-medium text-muted-foreground">{labelB}</th>
                  </>
                ) : (
                  <th className="text-right p-2 font-medium text-muted-foreground">
                    {viewMode === "variance" ? "Variance" : "Change"}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => {
                const diff = row.periodB - row.periodA;
                const color = diff >= 0 ? "text-emerald-600" : "text-red-500";
                return (
                  <tr key={i} className="border-t border-border/50">
                    <td className="p-2 font-medium">{row.metric}</td>
                    {viewMode === "absolute" ? (
                      <>
                        <td className="text-right p-2">{getDisplayValue(row, "A")}</td>
                        <td className="text-right p-2 font-semibold">{getDisplayValue(row, "B")}</td>
                      </>
                    ) : (
                      <td className={`text-right p-2 font-bold ${color}`}>
                        {getDisplayValue(row, "B")}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Variance Bar Chart */}
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 10 }}>
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={70}
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Bar
                dataKey={viewMode === "percent" ? "pctChange" : "variance"}
                radius={[0, 4, 4, 0]}
                barSize={14}
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={entry.variance >= 0 ? "#10b981" : "#ef4444"}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function useRenderComparison() {
  useRenderTool(
    {
      name: "render_comparison",
      render: ({ args }: any) => {
        if (!args?.data) {
          return (
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 animate-pulse text-sm text-muted-foreground">
              Building comparison...
            </div>
          );
        }

        return (
          <ComparisonCard
            title={args.title || "Comparison"}
            labelA={args.labelA || "Period A"}
            labelB={args.labelB || "Period B"}
            data={args.data}
          />
        );
      },
    } as any,
    [],
  );
}
