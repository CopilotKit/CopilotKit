"use client";

/**
 * Visual card for the `get_revenue_chart` backend tool. Renders a small
 * recharts bar chart inside the same Card chrome as WeatherCard /
 * StockCard so all three tools share a visual language.
 *
 * Wired up via `useRenderTool` in `hooks/use-tool-renderers.tsx`.
 */

import React from "react";
import {
  Bar,
  BarChart as RechartsBarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Loader2 } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const BAR_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#10b981",
  "#0ea5e9",
];

export type ChartPoint = { label: string; value: number };

export function ChartCard({
  title,
  subtitle,
  data,
  loading,
}: {
  title?: string;
  subtitle?: string;
  data?: ChartPoint[];
  loading: boolean;
}) {
  const points = Array.isArray(data) ? data : [];
  const hasData = points.length > 0;

  return (
    <Card data-testid="headless-revenue-chart" className="gap-2 py-3">
      <CardHeader className="px-4 [.border-b]:pb-3">
        <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <BarChart3 className="h-4 w-4 text-foreground" />
          {title || "Chart"}
        </CardTitle>
        {loading && (
          <CardAction>
            <Badge
              variant="secondary"
              className="gap-1 text-[10px] font-normal"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              running
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-4">
        {subtitle && (
          <div className="mb-2 text-xs text-muted-foreground">{subtitle}</div>
        )}
        {hasData ? (
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart
                data={points}
                margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
              >
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "currentColor" }}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "currentColor" }}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                  width={32}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "var(--foreground)",
                  }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={36}>
                  {points.map((_, i) => (
                    <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                  ))}
                </Bar>
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {loading ? "Building chart…" : "No data"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
