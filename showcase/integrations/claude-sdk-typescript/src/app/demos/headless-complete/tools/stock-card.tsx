"use client";

/**
 * Visual card for the `get_stock_price` backend tool. Wired up via
 * `useRenderTool` in `hooks/use-tool-renderers.ts`.
 */

import React from "react";
import { LineChart, Loader2 } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StockCard({
  ticker,
  price,
  change,
  loading,
}: {
  ticker: string;
  price?: number;
  change?: number;
  loading: boolean;
}) {
  const positive = (change ?? 0) >= 0;
  return (
    <Card data-testid="headless-stock-card" className={cn("gap-2 py-3")}>
      <CardHeader className="px-4 [.border-b]:pb-3">
        <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <LineChart className="h-4 w-4 text-foreground" />
          {ticker || "Stock"}
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
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {loading ? "Pricing..." : "Last price"}
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-foreground">
              {loading || price === undefined ? "—" : `$${price.toFixed(2)}`}
            </div>
            {!loading && change !== undefined && (
              <div
                className={cn(
                  "text-xs font-medium tabular-nums",
                  positive ? "text-emerald-600" : "text-red-600",
                )}
              >
                {positive ? "+" : ""}
                {change}%
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
