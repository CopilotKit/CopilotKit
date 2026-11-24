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
import { z } from "zod";

export const barChartPropsSchema = z.object({
  title: z.string().describe("Chart title"),
  description: z.string().describe("Brief description or subtitle"),
  data: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
    }),
  ),
});

export type BarChartProps = z.infer<typeof barChartPropsSchema>;

export function BarChart({ title, description, data }: BarChartProps) {
  const CHART_COLORS = [
    "#BEC2FF",
    "#85ECCE",
    "#FFAC4D",
    "#FFF388",
    "#189370",
    "#EEE6FE",
    "#FA5F67",
  ];

  const TOOLTIP_STYLE = {
    backgroundColor: "light-dark(#ffffff, var(--card))",
    border: "1px solid light-dark(#DBDBE5, var(--border))",
    borderRadius: "12px",
    padding: "10px 14px",
    color: "light-dark(#010507, var(--foreground))",
    fontSize: "13px",
    boxShadow: "0 4px 12px rgba(1,5,7,0.06)",
  };

  // Track which bars have already been rendered so only newly-arriving ones animate.
  const seen = useRef(new Set<number>());
  const isNew = (i: number) => {
    if (seen.current.has(i)) return false;
    seen.current.add(i);
    return true;
  };

  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="max-w-2xl mx-auto my-4 rounded-2xl border border-[#DBDBE5] bg-white dark:border-border dark:bg-card p-6 shadow-sm">
        <div className="font-semibold text-[#010507] dark:text-foreground">
          {title}
        </div>
        <div className="text-sm text-[#57575B] dark:text-muted-foreground">
          {description}
        </div>
        <p className="text-[#AFAFB7] text-center py-8 text-sm dark:text-muted-foreground">
          No data available
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto my-4 overflow-hidden rounded-2xl border border-[#DBDBE5] bg-white dark:border-border dark:bg-card shadow-sm">
      <style>{`
        @keyframes barSlideIn {
          from { transform: translateY(40px); opacity: 0; }
          20% { opacity: 1; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
      <div className="p-4 pb-2">
        <div className="font-semibold text-[#010507] dark:text-foreground">
          {title}
        </div>
        <div className="text-sm text-[#57575B] dark:text-muted-foreground">
          {description}
        </div>
      </div>
      <div className="px-4 pb-4">
        <ResponsiveContainer width="100%" height={280}>
          <RechartsBarChart
            data={data}
            margin={{ top: 12, right: 12, bottom: 4, left: -8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="light-dark(#E9E9EF, var(--border))"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{
                fontSize: 12,
                fill: "light-dark(#838389, var(--muted-foreground))",
              }}
              stroke="light-dark(#E9E9EF, var(--border))"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{
                fontSize: 12,
                fill: "light-dark(#838389, var(--muted-foreground))",
              }}
              stroke="light-dark(#E9E9EF, var(--border))"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              itemStyle={{ color: "light-dark(#000, var(--foreground))" }}
              cursor={{
                fill: "light-dark(#F0F0F4, var(--accent))",
                opacity: 0.5,
              }}
            />
            <Bar
              isAnimationActive={false}
              dataKey="value"
              radius={[6, 6, 0, 0]}
              maxBarSize={48}
              shape={(props: any) => (
                <g
                  style={
                    isNew(props.index as number)
                      ? {
                          animation:
                            "barSlideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
                        }
                      : undefined
                  }
                >
                  <Rectangle {...props} />
                </g>
              )}
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
