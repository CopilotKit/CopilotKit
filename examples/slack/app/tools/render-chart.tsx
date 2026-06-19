/**
 * `render_chart` — the agent emits a Chart.js config; we render it to a PNG
 * locally (headless Chromium) and deliver it to the thread via the SDK's
 * `ctx.thread.postFile`. The image renders inline in the conversation. This
 * is the "upload a CSV → get a chart" payoff: the agent parses the data, then
 * calls this. After the upload we also post a small JSX caption card
 * (`<Context>`) so the tool doubles as a render-tool demo.
 */
import { z } from "zod";
import { Context } from "@copilotkit/bot-ui";
import { defineBotTool } from "@copilotkit/bot";
import { renderChart } from "../render/chart.js";

const schema = z.object({
  title: z
    .string()
    .optional()
    .describe("Short title shown as the image's filename/caption."),
  chartSpec: z
    .object({
      type: z
        .string()
        .describe("'bar' | 'line' | 'pie' | 'doughnut' | 'scatter' | 'radar'."),
      data: z
        .object({
          labels: z
            .array(z.string())
            .describe("X-axis / category labels, e.g. ['2026-01','2026-02']."),
          datasets: z
            .array(
              z
                .object({
                  label: z
                    .string()
                    .optional()
                    .describe("Series name in the legend, e.g. 'Sev1'."),
                  data: z
                    .array(z.number())
                    .describe("One numeric value per label."),
                })
                // Allow Chart.js dataset extras: stack, backgroundColor, fill…
                .passthrough(),
            )
            .min(1)
            .describe("One entry per data series."),
        })
        .describe("Chart.js data — inline the actual numbers."),
      options: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          "Optional Chart.js options. Stacked bar: " +
            "{ scales: { x: { stacked: true }, y: { stacked: true } } }.",
        ),
    })
    .describe("A Chart.js config with all values inlined."),
});

function slug(s: string): string {
  return (
    (s || "chart")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "chart"
  );
}

export const renderChartTool = defineBotTool({
  name: "render_chart",
  description:
    "Render a chart as an image and post it to the conversation thread. Pass " +
    "a Chart.js config OBJECT (type + data, optionally options). Use this to " +
    "visualize data — e.g. after analyzing an uploaded CSV. The image renders " +
    "inline in the conversation.",
  parameters: schema,
  async handler({ title, chartSpec }, ctx) {
    // chartSpec is an object; tolerate a stringified one too (some models
    // still hand back a JSON string).
    let spec: Record<string, unknown>;
    if (typeof chartSpec === "string") {
      try {
        spec = JSON.parse(chartSpec) as Record<string, unknown>;
      } catch (e) {
        return `Chart render failed: chartSpec must be a Chart.js config object; got an unparseable string: ${(e as Error).message}`;
      }
    } else {
      spec = chartSpec as Record<string, unknown>;
    }
    try {
      const png = await renderChart(spec);
      // Post the caption as a HEADER first, then the image. A file upload's
      // channel message lands a beat after `postFile` resolves, so posting the
      // caption first keeps a stable caption → image order (posting it after
      // would let the image's message overtake it). Also doubles as a
      // render-tool demo of a JSX <Context> card.
      await ctx.thread.post(
        <Context>{`📊  *${title ?? "Chart"}* — chart below.`}</Context>,
      );
      const res = await ctx.thread.postFile({
        bytes: png,
        filename: `${slug(title ?? "chart")}.png`,
        title: title ?? "Chart",
        altText: title ?? "Generated chart",
      });
      if (!res.ok) {
        return `Chart render failed: ${res.error ?? "upload was rejected"}`;
      }
      return "Rendered and posted the chart image to the thread.";
    } catch (e) {
      return `Chart render failed: ${(e as Error).message}`;
    }
  },
});
