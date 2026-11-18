"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { cashFlowData } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";
import type { CashWaterfallWidget } from "@/types/dashboard";

function formatTick(value: number) {
  if (Math.abs(value) >= 1_000_000)
    return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// Waterfall mode — shows cash flow components building the net position
// ---------------------------------------------------------------------------

function WaterfallChart({
  quarters = 8,
  showNetLine = true,
}: {
  quarters?: number;
  showNetLine?: boolean;
}) {
  const data = cashFlowData.slice(-quarters);

  // Build waterfall data: each bar floats from a running base
  let runningNet = 0;
  const waterfallData = data.map((d) => {
    const base = runningNet;
    runningNet += d.net;
    return {
      name: d.quarter,
      // Stacked segments from the base
      base: Math.min(base, base + d.operating),
      operating: d.operating,
      investing: d.investing,
      financing: d.financing,
      net: runningNet,
      // For tooltip
      _operating: d.operating,
      _investing: d.investing,
      _financing: d.financing,
      _net: d.net,
    };
  });

  const latestNet = waterfallData[waterfallData.length - 1]?.net ?? 0;

  return (
    <>
      <div className="mb-4 flex items-baseline gap-3">
        <span className="text-3xl font-bold tracking-tight text-foreground">
          {formatCurrency(latestNet)}
        </span>
        <span className="text-sm text-muted-foreground">
          cumulative net cash flow
        </span>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={waterfallData}
          margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
        >
          <defs>
            <linearGradient id="waterfall-net-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
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
              if (name === "base") return [null, null];
              const labels: Record<string, string> = {
                operating: "Operating",
                investing: "Investing",
                financing: "Financing",
                net: "Cumulative Net",
              };
              return [formatCurrency(value), labels[name] ?? name];
            }}
            labelStyle={{ fontWeight: 600 }}
          />
          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />

          {/* Invisible base bar */}
          <Bar
            dataKey="base"
            stackId="waterfall"
            fill="transparent"
            stroke="none"
          />

          {/* Operating (green) */}
          <Bar
            dataKey="operating"
            stackId="waterfall"
            name="operating"
            radius={[4, 4, 0, 0]}
          >
            {waterfallData.map((_, i) => (
              <Cell key={i} fill="#22c55e" fillOpacity={0.85} />
            ))}
          </Bar>

          {/* Investing (red — negative values) */}
          <Bar
            dataKey="investing"
            stackId="waterfall"
            name="investing"
            radius={[4, 4, 0, 0]}
          >
            {waterfallData.map((_, i) => (
              <Cell key={i} fill="#ef4444" fillOpacity={0.85} />
            ))}
          </Bar>

          {/* Financing (amber — negative values) */}
          <Bar
            dataKey="financing"
            stackId="waterfall"
            name="financing"
            radius={[4, 4, 0, 0]}
          >
            {waterfallData.map((_, i) => (
              <Cell key={i} fill="#f59e0b" fillOpacity={0.85} />
            ))}
          </Bar>

          {/* Net cumulative line overlay */}
          {showNetLine && (
            <Line
              type="monotone"
              dataKey="net"
              stroke="#3b82f6"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "#3b82f6", stroke: "#fff", strokeWidth: 2 }}
              activeDot={{ r: 6, strokeWidth: 2 }}
              name="net"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Operating
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Investing
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Financing
        </span>
        {showNetLine && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-blue-500" /> Cumulative Net
          </span>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Flow-comparison mode — butterfly/mirror bars (inflows up, outflows down)
// ---------------------------------------------------------------------------

function FlowComparisonChart({
  comparisonData,
}: {
  comparisonData?: { quarter: string; inflow: number; outflow: number }[];
}) {
  // Default data derived from cashFlowData if none provided
  const data =
    comparisonData ??
    cashFlowData.slice(-4).map((d) => ({
      quarter: d.quarter,
      inflow: d.operating,
      outflow: -(Math.abs(d.investing) + Math.abs(d.financing)),
    }));

  const chartData = data.map((d) => ({
    name: d.quarter,
    inflow: d.inflow,
    outflow: d.outflow < 0 ? d.outflow : -d.outflow,
  }));

  return (
    <>
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
              return [
                formatCurrency(Math.abs(value)),
                name === "inflow" ? "Inflows" : "Outflows",
              ];
            }}
          />
          <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1.5} />
          <Bar dataKey="inflow" name="inflow" radius={[6, 6, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill="#22c55e" fillOpacity={0.85} />
            ))}
          </Bar>
          <Bar dataKey="outflow" name="outflow" radius={[0, 0, 6, 6]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill="#ef4444" fillOpacity={0.85} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Inflows
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Outflows
        </span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function CashWaterfallChart({
  config,
}: {
  config: CashWaterfallWidget["config"];
}) {
  const title =
    config.title ??
    (config.mode === "waterfall" ? "Cash Flow Waterfall" : "Inflow vs Outflow");
  const subtitle =
    config.subtitle ??
    (config.mode === "waterfall"
      ? "Quarterly cash flow components — operating, investing, financing"
      : "Quarterly cash movement comparison");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
      </CardHeader>
      <CardContent>
        {config.mode === "waterfall" ? (
          <WaterfallChart
            quarters={config.quarters}
            showNetLine={config.showNetLine}
          />
        ) : (
          <FlowComparisonChart comparisonData={config.comparisonData} />
        )}
      </CardContent>
    </Card>
  );
}
