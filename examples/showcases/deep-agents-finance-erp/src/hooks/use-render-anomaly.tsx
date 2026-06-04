"use client";

import { useRenderTool } from "@copilotkit/react-core/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface Anomaly {
  category: string;
  currentAmount: number;
  averageAmount: number;
  deviationPct: number;
  severity: "warning" | "critical";
  description: string;
  trend: { month: string; value: number }[];
}

function AnomalyCard({ anomaly }: { anomaly: Anomaly }) {
  const severity = anomaly.severity || "warning";
  const currentAmount = anomaly.currentAmount || 0;
  const averageAmount = anomaly.averageAmount || 0;
  const deviationPct = anomaly.deviationPct || 0;
  const trend = anomaly.trend || [];
  const isCritical = severity === "critical";
  const deviationColor = isCritical ? "text-red-500" : "text-amber-500";
  const borderColor = isCritical ? "border-red-500/30" : "border-amber-500/30";
  const bgColor = isCritical ? "bg-red-500/5" : "bg-amber-500/5";
  const badgeBg = isCritical ? "bg-red-500/10 text-red-600" : "bg-amber-500/10 text-amber-600";
  const chartColor = isCritical ? "#ef4444" : "#f59e0b";

  return (
    <Card className={`w-full ${borderColor} ${bgColor}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{isCritical ? "🔴" : "⚠️"}</span>
            <CardTitle className="text-sm font-medium">{anomaly.category}</CardTitle>
          </div>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeBg}`}>
            {severity.toUpperCase()}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {/* Metrics */}
          <div className="space-y-2">
            <div>
              <p className="text-xs text-muted-foreground">Current</p>
              <p className="text-lg font-bold">{formatCurrency(currentAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">6-Month Avg</p>
              <p className="text-sm font-medium text-muted-foreground">
                {formatCurrency(averageAmount)}
              </p>
            </div>
            <p className={`text-sm font-bold ${deviationColor}`}>
              +{deviationPct.toFixed(0)}% above average
            </p>
          </div>

          {/* Sparkline */}
          <div className="h-20">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id={`grad-${anomaly.category}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={chartColor} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <ReferenceLine
                  y={averageAmount}
                  stroke="#6b7280"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={chartColor}
                  fill={`url(#grad-${anomaly.category})`}
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">{anomaly.description}</p>
      </CardContent>
    </Card>
  );
}

export function useRenderAnomalyCard() {
  useRenderTool(
    {
      name: "render_anomaly_card",
      render: ({ args, status }: any) => {
        if (!args?.anomalies) {
          return (
            <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 animate-pulse text-sm text-muted-foreground">
              Scanning for anomalies...
            </div>
          );
        }

        const anomalies: Anomaly[] = args.anomalies;

        return (
          <div className="space-y-3 w-full">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">🔍</span>
              <h3 className="text-sm font-semibold">
                {anomalies.length} Anomal{anomalies.length === 1 ? "y" : "ies"} Detected
              </h3>
            </div>
            {anomalies.map((anomaly, i) => (
              <AnomalyCard key={i} anomaly={anomaly} />
            ))}
          </div>
        );
      },
    } as any,
    [],
  );
}
