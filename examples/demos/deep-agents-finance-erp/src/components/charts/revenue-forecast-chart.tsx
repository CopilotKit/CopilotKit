"use client";

import {
  ComposedChart,
  Area,
  Bar,
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
import { quarterlyRevenue } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";
import type { RevenueForecastWidget } from "@/types/dashboard";

function formatTick(value: number) {
  if (Math.abs(value) >= 1_000_000)
    return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Forecast mode — fan chart with confidence bands
// ---------------------------------------------------------------------------

function ForecastChart({
  scenarios,
}: {
  scenarios?: RevenueForecastWidget["config"]["scenarios"];
}) {
  // Default scenarios if none provided
  const defaultScenarios = [
    {
      label: "Optimistic",
      color: "#22c55e",
      values: [
        { quarter: "Q2 2026", value: 1050000 },
        { quarter: "Q3 2026", value: 1160000 },
        { quarter: "Q4 2026", value: 1280000 },
        { quarter: "Q1 2027", value: 1410000 },
      ],
    },
    {
      label: "Base",
      color: "#3b82f6",
      values: [
        { quarter: "Q2 2026", value: 920000 },
        { quarter: "Q3 2026", value: 975000 },
        { quarter: "Q4 2026", value: 1020000 },
        { quarter: "Q1 2027", value: 1070000 },
      ],
    },
    {
      label: "Conservative",
      color: "#ef4444",
      values: [
        { quarter: "Q2 2026", value: 780000 },
        { quarter: "Q3 2026", value: 810000 },
        { quarter: "Q4 2026", value: 835000 },
        { quarter: "Q1 2027", value: 855000 },
      ],
    },
  ];

  const sc = scenarios ?? defaultScenarios;
  const optimistic = sc.find((s) => s.label === "Optimistic") ?? sc[0];
  const base = sc.find((s) => s.label === "Base") ?? sc[1] ?? sc[0];
  const conservative =
    sc.find((s) => s.label === "Conservative") ?? sc[sc.length - 1];

  // Build chart data: for the band, we need the conservative as the floor
  // and a "band" that extends from conservative to optimistic
  const quarters = (base ?? optimistic).values.map((v) => v.quarter);
  const chartData = quarters.map((q, i) => {
    const opt = optimistic.values[i]?.value ?? 0;
    const bas = base.values[i]?.value ?? 0;
    const con = conservative.values[i]?.value ?? 0;
    return {
      name: q,
      optimistic: opt,
      base: bas,
      conservative: con,
      // For stacked area band: floor + band height
      bandFloor: con,
      bandHeight: opt - con,
    };
  });

  const baseTarget = chartData[chartData.length - 1]?.base ?? 0;

  return (
    <>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold tracking-tight text-foreground">
          {formatCurrency(baseTarget)}
        </span>
        <span className="text-xs text-muted-foreground">base case target</span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart
          data={chartData}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <defs>
            <linearGradient id="forecast-band" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#e5e7eb"
            vertical={false}
          />
          <XAxis
            dataKey="name"
            tick={{ fill: "#6b7280", fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#6b7280", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatTick}
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
            formatter={(value: number, name: string) => {
              if (name === "bandFloor" || name === "bandHeight")
                return [null, null];
              const labels: Record<string, string> = {
                optimistic: "Optimistic",
                base: "Base Case",
                conservative: "Conservative",
              };
              return [formatCurrency(value), labels[name] ?? name];
            }}
          />

          {/* Confidence band — stacked area: invisible floor + colored band */}
          <Area
            type="monotone"
            dataKey="bandFloor"
            stackId="band"
            fill="transparent"
            stroke="none"
          />
          <Area
            type="monotone"
            dataKey="bandHeight"
            stackId="band"
            fill="url(#forecast-band)"
            stroke="none"
          />

          {/* Scenario lines */}
          <Line
            type="monotone"
            dataKey="optimistic"
            stroke="#22c55e"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            dot={{ r: 3, fill: "#22c55e", stroke: "#fff", strokeWidth: 1.5 }}
            name="optimistic"
          />
          <Line
            type="monotone"
            dataKey="base"
            stroke="#3b82f6"
            strokeWidth={2.5}
            dot={{ r: 4, fill: "#3b82f6", stroke: "#fff", strokeWidth: 2 }}
            activeDot={{ r: 6 }}
            name="base"
          />
          <Line
            type="monotone"
            dataKey="conservative"
            stroke="#ef4444"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            dot={{ r: 3, fill: "#ef4444", stroke: "#fff", strokeWidth: 1.5 }}
            name="conservative"
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="h-0.5 w-4 rounded bg-emerald-500 opacity-60"
            style={{ borderTop: "2px dashed #22c55e" }}
          />{" "}
          Optimistic
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-blue-500" /> Base Case
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-0.5 w-4 rounded bg-red-500 opacity-60"
            style={{ borderTop: "2px dashed #ef4444" }}
          />{" "}
          Conservative
        </span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Quarterly mode — bar + margin line
// ---------------------------------------------------------------------------

function QuarterlyChart({
  trailingQuarters = 4,
  showMarginLine = true,
}: {
  trailingQuarters?: number;
  showMarginLine?: boolean;
}) {
  const data = quarterlyRevenue.slice(-trailingQuarters);

  const chartData = data.map((d) => ({
    name: d.quarter,
    revenue: d.revenue,
    profit: d.profit,
    margin: d.revenue > 0 ? Math.round((d.profit / d.revenue) * 100) : 0,
  }));

  // QoQ growth
  const latest = chartData[chartData.length - 1];
  const prev = chartData[chartData.length - 2];
  const qoqGrowth =
    prev && latest
      ? Math.round(((latest.revenue - prev.revenue) / prev.revenue) * 100)
      : 0;

  return (
    <>
      <div className="mb-3 flex items-baseline gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${qoqGrowth >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
        >
          {qoqGrowth >= 0 ? "+" : ""}
          {qoqGrowth}% QoQ
        </span>
        <span className="text-xs text-muted-foreground">revenue growth</span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart
          data={chartData}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#e5e7eb"
            vertical={false}
          />
          <XAxis
            dataKey="name"
            tick={{ fill: "#6b7280", fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            yAxisId="left"
            tick={{ fill: "#6b7280", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatTick}
          />
          {showMarginLine && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}%`}
              domain={[0, 100]}
            />
          )}
          <Tooltip
            contentStyle={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: "12px",
              fontSize: "12px",
              color: "#111827",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
            }}
            formatter={(value: number, name: string) => {
              if (name === "margin") return [`${value}%`, "Margin"];
              return [
                formatCurrency(value),
                name === "revenue" ? "Revenue" : "Profit",
              ];
            }}
          />
          <Bar
            yAxisId="left"
            dataKey="revenue"
            fill="#3b82f6"
            radius={[6, 6, 0, 0]}
            barSize={32}
            name="revenue"
            fillOpacity={0.85}
          />
          <Bar
            yAxisId="left"
            dataKey="profit"
            fill="#22c55e"
            radius={[6, 6, 0, 0]}
            barSize={32}
            name="profit"
            fillOpacity={0.85}
          />
          {showMarginLine && (
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="margin"
              stroke="#f59e0b"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#f59e0b", stroke: "#fff", strokeWidth: 2 }}
              name="margin"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Profit
        </span>
        {showMarginLine && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-amber-500" /> Margin %
          </span>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function RevenueForecastChart({
  config,
}: {
  config: RevenueForecastWidget["config"];
}) {
  const isQuarterly = config.mode === "quarterly";
  const title =
    config.title ??
    (isQuarterly ? "Quarterly Revenue & Profit" : "Revenue Scenario Forecast");
  const subtitle =
    config.subtitle ??
    (isQuarterly
      ? "Last 4 quarters — revenue, profit & margin trajectory"
      : "Next 4 quarters — three growth scenarios");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
      </CardHeader>
      <CardContent>
        {isQuarterly ? (
          <QuarterlyChart
            trailingQuarters={config.trailingQuarters}
            showMarginLine={config.showMarginLine}
          />
        ) : (
          <ForecastChart scenarios={config.scenarios} />
        )}
      </CardContent>
    </Card>
  );
}
