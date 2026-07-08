/**
 * `render_chart` — the agent describes the data it wants to visualize and we
 * render it as a **native Teams chart** (an Adaptive Card chart element), no
 * image generation involved. This is the "upload a CSV → get a chart" payoff:
 * the agent parses the data (the CSV arrives as readable text via the adapter's
 * inbound-file handling), then calls this with a simple `{label, value}` series.
 *
 * Native charts render right inside the card, so there's no headless browser,
 * no Chromium, and no PNG upload, so the bot stays a pure Node service.
 */
import { z } from "zod";
import { defineBotTool } from "@copilotkit/channels";
import { Message, Chart } from "@copilotkit/channels-ui";

const schema = z.object({
  chartType: z
    .enum(["verticalBar", "horizontalBar", "line", "pie", "donut"])
    .optional()
    .describe(
      "Chart kind. Defaults to 'verticalBar'. Use 'line' for trends over " +
        "time, 'pie'/'donut' for parts of a whole, 'horizontalBar' for ranked " +
        "categories with long labels.",
    ),
  title: z.string().describe("Short title shown above the chart."),
  xAxisTitle: z
    .string()
    .optional()
    .describe("X-axis label (bar/line charts only)."),
  yAxisTitle: z
    .string()
    .optional()
    .describe("Y-axis label (bar/line charts only)."),
  data: z
    .array(
      z.object({
        label: z
          .string()
          .describe("Category / x value, e.g. '2026-01' or 'Sev1'."),
        value: z.number().describe("Numeric value for this category."),
      }),
    )
    .min(1)
    .describe("The data to plot — one entry per category."),
});

export const renderChartTool = defineBotTool({
  name: "render_chart",
  description:
    "Render a native chart in the conversation. Provide a chartType, a title, " +
    "and a `data` array of {label, value} points (inline the actual numbers). " +
    "Use this to visualize data — e.g. after analyzing an uploaded CSV. The " +
    "chart renders inline in Teams.",
  parameters: schema,
  async handler({ chartType, title, xAxisTitle, yAxisTitle, data }, ctx) {
    await ctx.thread.post(
      <Message accent="#5B5FC7">
        <Chart
          type={chartType ?? "verticalBar"}
          title={title}
          xAxisTitle={xAxisTitle}
          yAxisTitle={yAxisTitle}
          data={data}
        />
      </Message>,
    );
    return "Rendered and posted the chart. Give a one-line confirmation; do not restate the chart's data in prose.";
  },
});
