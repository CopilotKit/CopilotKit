"use client";

/**
 * Visual card for the `get_weather` backend tool. Wired up via
 * `useRenderTool` in `hooks/use-tool-renderers.ts`.
 */

import React from "react";
import { CloudSun, Loader2 } from "lucide-react";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function WeatherCard({
  city,
  temperature,
  conditions,
  loading,
}: {
  city: string;
  temperature?: number;
  conditions?: string;
  loading: boolean;
}) {
  return (
    <Card data-testid="headless-weather-card" className={cn("gap-2 py-3")}>
      <CardHeader className="px-4 [.border-b]:pb-3">
        <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <CloudSun className="h-4 w-4 text-foreground" />
          Weather
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
          <div>
            <div className="text-base font-semibold capitalize text-foreground">
              {city || "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {loading ? "Fetching forecast..." : (conditions ?? "")}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums text-foreground">
              {loading || temperature === undefined ? "—" : `${temperature}°F`}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
