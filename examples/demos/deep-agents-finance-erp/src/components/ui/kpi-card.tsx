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
import type { KPI } from "@/types/erp";

const iconMap: Record<string, React.ElementType> = {
  "dollar-sign": DollarSign,
  "trending-up": TrendingUp,
  "file-text": FileText,
  receipt: Receipt,
};

export function KPICard({ kpi }: { kpi: KPI }) {
  const Icon = iconMap[kpi.icon] || DollarSign;
  const isPositive = kpi.trend === "up";

  return (
    <Card
      className="group transition-all duration-300 hover:shadow-lg"
      size="sm"
    >
      <CardContent>
        <div className="flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
              isPositive
                ? "bg-emerald-50 text-emerald-600"
                : "bg-red-50 text-red-600",
            )}
          >
            {isPositive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {Math.abs(kpi.change)}%
          </div>
        </div>

        <div className="mt-4">
          <p className="text-2xl font-bold tracking-tight text-foreground">
            {kpi.value}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{kpi.label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
