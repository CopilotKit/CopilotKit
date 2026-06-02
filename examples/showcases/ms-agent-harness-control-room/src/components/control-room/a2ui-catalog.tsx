"use client";

import { createCatalog } from "@copilotkit/a2ui-renderer";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";
import {
  Area,
  AreaChart as RechartsAreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart as RechartsLineChart,
  Pie,
  PieChart as RechartsPieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart as RechartsRadarChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  CONTROL_ROOM_A2UI_CATALOG_ID,
  controlRoomA2UIDefinitions,
} from "@/lib/control-room-a2ui-definitions";
import { cn } from "@/lib/utils";

const CHART_COLORS = [
  "#2563EB",
  "#06B6D4",
  "#14B8A6",
  "#F59E0B",
  "#E11D48",
  "#7C3AED",
] as const;

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  color: "hsl(var(--foreground))",
  fontSize: 12,
  padding: "8px 10px",
  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.12)",
};

type RenderChild = (id: string) => ReactNode;

type ChartPoint = {
  label: string;
  value: number;
  secondary?: number;
};

type DonutPoint = {
  name: string;
  value: number;
};

function renderChildIds(
  ids: unknown,
  renderChild: RenderChild,
  wrapperClassName = "min-w-0",
) {
  if (!Array.isArray(ids)) return null;
  return ids.map((id) =>
    typeof id === "string" ? (
      <div key={id} className={wrapperClassName}>
        {renderChild(id)}
      </div>
    ) : null,
  );
}

function asChartPoints(value: unknown): ChartPoint[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [
      { label: "Plan", value: 34, secondary: 18 },
      { label: "Build", value: 56, secondary: 28 },
      { label: "Verify", value: 82, secondary: 42 },
    ];
  }

  return value.map((point, index) => {
    const record = point as Record<string, unknown>;
    return {
      label: String(
        record.label ??
          record.stage ??
          record.name ??
          record.capability ??
          `P${index + 1}`,
      ),
      value: Number(record.value ?? record.confidence ?? record.score ?? 0),
      secondary:
        record.secondary === undefined && record.failures === undefined
          ? undefined
          : Number(record.secondary ?? record.failures ?? 0),
    };
  });
}

function asDonutPoints(value: unknown): DonutPoint[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [
      { name: "Files", value: 42 },
      { name: "Tools", value: 28 },
      { name: "Approvals", value: 18 },
    ];
  }

  return value.map((point, index) => {
    const record = point as Record<string, unknown>;
    return {
      name: String(record.name ?? record.label ?? `Slice ${index + 1}`),
      value: Number(record.value ?? 0),
    };
  });
}

function chartHeading(title?: unknown, summary?: unknown) {
  if (!title && !summary) return null;
  return (
    <div className="mb-3 space-y-1">
      {title ? (
        <h4 className="text-sm font-semibold">{String(title)}</h4>
      ) : null}
      {summary ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {String(summary)}
        </p>
      ) : null}
    </div>
  );
}

function badgeVariantClass(variant?: unknown) {
  switch (variant) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "danger":
    case "error":
      return "border-red-200 bg-red-50 text-red-700";
    case "info":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "";
  }
}

function metricToneClass(tone?: unknown, trend?: unknown) {
  const signal = tone ?? trend;
  switch (signal) {
    case "success":
    case "up":
      return "border-emerald-200 bg-emerald-50/70 text-emerald-950";
    case "warning":
      return "border-amber-200 bg-amber-50/70 text-amber-950";
    case "danger":
    case "down":
      return "border-red-200 bg-red-50/70 text-red-950";
    default:
      return "border-border bg-muted/25 text-foreground";
  }
}

function riskClass(risk?: unknown) {
  switch (risk) {
    case "high":
      return "border-red-200 bg-red-50 text-red-700";
    case "medium":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
}

function statusClass(status?: unknown) {
  switch (status) {
    case "pass":
      return "text-emerald-700";
    case "running":
      return "text-blue-700";
    case "blocked":
      return "text-amber-700";
    case "fail":
      return "text-red-700";
    default:
      return "text-muted-foreground";
  }
}

export const controlRoomA2UIRenderers = {
  Surface: ({ props, children }) => (
    <section
      className="my-4 w-full max-w-5xl space-y-5 rounded-lg border bg-background p-5 shadow-sm"
      data-testid="control-room-a2ui-surface"
    >
      <div className="space-y-2">
        {props.eyebrow ? (
          <Badge variant="secondary" className="w-fit">
            {props.eyebrow}
          </Badge>
        ) : null}
        <h2 className="text-2xl font-semibold tracking-normal">
          {props.title}
        </h2>
        {props.subtitle ? (
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {props.subtitle}
          </p>
        ) : null}
      </div>
      <div className="space-y-4">
        {renderChildIds(props.children, children)}
      </div>
    </section>
  ),

  SectionHeader: ({ props }) => (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h3 className="text-base font-semibold">{props.title}</h3>
        {props.description ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {props.description}
          </p>
        ) : null}
      </div>
      {props.badge ? <Badge variant="secondary">{props.badge}</Badge> : null}
    </div>
  ),

  Row: ({ props, children }) => (
    <div
      className="grid w-full min-w-0 gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))]"
      data-testid="control-room-a2ui-row"
    >
      {renderChildIds(props.children, children)}
    </div>
  ),

  Column: ({ props, children }) => (
    <div
      className="flex w-full min-w-0 flex-col gap-4"
      data-testid="control-room-a2ui-column"
    >
      {renderChildIds(props.children, children)}
    </div>
  ),

  Card: ({ props, children }) => (
    <Card className="h-full min-w-0" data-testid="control-room-a2ui-card">
      {props.title || props.description || props.badge ? (
        <CardHeader className="space-y-2">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              {props.title ? <CardTitle>{props.title}</CardTitle> : null}
              {props.description ? (
                <CardDescription>{props.description}</CardDescription>
              ) : null}
            </div>
            {props.badge ? (
              <Badge variant="secondary" className="shrink-0">
                {props.badge}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
      ) : null}
      <CardContent className="space-y-4">
        {renderChildIds(props.children, children)}
      </CardContent>
    </Card>
  ),

  Metric: ({ props }) => {
    const trend = props.trend ?? "neutral";
    const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "";

    return (
      <div
        className={cn(
          "flex min-h-[96px] min-w-0 flex-1 flex-col justify-between rounded-lg border p-3",
          metricToneClass(props.tone, trend),
        )}
        data-testid="control-room-a2ui-metric"
      >
        <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
          {props.label}
        </div>
        <div className="mt-2 flex items-baseline gap-2 text-2xl font-semibold tabular-nums">
          <span>{props.value}</span>
          {arrow ? <span className="text-base">{arrow}</span> : null}
        </div>
        {props.detail ? (
          <div className="mt-1 text-xs text-muted-foreground">
            {props.detail}
          </div>
        ) : null}
      </div>
    );
  },

  Badge: ({ props }) => (
    <Badge
      variant={props.variant === "default" ? "default" : "outline"}
      className={cn("w-fit", badgeVariantClass(props.variant))}
      data-testid="control-room-a2ui-badge"
    >
      {props.text}
    </Badge>
  ),

  Button: ({ props, dispatch }) => (
    <Button
      type="button"
      variant={props.variant ?? "default"}
      onClick={() => {
        if (props.action && dispatch) dispatch(props.action);
      }}
      data-testid="control-room-a2ui-button"
    >
      {props.label}
    </Button>
  ),

  TextInput: ({ props }) => (
    <label className="block space-y-2" data-testid="control-room-a2ui-input">
      {props.label ? (
        <span className="text-sm font-medium">{props.label}</span>
      ) : null}
      <Input
        readOnly
        value={props.value ?? ""}
        placeholder={props.placeholder ?? ""}
      />
    </label>
  ),

  Textarea: ({ props }) => (
    <label className="block space-y-2" data-testid="control-room-a2ui-textarea">
      {props.label ? (
        <span className="text-sm font-medium">{props.label}</span>
      ) : null}
      <Textarea
        readOnly
        value={props.value ?? ""}
        placeholder={props.placeholder ?? ""}
      />
    </label>
  ),

  Select: ({ props }) => (
    <label className="block space-y-2" data-testid="control-room-a2ui-select">
      {props.label ? (
        <span className="text-sm font-medium">{props.label}</span>
      ) : null}
      <Select value={props.value ?? undefined}>
        <SelectTrigger>
          <SelectValue placeholder={props.placeholder ?? "Select"} />
        </SelectTrigger>
        <SelectContent>
          {(Array.isArray(props.options) ? props.options : []).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  ),

  Checkbox: ({ props }) => (
    <label
      className="flex items-center gap-3 rounded-lg border p-3 text-sm"
      data-testid="control-room-a2ui-checkbox"
    >
      <Checkbox checked={Boolean(props.checked)} />
      <span>{props.label}</span>
    </label>
  ),

  Switch: ({ props }) => (
    <label
      className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm"
      data-testid="control-room-a2ui-switch"
    >
      <span>{props.label}</span>
      <Switch checked={Boolean(props.checked)} />
    </label>
  ),

  Progress: ({ props }) => (
    <div className="space-y-2" data-testid="control-room-a2ui-progress">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{props.label}</span>
        <span className="tabular-nums text-muted-foreground">
          {Number(props.value ?? 0)}%
        </span>
      </div>
      <Progress value={Number(props.value ?? 0)} />
      {props.detail ? (
        <p className="text-xs text-muted-foreground">{props.detail}</p>
      ) : null}
    </div>
  ),

  BarChart: ({ props }) => {
    const data = asChartPoints(props.data);

    return (
      <div
        className="min-w-[16rem] w-full"
        data-testid="control-room-a2ui-bar-chart"
      >
        {chartHeading(props.title, props.summary)}
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsBarChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                {data.map((_, index) => (
                  <Cell
                    key={index}
                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                  />
                ))}
              </Bar>
            </RechartsBarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  },

  LineChart: ({ props }) => {
    const data = asChartPoints(props.data);

    return (
      <div
        className="min-w-[16rem] w-full"
        data-testid="control-room-a2ui-line-chart"
      >
        {chartHeading(props.title, props.summary)}
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsLineChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={CHART_COLORS[0]}
                strokeWidth={3}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </RechartsLineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  },

  AreaChart: ({ props }) => {
    const data = asChartPoints(props.data);
    const hasSecondary = data.some((point) => point.secondary !== undefined);

    return (
      <div
        className="min-w-[16rem] w-full"
        data-testid="control-room-a2ui-area-chart"
      >
        {chartHeading(props.title, props.summary)}
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsAreaChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
              {hasSecondary ? (
                <Area
                  type="monotone"
                  dataKey="secondary"
                  stroke={CHART_COLORS[2]}
                  fill={CHART_COLORS[2]}
                  fillOpacity={0.18}
                  strokeOpacity={1}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              ) : null}
              <Area
                type="monotone"
                dataKey="value"
                stroke={CHART_COLORS[0]}
                fill={CHART_COLORS[0]}
                fillOpacity={0.24}
                strokeOpacity={1}
                strokeWidth={3}
                isAnimationActive={false}
              />
            </RechartsAreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  },

  StackedAreaChart: ({ props }) => {
    const data = Array.isArray(props.data) ? props.data : [];

    return (
      <div
        className="min-w-[16rem] w-full"
        data-testid="control-room-a2ui-stacked-area-chart"
      >
        {chartHeading(props.title, props.summary)}
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsAreaChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
              <Area
                type="monotone"
                dataKey="toolCalls"
                stackId="1"
                stroke={CHART_COLORS[0]}
                fill={CHART_COLORS[0]}
                fillOpacity={0.35}
                strokeOpacity={1}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="evidence"
                stackId="1"
                stroke={CHART_COLORS[2]}
                fill={CHART_COLORS[2]}
                fillOpacity={0.35}
                strokeOpacity={1}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="approvals"
                stackId="1"
                stroke={CHART_COLORS[3]}
                fill={CHART_COLORS[3]}
                fillOpacity={0.35}
                strokeOpacity={1}
                isAnimationActive={false}
              />
            </RechartsAreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  },

  DonutChart: ({ props }) => {
    const data = asDonutPoints(props.data);
    const total = data.reduce((sum, point) => sum + point.value, 0);

    return (
      <div
        className="min-w-[16rem] w-full"
        data-testid="control-room-a2ui-donut-chart"
      >
        {chartHeading(props.title, props.summary)}
        <div className="grid items-center gap-4 sm:grid-cols-[220px_1fr]">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsPieChart>
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {data.map((_, index) => (
                    <Cell
                      key={index}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
              </RechartsPieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {data.map((point, index) => (
              <div
                key={point.name}
                className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-sm"
                    style={{
                      backgroundColor:
                        CHART_COLORS[index % CHART_COLORS.length],
                    }}
                  />
                  <span className="truncate">{point.name}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {total > 0 ? Math.round((point.value / total) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  },

  RadarChart: ({ props }) => {
    const data = Array.isArray(props.data) ? props.data : [];

    return (
      <div
        className="min-w-[16rem] w-full"
        data-testid="control-room-a2ui-radar-chart"
      >
        {chartHeading(props.title, props.summary)}
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RechartsRadarChart data={data}>
              <PolarGrid />
              <PolarAngleAxis dataKey="capability" />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
              <Radar
                dataKey="score"
                stroke={CHART_COLORS[0]}
                fill={CHART_COLORS[0]}
                fillOpacity={0.28}
              />
            </RechartsRadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  },

  RadialChart: ({ props }) => {
    const metrics = Array.isArray(props.metrics) ? props.metrics : [];
    const data = metrics.map((metric, index) => ({
      ...metric,
      fill: CHART_COLORS[index % CHART_COLORS.length],
    }));

    return (
      <div
        className="min-w-[16rem] w-full"
        data-testid="control-room-a2ui-radial-chart"
      >
        {chartHeading(props.title, props.summary)}
        <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart innerRadius={36} outerRadius={96} data={data}>
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <RadialBar dataKey="value" background />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span>{metric.label}</span>
                  <span className="font-semibold tabular-nums">
                    {metric.value}%
                  </span>
                </div>
                <Progress value={metric.value} className="mt-2" />
                {metric.detail ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {metric.detail}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  },

  Calendar: ({ props }) => {
    const events = Array.isArray(props.events) ? props.events : [];
    const selectedDates = events
      .map((event) => new Date(`${event.date}T12:00:00`))
      .filter((date) => !Number.isNaN(date.getTime()));

    return (
      <div
        className="grid min-w-0 gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]"
        data-testid="control-room-a2ui-calendar"
      >
        <Calendar
          mode="multiple"
          selected={selectedDates}
          className="max-w-full rounded-lg border"
        />
        <div className="min-w-0 space-y-3">
          <div>
            <h4 className="text-sm font-semibold">{props.title}</h4>
            {props.summary ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {props.summary}
              </p>
            ) : null}
          </div>
          {events.map((event) => (
            <div
              key={`${event.date}-${event.label}`}
              className="min-w-0 rounded-lg border p-3 text-sm"
            >
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words font-medium">
                  {event.label}
                </span>
                <Badge
                  variant="outline"
                  className={badgeVariantClass(event.tone)}
                >
                  {event.date}
                </Badge>
              </div>
              {event.detail ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {event.detail}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  },

  RunHealthTable: ({ props }) => {
    const rows = Array.isArray(props.rows) ? props.rows : [];

    return (
      <div data-testid="control-room-a2ui-run-health-table">
        {chartHeading(props.title, props.summary)}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Check</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.check}>
                <TableCell className="font-medium">{row.check}</TableCell>
                <TableCell
                  className={cn("capitalize", statusClass(row.status))}
                >
                  {row.status}
                </TableCell>
                <TableCell className="min-w-[120px]">
                  <Progress value={Number(row.progress ?? 0)} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.detail}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  },

  FileImpactMap: ({ props }) => {
    const files = Array.isArray(props.files) ? props.files : [];

    return (
      <div
        className="space-y-3"
        data-testid="control-room-a2ui-file-impact-map"
      >
        {chartHeading(props.title, props.summary)}
        {files.map((file) => (
          <div key={file.path} className="rounded-lg border p-3 text-sm">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <code className="truncate text-xs font-medium">{file.path}</code>
              <Badge variant="outline" className={riskClass(file.risk)}>
                {file.risk}
              </Badge>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {file.change}
            </p>
          </div>
        ))}
      </div>
    );
  },

  ApprovalForm: ({ props }) => (
    <div className="space-y-4" data-testid="control-room-a2ui-approval-form">
      <div>
        <h4 className="text-sm font-semibold">{props.title}</h4>
        {props.summary ? (
          <p className="mt-1 text-xs text-muted-foreground">{props.summary}</p>
        ) : null}
      </div>
      <div className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
            Command
          </span>
          <Badge variant="outline" className={riskClass(props.risk)}>
            {props.risk} risk
          </Badge>
        </div>
        <code className="block whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-xs">
          {props.command}
        </code>
      </div>
      <div className="space-y-2">
        {(Array.isArray(props.checks) ? props.checks : []).map((check) => (
          <label
            key={check.label}
            className="flex items-center gap-3 rounded-lg border p-3 text-sm"
          >
            <Checkbox checked={Boolean(check.complete)} />
            <span>{check.label}</span>
          </label>
        ))}
      </div>
      <Button type="button">Request approval</Button>
    </div>
  ),

  HandoffForm: ({ props }) => (
    <div className="space-y-4" data-testid="control-room-a2ui-handoff-form">
      <div>
        <h4 className="text-sm font-semibold">{props.title}</h4>
        {props.summary ? (
          <p className="mt-1 text-xs text-muted-foreground">{props.summary}</p>
        ) : null}
      </div>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Owner</span>
        <Input readOnly value={props.owner ?? ""} />
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Notes</span>
        <Textarea readOnly value={props.notes ?? ""} />
      </label>
      <div className="space-y-2">
        {(Array.isArray(props.followups) ? props.followups : []).map((item) => (
          <label
            key={item}
            className="flex items-center gap-3 rounded-lg border p-3 text-sm"
          >
            <Checkbox checked={false} />
            <span>{item}</span>
          </label>
        ))}
      </div>
      <Button type="button" variant="outline">
        Save handoff
      </Button>
    </div>
  ),
} satisfies CatalogRenderers<typeof controlRoomA2UIDefinitions>;

export const controlRoomA2UICatalog = createCatalog(
  controlRoomA2UIDefinitions,
  controlRoomA2UIRenderers,
  {
    catalogId: CONTROL_ROOM_A2UI_CATALOG_ID,
    includeBasicCatalog: true,
  },
);
