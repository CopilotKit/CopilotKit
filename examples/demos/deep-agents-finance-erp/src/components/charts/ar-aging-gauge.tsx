"use client";

import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { arAging } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";
import type { ArAgingGaugeWidget } from "@/types/dashboard";

const BUCKETS = [
  { key: "current" as const, label: "Current", color: "#22c55e" },
  { key: "thirtyDay" as const, label: "31–60 days", color: "#f59e0b" },
  { key: "sixtyDay" as const, label: "61–90 days", color: "#f97316" },
  { key: "ninetyPlus" as const, label: "90+ days", color: "#ef4444" },
] as const;

export function ArAgingGauge({
  config,
}: {
  config: ArAgingGaugeWidget["config"];
}) {
  const title = config.title ?? "Accounts Receivable Aging";
  const warningThreshold = config.warningThreshold ?? 0.85;
  const criticalThreshold = config.criticalThreshold ?? 0.7;

  const rate = arAging.collectionRate;
  const ratePercent = Math.round(rate * 100);

  // Determine gauge color based on thresholds
  let gaugeColor = "#22c55e"; // green — healthy
  if (rate < criticalThreshold)
    gaugeColor = "#ef4444"; // red
  else if (rate < warningThreshold) gaugeColor = "#f59e0b"; // amber

  const gaugeData = [{ name: "rate", value: ratePercent }];

  // Max bucket value for proportional bars
  const maxBucket = Math.max(
    arAging.current,
    arAging.thirtyDay,
    arAging.sixtyDay,
    arAging.ninetyPlus,
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              Collection health & aging distribution
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-foreground">
              {formatCurrency(arAging.total)}
            </p>
            <p className="text-[11px] text-muted-foreground">Total AR</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          {/* Left: Radial gauge */}
          <div
            className="relative flex-shrink-0"
            style={{ width: 160, height: 160 }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                cx="50%"
                cy="50%"
                innerRadius="72%"
                outerRadius="100%"
                startAngle={200}
                endAngle={-20}
                data={gaugeData}
                barSize={14}
              >
                <PolarAngleAxis
                  type="number"
                  domain={[0, 100]}
                  angleAxisId={0}
                  tick={false}
                />
                {/* Background track */}
                <RadialBar
                  dataKey="value"
                  cornerRadius={10}
                  fill="#e5e7eb"
                  background={false}
                  data={[{ value: 100 }]}
                  isAnimationActive={false}
                />
                {/* Active arc */}
                <RadialBar
                  dataKey="value"
                  cornerRadius={10}
                  fill={gaugeColor}
                  data={gaugeData}
                />
              </RadialBarChart>
            </ResponsiveContainer>
            {/* Center text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="text-3xl font-bold tracking-tight"
                style={{ color: gaugeColor }}
              >
                {ratePercent}%
              </span>
              <span className="text-[10px] text-muted-foreground">
                Collection Rate
              </span>
            </div>
          </div>

          {/* Right: Aging buckets */}
          <div className="flex-1 space-y-3">
            {BUCKETS.map((bucket) => {
              const value = arAging[bucket.key];
              const pct = maxBucket > 0 ? (value / maxBucket) * 100 : 0;
              return (
                <div key={bucket.key}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {bucket.label}
                    </span>
                    <span className="font-medium text-foreground">
                      {formatCurrency(value)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.max(pct, 4)}%`,
                        backgroundColor: bucket.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
