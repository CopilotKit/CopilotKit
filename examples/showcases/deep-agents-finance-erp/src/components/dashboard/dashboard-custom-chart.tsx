"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import type { CustomChartWidget } from "@/types/dashboard";

function formatTick(value: number, format?: "currency" | "number" | "percent") {
  if (format === "percent") return `${value}%`;
  if (format === "currency" || value >= 1000) {
    if (Math.abs(value) >= 1_000_000)
      return `$${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return value.toLocaleString();
}

function formatTooltipValue(
  value: number,
  format?: "currency" | "number" | "percent",
) {
  if (format === "percent") return `${value.toFixed(1)}%`;
  if (format === "currency" || value >= 1000) {
    return `$${value.toLocaleString()}`;
  }
  return value.toLocaleString();
}

const CHART_HEIGHT: Record<number, number> = {
  1: 240,
  2: 280,
  3: 320,
  4: 320,
};

export function DashboardCustomChart({
  config,
  colSpan = 2,
}: {
  config: CustomChartWidget["config"];
  colSpan?: 1 | 2 | 3 | 4;
}) {
  const chartData = config.data.map((d) => ({ name: d.label, ...d }));
  const height = CHART_HEIGHT[colSpan] ?? 280;

  const commonProps = {
    data: chartData,
    margin: { top: 5, right: 20, left: 0, bottom: 5 },
  };

  const styledTooltip = (
    <Tooltip
      contentStyle={{
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "12px",
        fontSize: "12px",
        color: "#111827",
        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
      }}
      formatter={(value: number) => [
        formatTooltipValue(value, config.formatValues),
      ]}
    />
  );

  const renderGradients = () => (
    <defs>
      {config.series.map((s) => (
        <linearGradient
          key={s.key}
          id={`grad-${s.key}`}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor={s.color} stopOpacity={0.15} />
          <stop offset="100%" stopColor={s.color} stopOpacity={0} />
        </linearGradient>
      ))}
    </defs>
  );

  const renderChart = () => {
    switch (config.chartType) {
      case "bar":
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="name"
              tick={{ fill: "#6b7280", fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#6b7280", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => formatTick(v, config.formatValues)}
            />
            {styledTooltip}
            {config.series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={s.color}
                name={s.label}
                radius={[6, 6, 0, 0]}
              />
            ))}
          </BarChart>
        );
      case "line":
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="name"
              tick={{ fill: "#6b7280", fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#6b7280", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => formatTick(v, config.formatValues)}
            />
            {styledTooltip}
            {config.series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                name={s.label}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5, strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        );
      default:
        return (
          <AreaChart {...commonProps}>
            {renderGradients()}
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="name"
              tick={{ fill: "#6b7280", fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#6b7280", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => formatTick(v, config.formatValues)}
            />
            {styledTooltip}
            {config.series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                fill={`url(#grad-${s.key})`}
                name={s.label}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        );
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{config.title}</CardTitle>
            {config.subtitle && (
              <CardDescription>{config.subtitle}</CardDescription>
            )}
          </div>
          <div className="flex gap-4 text-xs">
            {config.series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          {renderChart()}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
