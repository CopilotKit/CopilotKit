"use client";

/**
 * A2UI catalog RENDERERS.
 *
 * React implementations for each definition in `./definitions.ts`,
 * styled with the demo's local ShadCN-flavoured primitives in
 * `../_components/`. The assembled catalog (definitions × renderers via
 * `createCatalog`) lives in `./catalog.ts`.
 *
 * Reference:
 *   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui
 */
import React, { useRef } from "react";
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Rectangle,
} from "recharts";
import type { CatalogRenderers } from "@copilotkit/a2ui-renderer";

import type { MyDefinitions } from "./definitions";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "../_components/card";
import { Badge } from "../_components/badge";
import { Button } from "../_components/button";
import { Separator } from "../_components/separator";

// ─── ShadCN-friendly chart palette ─────────────────────────────────────────
// Neutral, slightly muted hues that pair with `bg-card` / `--border`
// (zinc/slate-leaning, akin to ShadCN's chart-{1..5} palette).
const CHART_COLORS = [
  "#3F3F46", // zinc-700
  "#71717A", // zinc-500
  "#A1A1AA", // zinc-400
  "#18181B", // zinc-900
  "#52525B", // zinc-600
  "#D4D4D8", // zinc-300
  "#27272A", // zinc-800
] as const;

const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "var(--foreground)",
  fontSize: 12,
  boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
};

/** Custom SVG donut chart built with <circle> + stroke-dasharray. */
function DonutChart({
  data,
  size = 220,
  strokeWidth = 36,
}: {
  data: { label: string; value: number }[];
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  let accumulated = 0;
  const slices = data.map((item, index) => {
    const val = Number(item.value) || 0;
    const ratio = total > 0 ? val / total : 0;
    const arc = ratio * circumference;
    const startAt = accumulated;
    accumulated += arc;
    return {
      ...item,
      arc,
      gap: circumference - arc,
      dashoffset: -startAt,
      color: CHART_COLORS[index % CHART_COLORS.length],
    };
  });

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${size} ${size}`}
      style={{
        display: "block",
        margin: "0 auto",
        maxWidth: size,
        transform: "scaleX(-1)",
      }}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={strokeWidth}
      />
      {slices.map((slice, i) => (
        <circle
          key={i}
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={slice.color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${slice.arc} ${slice.gap}`}
          strokeDashoffset={slice.dashoffset}
          strokeLinecap="butt"
          transform={`rotate(-90 ${center} ${center})`}
        />
      ))}
    </svg>
  );
}

/** Tracks seen indices so only NEW bars get the fade-in animation. */
function useSeenIndices() {
  const seen = useRef(new Set<number>());
  return {
    isNew(index: number) {
      if (seen.current.has(index)) return false;
      seen.current.add(index);
      return true;
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AnimatedBar(props: any) {
  const { isNew, ...rest } = props;
  return (
    <g
      style={
        isNew
          ? {
              animation: "barSlideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
            }
          : undefined
      }
    >
      <Rectangle {...rest} />
    </g>
  );
}

// @region[renderers-react]
export const myRenderers: CatalogRenderers<MyDefinitions> = {
  Card: ({ props, children }) => (
    <Card className="min-w-[260px]" data-testid="declarative-card">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        {props.subtitle && <CardDescription>{props.subtitle}</CardDescription>}
      </CardHeader>
      {props.child && (
        <CardContent className="flex flex-col gap-3">
          {children(props.child)}
        </CardContent>
      )}
    </Card>
  ),

  StatusBadge: ({ props }) => (
    <Badge
      variant={props.variant ?? "info"}
      data-testid="declarative-status-badge"
    >
      {props.text}
    </Badge>
  ),

  Metric: ({ props }) => {
    const trend = props.trend ?? "neutral";
    const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "";
    const trendClass =
      trend === "up"
        ? "text-emerald-600"
        : trend === "down"
          ? "text-rose-600"
          : "text-[var(--foreground)]";
    return (
      <div data-testid="declarative-metric" className="flex flex-col gap-1">
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
          {props.label}
        </div>
        <div
          className={`flex items-baseline gap-1.5 text-2xl font-semibold tabular-nums ${trendClass}`}
        >
          <span>{props.value}</span>
          {arrow && <span className="text-base">{arrow}</span>}
        </div>
      </div>
    );
  },

  InfoRow: ({ props }) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4 py-1">
        <span className="text-sm text-[var(--muted-foreground)]">
          {props.label}
        </span>
        <span className="text-sm font-medium text-[var(--foreground)]">
          {props.value}
        </span>
      </div>
      <Separator />
    </div>
  ),

  PrimaryButton: ({ props, dispatch }) => (
    <Button
      onClick={() => {
        if (props.action && dispatch) dispatch(props.action);
      }}
    >
      {props.label}
    </Button>
  ),

  PieChart: ({ props }) => {
    const data = props.data ?? [];
    const safeData = Array.isArray(data) ? data : [];
    const total = safeData.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    return (
      <Card
        className="mx-auto max-w-[520px] overflow-hidden"
        data-testid="declarative-pie-chart"
      >
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
          <CardDescription>{props.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {safeData.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              No data available
            </div>
          ) : (
            <>
              <DonutChart data={safeData} />
              <div className="flex flex-col gap-2 pt-2">
                {safeData.map((item, index) => {
                  const val = Number(item.value) || 0;
                  const pct =
                    total > 0 ? ((val / total) * 100).toFixed(0) : "0";
                  return (
                    <div
                      key={index}
                      className="flex items-center gap-3 text-sm"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{
                          backgroundColor:
                            CHART_COLORS[index % CHART_COLORS.length],
                        }}
                      />
                      <span className="flex-1 truncate text-[var(--foreground)]">
                        {item.label}
                      </span>
                      <span className="tabular-nums text-[var(--muted-foreground)]">
                        {val.toLocaleString()}
                      </span>
                      <span className="w-10 text-right tabular-nums text-[var(--muted-foreground)]">
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  },

  BarChart: ({ props }) => {
    const { isNew } = useSeenIndices();
    const data = props.data ?? [];
    const safeData = Array.isArray(data) ? data : [];

    return (
      <Card
        className="mx-auto max-w-[640px] overflow-hidden"
        data-testid="declarative-bar-chart"
      >
        {/* Scoped keyframe — no globals.css needed */}
        <style>{`
          @keyframes barSlideIn {
            from { transform: translateY(40px); opacity: 0; }
            20% { opacity: 1; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}</style>
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
          <CardDescription>{props.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {safeData.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">
              No data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <RechartsBarChart
                data={safeData}
                margin={{ top: 12, right: 12, bottom: 4, left: -8 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  stroke="var(--border)"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  stroke="var(--border)"
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="value"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={48}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  shape={
                    ((barProps: any) => (
                      <AnimatedBar
                        {...barProps}
                        isNew={isNew(barProps.index as number)}
                      />
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    )) as any
                  }
                >
                  {safeData.map((_, index) => (
                    <Cell
                      key={index}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                    />
                  ))}
                </Bar>
              </RechartsBarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    );
  },
};
// @endregion[renderers-react]
