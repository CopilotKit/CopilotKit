"use client";

// Chart card rendered by the gen-ui-tool-based frontend tool (OpenClaw).
//
// This component is the `render` target of the `render_chart` frontend tool.
// When the OpenClaw agent calls `render_chart`, CopilotChat drives THIS
// component through its inProgress -> executing -> complete lifecycle, passing
// the (possibly partial) tool arguments as props. The component draws either a
// bar chart or a pie/donut chart entirely with SVG so the demo stays
// self-contained (no charting library, no cross-cell imports).

import React from "react";
import { z } from "zod";

export const chartPropsSchema = z.object({
  chartType: z
    .enum(["bar", "pie"])
    .describe("Which chart to draw: 'bar' or 'pie'."),
  title: z.string().describe("Chart title"),
  description: z.string().describe("Brief description or subtitle"),
  data: z
    .array(
      z.object({
        label: z.string(),
        value: z.number(),
      }),
    )
    .describe("The labeled numeric data points to plot."),
});

export type ChartProps = z.infer<typeof chartPropsSchema>;

const CHART_COLORS = [
  "#BEC2FF",
  "#85ECCE",
  "#FFAC4D",
  "#FFF388",
  "#189370",
  "#EEE6FE",
  "#FA5F67",
];

type ChartStatus = "inProgress" | "executing" | "complete";

export function ChartCard({
  chartType,
  title,
  description,
  data,
  status,
}: Partial<ChartProps> & { status: ChartStatus }) {
  const points = Array.isArray(data)
    ? data.filter(
        (d): d is { label: string; value: number } =>
          !!d && typeof d.value === "number",
      )
    : [];
  const type = chartType === "pie" ? "pie" : "bar";

  return (
    <div
      data-testid="gen-ui-chart-card"
      data-chart-type={type}
      data-status={status}
      className="my-3 max-w-2xl overflow-hidden rounded-2xl border border-[#DBDBE5] bg-white shadow-sm"
    >
      <div className="border-b border-[#E9E9EF] bg-[#FAFAFC] px-4 py-3">
        <div
          data-testid="gen-ui-chart-title"
          className="font-semibold text-[#010507]"
        >
          {title ?? "Chart"}
        </div>
        {description ? (
          <div className="text-sm text-[#57575B]">{description}</div>
        ) : null}
      </div>

      <div className="p-4">
        {points.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#AFAFB7]">
            {status === "complete" ? "No data available" : "Preparing chart…"}
          </p>
        ) : type === "pie" ? (
          <PieChart data={points} />
        ) : (
          <BarChart data={points} />
        )}
      </div>
    </div>
  );
}

function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div data-testid="gen-ui-bar-chart" className="space-y-3">
      {data.map((d, i) => {
        const pct = Math.max(2, Math.round((d.value / max) * 100));
        return (
          <div key={i} className="flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 truncate text-[#57575B]">
              {d.label}
            </span>
            <div className="h-6 flex-1 overflow-hidden rounded-md bg-[#F0F0F4]">
              <div
                className="h-full rounded-md transition-all duration-500 ease-out"
                style={{
                  width: `${pct}%`,
                  backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                }}
              />
            </div>
            <span className="w-14 shrink-0 text-right tabular-nums text-[#010507]">
              {d.value.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PieChart({ data }: { data: { label: string; value: number }[] }) {
  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  const size = 200;
  const strokeWidth = 36;
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
    <div data-testid="gen-ui-pie-chart">
      <svg
        width="100%"
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto block"
        style={{ maxWidth: size }}
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#F0F0F4"
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
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{
                  backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                }}
              />
              <span className="flex-1 truncate text-[#010507]">
                {item.label}
              </span>
              <span className="tabular-nums text-[#57575B]">
                {val.toLocaleString()}
              </span>
              <span className="w-10 text-right text-sm tabular-nums text-[#57575B]">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
