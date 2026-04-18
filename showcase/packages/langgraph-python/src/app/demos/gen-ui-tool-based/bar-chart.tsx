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
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "10px 14px",
    color: "#0f172a",
    fontSize: "13px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
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
      <div className="max-w-2xl mx-auto my-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="text-sm text-slate-500">{description}</div>
        <p className="text-slate-400 text-center py-8 text-sm">
          No data available
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto my-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <style>{`
        @keyframes barSlideIn {
          from { transform: translateY(40px); opacity: 0; }
          20% { opacity: 1; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
      <div className="p-4 pb-2">
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="text-sm text-slate-500">{description}</div>
      </div>
      <div className="px-4 pb-4">
        <ResponsiveContainer width="100%" height={280}>
          <RechartsBarChart
            data={data}
            margin={{ top: 12, right: 12, bottom: 4, left: -8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e2e8f0"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: "#64748b" }}
              stroke="#e2e8f0"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#64748b" }}
              stroke="#e2e8f0"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: "#f1f5f9", opacity: 0.5 }}
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
