"use client";

import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { z } from "zod";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Skeleton } from "@/components/ui/skeleton";

export const lineChartSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(80)
    .describe("A short chart title shown above the chart."),
  description: z
    .string()
    .max(160)
    .optional()
    .describe("Optional one-sentence context for the chart."),
  unit: z
    .string()
    .max(20)
    .optional()
    .describe("Optional unit label, such as score, count, or value."),
  data: z
    .array(
      z.object({
        label: z.string().min(1).max(32),
        value: z.number().finite().min(-1000000).max(1000000),
      }),
    )
    .min(2)
    .max(12)
    .describe("Between 2 and 12 ordered finite numeric points."),
});

export type LineChartCardProps = z.infer<typeof lineChartSchema>;

type RuntimeLineChartCardProps = Partial<Omit<LineChartCardProps, "data">> & {
  data?: unknown;
};

type LinePoint = {
  label: string;
  value: number;
};

const chartConfig = {
  value: {
    color: "var(--chart-1)",
    label: "Value",
  },
} satisfies ChartConfig;

const LINE_CHART_HEIGHT = 180;
const MotionCard = motion.create(Card);

function LineChartCard(props: RuntimeLineChartCardProps) {
  const prefersReducedMotion = useReducedMotion();
  const title = textOrDefault(props.title, "Simple trend");
  const description =
    optionalText(props.description) ?? "A compact trend over time.";
  const unit = optionalText(props.unit);
  const data = normalizeData(props.data);

  return (
    <MotionCard
      size="sm"
      className="w-full max-w-full gap-3 border border-border/70 bg-card/95 shadow-none ring-0"
      initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
      animate={
        prefersReducedMotion ? undefined : { opacity: 1, scale: 1, y: 0 }
      }
      transition={
        prefersReducedMotion
          ? undefined
          : { duration: 0.28, ease: [0.23, 1, 0.32, 1] as const }
      }
    >
      <CardHeader className="gap-1 pb-0">
        <CardTitle className="text-base leading-tight">{title}</CardTitle>
        {description ? (
          <CardDescription className="line-clamp-2">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        {data.length < 2 ? (
          <Marker className="text-sm text-muted-foreground">
            <MarkerContent>
              Waiting for at least two ordered data points.
            </MarkerContent>
          </Marker>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto w-full"
            style={{ height: LINE_CHART_HEIGHT }}
          >
            <LineChart
              accessibilityLayer
              data={data}
              margin={{ top: 12, right: 8, bottom: 8, left: 8 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis hide axisLine={false} dataKey="label" tickLine={false} />
              <YAxis hide axisLine={false} domain={["auto", "auto"]} />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideLabel={false}
                    indicator="line"
                    labelFormatter={(label) => (
                      <span className="max-w-40 truncate">{label}</span>
                    )}
                    formatter={(value) => (
                      <span className="font-mono font-medium tabular-nums">
                        {formatTooltipValue(value, unit)}
                      </span>
                    )}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--color-value)"
                strokeWidth={2.5}
                dot={{
                  fill: "var(--color-value)",
                  r: 3,
                  strokeWidth: 0,
                }}
                activeDot={{
                  fill: "var(--background)",
                  r: 5,
                  stroke: "var(--color-value)",
                  strokeWidth: 2,
                }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </MotionCard>
  );
}

function LineChartCardSkeleton() {
  return (
    <Card
      size="sm"
      className="w-full max-w-full gap-3 border border-border/70 bg-card/95 shadow-none ring-0"
      aria-label="Loading line chart"
    >
      <CardHeader className="gap-2 pb-0">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-52" />
      </CardHeader>
      <CardContent>
        <Skeleton className="w-full" style={{ height: LINE_CHART_HEIGHT }} />
      </CardContent>
    </Card>
  );
}

function normalizeData(data: unknown): LinePoint[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.slice(0, 12).flatMap((point, index) => {
    if (!point || typeof point !== "object") {
      return [];
    }

    const rawLabel = "label" in point ? point.label : undefined;
    const rawValue = "value" in point ? point.value : undefined;
    const value =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string"
          ? Number(rawValue)
          : Number.NaN;

    if (typeof rawLabel !== "string" || !Number.isFinite(value)) {
      return [];
    }

    return [
      {
        label: rawLabel.trim().slice(0, 32) || `Point ${index + 1}`,
        value,
      },
    ];
  });
}

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function textOrDefault(value: unknown, fallback: string) {
  return optionalText(value) ?? fallback;
}

function compactNumber(value: unknown) {
  if (typeof value !== "number") {
    return String(value);
  }

  return Intl.NumberFormat("en", {
    maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0,
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
  }).format(value);
}

function formatTooltipValue(value: unknown, unit?: string) {
  if (typeof value !== "number") {
    return String(value);
  }

  const formatted = compactNumber(value);

  return unit ? `${formatted} ${unit}` : formatted;
}

export { LineChartCard, LineChartCardSkeleton };
