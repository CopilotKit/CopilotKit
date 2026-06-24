"use client";

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

/**
 * Compact revenue chart card rendered when the backend `get_revenue_chart`
 * tool runs. Wired to the manual `useRenderToolCall` path via the
 * `useRenderTool({ name: "get_revenue_chart", ... })` registration in
 * `tool-renderers.tsx`.
 *
 * Visual chrome matches the sibling WeatherCard / StockCard (raw tailwind
 * card around a content body) — we deliberately do NOT import shadcn
 * `Card` primitives here so the three headless cards stay visually
 * consistent within the built-in-agent integration.
 */

export type ChartPoint = { label: string; value: number };

export interface ChartCardProps {
  loading: boolean;
  title?: string;
  subtitle?: string;
  data?: ChartPoint[];
}

const BAR_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#10b981",
  "#0ea5e9",
];

export function ChartCard({ loading, title, subtitle, data }: ChartCardProps) {
  const points = Array.isArray(data) ? data : [];
  const hasData = points.length > 0;

  return (
    <div
      data-testid="headless-revenue-chart"
      className="mt-2 mb-2 max-w-sm rounded-xl border border-[#DBDBE5] bg-white p-3 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#838389]">
            {loading ? "Building chart" : "Revenue"}
          </div>
          <div className="truncate text-sm font-semibold text-[#010507]">
            {title || "Chart"}
          </div>
        </div>
      </div>
      {subtitle && (
        <div className="mt-1 text-[11px] text-[#57575B]">{subtitle}</div>
      )}
      {hasData ? (
        <div className="mt-2 h-44 w-full">
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
                className="text-[#57575B]"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "currentColor" }}
                tickLine={false}
                axisLine={false}
                className="text-[#57575B]"
                width={32}
              />
              <Tooltip
                cursor={{ fill: "#EDEDF5", opacity: 0.5 }}
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #DBDBE5",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "#010507",
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
        <div className="py-6 text-center text-xs text-[#57575B]">
          {loading ? "Building chart…" : "No data"}
        </div>
      )}
    </div>
  );
}
