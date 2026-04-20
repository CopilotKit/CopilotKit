import React from "react";
import { z } from "zod";

export const pieChartPropsSchema = z.object({
  title: z.string().describe("Chart title"),
  description: z.string().describe("Brief description or subtitle"),
  data: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
    }),
  ),
});

export type PieChartProps = z.infer<typeof pieChartPropsSchema>;

export function PieChart({ title, description, data }: PieChartProps) {
  const CHART_COLORS = [
    "#BEC2FF",
    "#85ECCE",
    "#FFAC4D",
    "#FFF388",
    "#189370",
    "#EEE6FE",
    "#FA5F67",
  ];

  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="max-w-lg mx-auto my-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="text-sm text-slate-500">{description}</div>
        <p className="text-slate-400 text-center py-8 text-sm">
          No data available
        </p>
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  // Donut slice geometry
  const size = 240;
  const strokeWidth = 40;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let accumulated = 0;
  const slices = data.map((item, index) => {
    const val = Number(item.value) || 0;
    const ratio = total > 0 ? val / total : 0;
    const arc = ratio * circumference;
    const startAt = accumulated;
    accumulated += arc;
    return {
      arc,
      gap: circumference - arc,
      dashoffset: -startAt,
      color: CHART_COLORS[index % CHART_COLORS.length],
    };
  });

  return (
    <div className="max-w-lg mx-auto my-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="p-4 pb-0">
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="text-sm text-slate-500">{description}</div>
      </div>
      <div className="px-4 pb-4 pt-4">
        <svg
          width="100%"
          viewBox={`0 0 ${size} ${size}`}
          className="block mx-auto"
          style={{ maxWidth: size, transform: "scaleX(-1)" }}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#f1f5f9"
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

        <div className="space-y-2 pt-4">
          {data.map((item, index) => {
            const val = Number(item.value) || 0;
            const pct = total > 0 ? ((val / total) * 100).toFixed(0) : 0;
            return (
              <div key={index} className="flex items-center gap-3 text-sm">
                <span
                  className="inline-block h-3 w-3 rounded-full shrink-0"
                  style={{
                    backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                  }}
                />
                <span className="flex-1 text-slate-900 truncate">
                  {item.label}
                </span>
                <span className="text-slate-500 tabular-nums">
                  {val.toLocaleString()}
                </span>
                <span className="text-slate-500 text-sm w-10 text-right tabular-nums">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
