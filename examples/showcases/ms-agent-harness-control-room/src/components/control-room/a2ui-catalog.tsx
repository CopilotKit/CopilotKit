"use client";

import { createCatalog } from "@copilotkit/a2ui-renderer";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  Area,
  AreaChart,
  XAxis,
  YAxis,
} from "recharts";
import type { ReactNode } from "react";
import type { z } from "zod";

import { Badge } from "@/components/ui/badge";
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
import type {
  areaPointSchema,
  categoryPointSchema,
  fileSchema,
  metricSchema,
  tableRowSchema,
} from "@/lib/control-room-a2ui-definitions";
import {
  CONTROL_ROOM_A2UI_CATALOG_ID,
  controlRoomA2UIDefinitions,
} from "@/lib/control-room-a2ui-definitions";
import { cn } from "@/lib/utils";

const DEFAULT_METRICS: z.infer<typeof metricSchema>[] = [
  { label: "Mode", value: "Plan" },
  { label: "Files", value: "2" },
  { label: "Todos", value: "3" },
];

const DEFAULT_POINTS: z.infer<typeof categoryPointSchema>[] = [
  { label: "Alpha", value: 12 },
  { label: "Beta", value: 18 },
  { label: "Gamma", value: 15 },
];

const DEFAULT_AREA_POINTS: z.infer<typeof areaPointSchema>[] = [
  { label: "Jan", primary: 12, secondary: 8 },
  { label: "Feb", primary: 18, secondary: 14 },
  { label: "Mar", primary: 24, secondary: 19 },
  { label: "Apr", primary: 30, secondary: 23 },
];

const DEFAULT_ROWS: z.infer<typeof tableRowSchema>[] = [
  { label: "Tests", status: "ready", value: "pass" },
  { label: "Coverage", status: "pending", value: "not run" },
  { label: "Memory", status: "saved", value: "1 note" },
];

const DEFAULT_FILES: z.infer<typeof fileSchema>[] = [
  { path: "README.md", status: "read", detail: "Workspace overview." },
  { path: "data/revenue.csv", status: "sample", detail: "Chart data." },
];

const CHART_COLORS = {
  indigo: "var(--cr-chart-indigo)",
  blue: "var(--cr-chart-blue)",
  mint: "var(--cr-chart-mint)",
} as const;

const chartConfig = {
  value: { label: "Value", color: CHART_COLORS.blue },
  primary: { label: "Primary", color: CHART_COLORS.indigo },
  secondary: { label: "Secondary", color: CHART_COLORS.mint },
} satisfies ChartConfig;

function withFallbackArray<T>(value: T[] | undefined, fallback: T[]) {
  return Array.isArray(value) && value.length > 0 ? value : fallback;
}

function A2UICard({
  label,
  title,
  description,
  children,
}: {
  label: string;
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="my-4 max-w-3xl overflow-hidden">
      <CardHeader className="space-y-2">
        <Badge className="w-fit" variant="secondary">
          {label}
        </Badge>
        <CardTitle>{title ?? label}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export const controlRoomA2UIRenderers = {
  HarnessSummary: ({ props }) => {
    const metrics = withFallbackArray(props?.metrics, DEFAULT_METRICS);
    return (
      <A2UICard
        label="Harness summary"
        title={props?.title ?? "Harness Summary"}
        description={props?.description ?? "Current workspace and run status."}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((metric) => (
            <div
              key={`${metric.label}-${metric.value}`}
              className="rounded-2xl border bg-muted/30 p-3"
            >
              <div className="text-xs text-muted-foreground">
                {metric.label}
              </div>
              <div className="mt-1 text-xl font-semibold">{metric.value}</div>
              {metric.detail ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {metric.detail}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </A2UICard>
    );
  },
  BarChart: ({ props }) => {
    const data = withFallbackArray(props?.data, DEFAULT_POINTS);
    return (
      <A2UICard
        label="bar chart"
        title={props?.title ?? "Bar Chart"}
        description={props?.description ?? "Compare values across categories."}
      >
        <ChartContainer config={chartConfig} className="min-h-[260px]">
          <BarChart data={data} margin={{ left: 8, right: 8, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="value"
              fill={CHART_COLORS.blue}
              radius={[8, 8, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </A2UICard>
    );
  },
  LineChart: ({ props }) => {
    const data = withFallbackArray(props?.data, DEFAULT_POINTS);
    return (
      <A2UICard
        label="line chart"
        title={props?.title ?? "Line Chart"}
        description={props?.description ?? "Show movement across a sequence."}
      >
        <ChartContainer config={chartConfig} className="min-h-[260px]">
          <LineChart data={data} margin={{ left: 8, right: 8, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Line
              dataKey="value"
              type="monotone"
              stroke={CHART_COLORS.indigo}
              strokeWidth={3}
              dot={{ r: 4, fill: "white", strokeWidth: 2 }}
            />
          </LineChart>
        </ChartContainer>
      </A2UICard>
    );
  },
  AreaChart: ({ props }) => {
    const data = withFallbackArray(props?.data, DEFAULT_AREA_POINTS);
    return (
      <A2UICard
        label="area chart"
        title={props?.title ?? "Area Chart"}
        description={props?.description ?? "Show a trend with a filled line."}
      >
        <ChartContainer config={chartConfig} className="min-h-[260px]">
          <AreaChart data={data} margin={{ left: 8, right: 8, top: 12 }}>
            <defs>
              <linearGradient id="a2uiPrimaryFill" x1="0" x2="0" y1="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={CHART_COLORS.indigo}
                  stopOpacity={0.35}
                />
                <stop
                  offset="95%"
                  stopColor={CHART_COLORS.indigo}
                  stopOpacity={0.05}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              dataKey="primary"
              type="monotone"
              stroke={CHART_COLORS.indigo}
              strokeWidth={3}
              fill="url(#a2uiPrimaryFill)"
            />
            <Line
              dataKey="secondary"
              type="monotone"
              stroke={CHART_COLORS.mint}
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ChartContainer>
      </A2UICard>
    );
  },
  DonutChart: ({ props }) => {
    const data = withFallbackArray(props?.data, DEFAULT_POINTS);
    return (
      <A2UICard
        label="donut chart"
        title={props?.title ?? "Donut Chart"}
        description={props?.description ?? "Show a proportional breakdown."}
      >
        <div className="grid items-center gap-4 sm:grid-cols-[220px_1fr]">
          <ChartContainer config={chartConfig} className="min-h-[220px]">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
              >
                {data.map((point, index) => (
                  <Cell
                    key={point.label}
                    fill={
                      [
                        CHART_COLORS.blue,
                        CHART_COLORS.indigo,
                        CHART_COLORS.mint,
                      ][index % 3]
                    }
                  />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="space-y-2">
            {data.map((point, index) => (
              <div
                key={point.label}
                className="flex items-center justify-between rounded-xl border bg-muted/20 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor: [
                        CHART_COLORS.blue,
                        CHART_COLORS.indigo,
                        CHART_COLORS.mint,
                      ][index % 3],
                    }}
                  />
                  {point.label}
                </span>
                <span className="font-medium">{point.value}</span>
              </div>
            ))}
          </div>
        </div>
      </A2UICard>
    );
  },
  DataTable: ({ props }) => {
    const rows = withFallbackArray(props?.rows, DEFAULT_ROWS);
    return (
      <A2UICard
        label="table"
        title={props?.title ?? "Data Table"}
        description={
          props?.description ?? "Structured rows for the current run."
        }
      >
        <div className="overflow-hidden rounded-2xl border">
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid gap-2 border-b p-3 text-sm last:border-b-0 sm:grid-cols-[1fr_auto_auto]"
            >
              <div>
                <div className="font-medium">{row.label}</div>
                {row.detail ? (
                  <div className="text-muted-foreground">{row.detail}</div>
                ) : null}
              </div>
              {row.status ? (
                <Badge variant="secondary" className="w-fit">
                  {row.status}
                </Badge>
              ) : null}
              {row.value ? (
                <div className="font-semibold">{row.value}</div>
              ) : null}
            </div>
          ))}
        </div>
      </A2UICard>
    );
  },
  FileList: ({ props }) => {
    const files = withFallbackArray(props?.files, DEFAULT_FILES);
    return (
      <A2UICard
        label="files"
        title={props?.title ?? "Files"}
        description={props?.description ?? "Files inspected or changed."}
      >
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={file.path}
              className={cn(
                "rounded-2xl border bg-muted/20 p-3",
                file.status === "high" && "border-amber-200 bg-amber-50",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <code className="text-sm font-medium">{file.path}</code>
                {file.status ? (
                  <Badge variant="secondary" className="shrink-0">
                    {file.status}
                  </Badge>
                ) : null}
              </div>
              {file.detail ? (
                <div className="mt-1 text-sm text-muted-foreground">
                  {file.detail}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </A2UICard>
    );
  },
} satisfies CatalogRenderers<typeof controlRoomA2UIDefinitions>;

export const controlRoomA2UICatalog = createCatalog(
  controlRoomA2UIDefinitions,
  controlRoomA2UIRenderers,
  {
    catalogId: CONTROL_ROOM_A2UI_CATALOG_ID,
    includeBasicCatalog: false,
  },
);
