"use client";

/**
 * BarChart for the byoc-hashbrown demo.
 */
import { useRef } from "react";
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
import { z } from "zod";
import { CHART_COLORS, CHART_CONFIG } from "./chart-config";

export const BarChartProps = z.object({
  title: z.string().describe("Chart title"),
  description: z.string().describe("Brief description or subtitle"),
  data: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
    }),
  ),
});

type BarChartPropsType = z.infer<typeof BarChartProps>;

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

export function BarChart({ title, description, data }: BarChartPropsType) {
  const { isNew } = useSeenIndices();

  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div
        data-testid="bar-chart"
        className="max-w-2xl mx-auto my-4 rounded-lg border border-[var(--border)] bg-[var(--card)]"
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold leading-none tracking-tight text-[var(--foreground)]">
            {title}
          </h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            {description}
          </p>
        </div>
        <div className="p-6 pt-0">
          <p className="text-[var(--muted-foreground)] text-center py-8 text-sm">
            No data available
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="bar-chart"
      className="max-w-2xl mx-auto my-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]"
    >
      <style>{`
        @keyframes barSlideIn {
          from { transform: translateY(40px); opacity: 0; }
          20% { opacity: 1; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
      <div className="p-6 pb-2">
        <h3 className="text-lg font-semibold leading-none tracking-tight text-[var(--foreground)]">
          {title}
        </h3>
        <p className="text-sm text-[var(--muted-foreground)]">{description}</p>
      </div>
      <div className="p-6 pt-2">
        <ResponsiveContainer width="100%" height={280}>
          <RechartsBarChart
            data={data}
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
              contentStyle={CHART_CONFIG.tooltipStyle}
              cursor={{ fill: "var(--secondary)", opacity: 0.5 }}
            />
            <Bar
              isAnimationActive={false}
              dataKey="value"
              radius={[6, 6, 0, 0]}
              maxBarSize={48}
              shape={(props: unknown) => {
                const p = props as Record<string, unknown>;
                return <AnimatedBar {...p} isNew={isNew(p.index as number)} />;
              }}
            >
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
}
