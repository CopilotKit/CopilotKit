"use client";

// Insight card rendered by the open-gen-ui frontend tool (OpenClaw).
//
// This component is the `render` target of the `render_insight` frontend tool.
// When the OpenClaw agent calls `render_insight`, CopilotChat drives THIS
// component through its inProgress -> executing -> complete lifecycle, passing
// the (possibly partial) tool arguments as props. It paints an open-ended,
// self-contained "insight" visualisation entirely with SVG + Tailwind (no
// charting library, no cross-cell imports): an accent-tinted header, a grid of
// labelled metric stats, and a horizontal comparison bar for each metric so the
// values read at a glance. The generative UI is the tool's render output — the
// agent never needs to reply with plain text.

import React from "react";
import { z } from "zod";
import { Activity, TrendingUp, Sparkles } from "lucide-react";

export const insightPropsSchema = z.object({
  title: z.string().describe("Short headline for the insight (e.g. a topic)."),
  summary: z
    .string()
    .describe("One-sentence explanation of what the metrics show."),
  accent: z
    .enum(["indigo", "emerald", "amber", "rose"])
    .describe("Semantic accent colour for the visualisation."),
  metrics: z
    .array(
      z.object({
        label: z.string().describe("Metric name."),
        value: z.number().describe("Numeric metric value."),
        unit: z.string().optional().describe("Optional unit suffix, e.g. '%'."),
      }),
    )
    .describe("The labelled numeric metrics to visualise."),
});

export type InsightProps = z.infer<typeof insightPropsSchema>;

type InsightStatus = "inProgress" | "executing" | "complete";

const ACCENTS = {
  indigo: { bar: "#6366f1", tint: "#EEF0FF", text: "#4338ca" },
  emerald: { bar: "#10b981", tint: "#E7F8F1", text: "#047857" },
  amber: { bar: "#f59e0b", tint: "#FEF3E2", text: "#b45309" },
  rose: { bar: "#ef4444", tint: "#FDECEC", text: "#b91c1c" },
} as const;

export function InsightCard({
  title,
  summary,
  accent,
  metrics,
  status,
}: Partial<InsightProps> & { status: InsightStatus }) {
  const points = Array.isArray(metrics)
    ? metrics.filter(
        (m): m is { label: string; value: number; unit?: string } =>
          !!m && typeof m.value === "number",
      )
    : [];
  const palette = ACCENTS[accent ?? "indigo"] ?? ACCENTS.indigo;
  const max = Math.max(...points.map((m) => m.value), 1);

  return (
    <div
      data-testid="open-gen-ui-insight-card"
      data-accent={accent ?? "indigo"}
      data-status={status}
      className="my-3 max-w-2xl overflow-hidden rounded-2xl border border-[#DBDBE5] bg-white shadow-sm"
    >
      <div
        className="flex items-start gap-3 border-b border-[#E9E9EF] px-4 py-3"
        style={{ backgroundColor: palette.tint }}
      >
        <Sparkles
          className="mt-0.5 h-5 w-5 shrink-0"
          style={{ color: palette.bar }}
          aria-hidden
        />
        <div>
          <div
            data-testid="open-gen-ui-insight-title"
            className="font-semibold text-[#010507]"
          >
            {title ?? "Insight"}
          </div>
          {summary ? (
            <div className="text-sm text-[#57575B]">{summary}</div>
          ) : null}
        </div>
      </div>

      <div className="p-4">
        {points.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-8 text-center text-sm text-[#AFAFB7]">
            <Activity className="h-4 w-4 animate-pulse" aria-hidden />
            {status === "complete"
              ? "No metrics available"
              : "Composing insight…"}
          </p>
        ) : (
          <div data-testid="open-gen-ui-metric-grid" className="space-y-4">
            {points.map((m, i) => {
              const pct = Math.max(2, Math.round((m.value / max) * 100));
              return (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-[#57575B]">{m.label}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-[#010507]">
                      {m.value.toLocaleString()}
                      {m.unit ? (
                        <span className="ml-0.5 text-xs text-[#57575B]">
                          {m.unit}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#F0F0F4]">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${pct}%`, backgroundColor: palette.bar }}
                    />
                  </div>
                </div>
              );
            })}
            <div
              className="flex items-center gap-1.5 pt-1 text-xs font-medium"
              style={{ color: palette.text }}
            >
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              {points.length} metric{points.length === 1 ? "" : "s"} visualised
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
