import { z } from "zod";
import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { crm } from "../crm/store.js";
import { weeklyReportMetrics } from "../crm/analytics.js";
import type { Report, ReportMetrics } from "../crm/types.js";

/**
 * generate_weekly_report — compute period metrics, PERSIST a Report, return it.
 *
 * This MUTATES state: it appends a new `Report` to the store (`crm.addReport`),
 * which the orchestrator registers with `pushState` so a STATE_SNAPSHOT carrying
 * the new `reports[]` flows to the Reports page. The full `Report` is returned so
 * the WeeklyReportCard can render the summary + headline metrics inline.
 */

/** Format a Date as an ISO yyyy-mm-dd date (UTC) for period bounds. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Short human range like "May 28 – Jun 4, 2026" from two ISO dates. */
function humanRange(startIso: string, endIso: string): string {
  const fmt = (iso: string): string =>
    new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const year = endIso.slice(0, 4);
  return `${fmt(startIso)} – ${fmt(endIso)}, ${year}`;
}

/** Mint a restart-safe unique report id from the max numeric suffix of existing rN ids. */
function nextReportId(): string {
  let max = 0;
  for (const r of crm.listReports()) {
    const m = r.id.match(/^r(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `r${max + 1}`;
}

const money = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/** Three highlights derived from the period metrics. */
function buildHighlights(metrics: ReportMetrics): string[] {
  const top = metrics.leaderboard[0];
  const highlights: string[] = [
    `Bookings of ${money(metrics.bookings)} on ${metrics.dealsWon} won deal${metrics.dealsWon === 1 ? "" : "s"} this period.`,
    `${metrics.dealsOpen} open deal${metrics.dealsOpen === 1 ? "" : "s"} with a weighted forecast of ${money(metrics.weightedForecast)}.`,
  ];
  if (top && top.bookings > 0) {
    highlights.push(
      `${top.name} led the team with ${money(top.bookings)} in bookings.`,
    );
  } else {
    const winRatePct =
      metrics.winRate == null ? "n/a" : `${Math.round(metrics.winRate * 100)}%`;
    highlights.push(`Overall win rate stands at ${winRatePct}.`);
  }
  return highlights;
}

export const generateWeeklyReportTool = tool({
  name: "generate_weekly_report",
  description:
    'Generate this week\'s sales report: compute period metrics (bookings, forecast, win rate, by-stage, by-category, per-rep leaderboard), persist it as a new Report on the workspace, and return the full report (summary + 3 highlights + metrics). Defaults to the trailing 7 days. The new report appears at the top of the Reports page; renders inline as a WeeklyReportCard with a "View in Reports" CTA.',
  inputSchema: z.object({
    periodStart: z
      .string()
      .optional()
      .describe(
        "ISO yyyy-mm-dd start of the report window. Defaults to 7 days before periodEnd.",
      ),
    periodEnd: z
      .string()
      .optional()
      .describe("ISO yyyy-mm-dd end of the report window. Defaults to today."),
  }),
  callback: ({ periodStart, periodEnd }) => {
    // Default period = trailing 7 days ending today (runtime now is acceptable).
    const end = periodEnd ?? isoDate(new Date());
    const start =
      periodStart ??
      isoDate(
        new Date(
          new Date(`${end}T00:00:00.000Z`).getTime() - 7 * 24 * 60 * 60 * 1000,
        ),
      );

    const state = crm.getStateSnapshot();
    const metrics = weeklyReportMetrics(state, start, end);
    const range = humanRange(start, end);

    const summary =
      `Bookings landed at ${money(metrics.bookings)} for the week on ${metrics.dealsWon} closed deal${metrics.dealsWon === 1 ? "" : "s"}, ` +
      `with ${metrics.dealsOpen} open deal${metrics.dealsOpen === 1 ? "" : "s"} carrying a ${money(metrics.weightedForecast)} weighted forecast.`;

    const report: Report = {
      id: nextReportId(),
      title: `Weekly Sales Report — ${range}`,
      periodStart: start,
      periodEnd: end,
      generatedAt: new Date().toISOString(),
      summary,
      metrics,
      highlights: buildHighlights(metrics),
    };

    crm.addReport(report);
    return report as unknown as JSONValue;
  },
});
