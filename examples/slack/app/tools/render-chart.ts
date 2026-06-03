/**
 * `render_chart` — the agent emits a Chart.js config; we render it to a PNG
 * locally (headless Chromium) and deliver it to the thread via the SDK's
 * `ctx.postFile`. Slack shows the image inline. This is the "upload a CSV →
 * get a chart" payoff: the agent parses the data, then calls this.
 */
import { z } from "zod";
import type { FrontendTool } from "@copilotkit/slack";
import { renderChart } from "../render/chart.js";

const schema = z.object({
  title: z
    .string()
    .optional()
    .describe("Short title shown as the image's filename/caption."),
  chartSpec: z
    .union([
      z.object({
        type: z
          .string()
          .describe(
            "'bar' | 'line' | 'pie' | 'doughnut' | 'scatter' | 'radar' etc.",
          ),
        data: z
          .any()
          .describe("Chart.js data: { labels: [...], datasets: [...] }."),
        options: z.any().optional().describe("Optional Chart.js options."),
      }),
      z.string(),
    ])
    .describe(
      "A Chart.js config OBJECT — { type, data, options? } — with all data " +
        "inlined (a JSON string of the same is also accepted). For a stacked " +
        "bar set options.scales.x.stacked and options.scales.y.stacked to true.",
    ),
});

function slug(s: string): string {
  return (
    (s || "chart")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "chart"
  );
}

export const renderChartTool: FrontendTool<typeof schema> = {
  name: "render_chart",
  description:
    "Render a chart as an image and post it to the Slack thread. Pass a " +
    "Chart.js config OBJECT (type + data, optionally options). Use this to " +
    "visualize data — e.g. after analyzing an uploaded CSV. The image renders " +
    "inline in Slack.",
  parameters: schema,
  async handler({ title, chartSpec }, ctx) {
    // chartSpec is an object; tolerate a stringified one too (some models
    // still hand back a JSON string).
    let spec: Record<string, unknown>;
    if (typeof chartSpec === "string") {
      try {
        spec = JSON.parse(chartSpec) as Record<string, unknown>;
      } catch (e) {
        return JSON.stringify({
          ok: false,
          error: `chartSpec must be a Chart.js config object; got an unparseable string: ${(e as Error).message}`,
        });
      }
    } else {
      spec = chartSpec as Record<string, unknown>;
    }
    if (!ctx.postFile) {
      return JSON.stringify({ ok: false, error: "file delivery unavailable" });
    }
    try {
      const png = await renderChart(spec);
      const res = await ctx.postFile({
        bytes: png,
        filename: `${slug(title ?? "chart")}.png`,
        title: title ?? "Chart",
        altText: title ?? "Generated chart",
      });
      return JSON.stringify({
        ok: res.ok,
        posted: res.ok,
        ...(res.error ? { error: res.error } : {}),
      });
    } catch (e) {
      return JSON.stringify({ ok: false, error: (e as Error).message });
    }
  },
};
