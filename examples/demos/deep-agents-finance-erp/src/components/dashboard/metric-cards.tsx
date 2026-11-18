"use client";

import {
  DollarSign,
  TrendingUp,
  FileText,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { kpis } from "@/lib/data";
import type { MetricCardsWidget } from "@/types/dashboard";

const iconMap: Record<string, React.ElementType> = {
  "dollar-sign": DollarSign,
  "trending-up": TrendingUp,
  "file-text": FileText,
  receipt: Receipt,
};

export function MetricCards({
  config,
}: {
  config: MetricCardsWidget["config"];
}) {
  const filtered = kpis.filter((k) => config.metrics.includes(k.label));

  return (
    <div
      className={cn(
        "grid gap-4 h-full",
        config.stacked
          ? "grid-cols-1"
          : filtered.length === 1
            ? "grid-cols-1"
            : "grid-cols-1 sm:grid-cols-2",
      )}
    >
      {filtered.map((kpi) => {
        const Icon = iconMap[kpi.icon] || DollarSign;
        const isPositive = kpi.trend === "up";

        return (
          <Card
            key={kpi.label}
            className="flex flex-col justify-center"
            size="sm"
          >
            <CardContent>
              <div className="flex items-start justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                  <Icon className="h-5.5 w-5.5 text-primary" />
                </div>
                <div
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                    isPositive
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-red-50 text-red-600",
                  )}
                >
                  {isPositive ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  )}
                  {Math.abs(kpi.change)}%
                </div>
              </div>

              <div className="mt-4">
                <p className="text-3xl font-bold tracking-tight text-foreground">
                  {kpi.value}
                </p>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {kpi.label}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
