/**
 * `render_chart` — render a chart as an image on WhatsApp.
 *
 * WhatsApp has no inline/generative chart surface, but it DOES render image
 * messages. So instead of a headless browser (the Slack example's approach),
 * we build a QuickChart (https://quickchart.io) URL from a Chart.js config and
 * post it as an `<Image>` — the adapter sends an image message and WhatsApp
 * fetches and displays it. No browser, no binary upload: just a public URL.
 */
import { z } from "zod";
import { defineBotTool } from "@copilotkit/bot";

const chartSchema = z.object({
  type: z
    .enum(["bar", "line", "pie", "doughnut"])
    .describe("Chart type."),
  title: z.string().optional().describe("Optional chart title."),
  labels: z
    .array(z.string())
    .min(1)
    .describe("Category / x-axis labels, one per data point."),
  datasets: z
    .array(
      z.object({
        label: z.string().optional().describe("Series name (shown in legend)."),
        data: z.array(z.number()).describe("Values, aligned to `labels`."),
      }),
    )
    .min(1)
    .describe("One or more data series."),
});

type ChartProps = z.infer<typeof chartSchema>;

/** Build a QuickChart image URL from a Chart.js config. */
export function quickChartUrl({ type, title, labels, datasets }: ChartProps): string {
  const config = {
    type,
    data: { labels, datasets: datasets.map((d) => ({ label: d.label, data: d.data })) },
    options: title
      ? { plugins: { title: { display: true, text: title } } }
      : {},
  };
  const c = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?w=700&h=420&bkg=white&c=${c}`;
}

export const renderChartTool = defineBotTool({
  name: "render_chart",
  description:
    "Render a chart as an image on WhatsApp. Pass a chart `type` " +
    "(bar/line/pie/doughnut), `labels`, and one or more `datasets` " +
    "({label, data}). Use this whenever the user wants data visualized — " +
    "parse any numbers from the conversation and chart them. Posts an image.",
  parameters: chartSchema,
  async handler(props, { thread }) {
    const url = quickChartUrl(props);
    // Fetch the PNG ourselves (server-side) and UPLOAD the bytes to WhatsApp,
    // rather than sending the QuickChart URL as an image link. WhatsApp's own
    // fetch of an external URL is unreliable (intermittent 502s on the public
    // QuickChart endpoint, with no error surfaced). Fetching here lets us
    // handle failures and hand WhatsApp the bytes directly (no external fetch).
    let bytes: Uint8Array;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`[tool:render_chart] quickchart -> ${res.status}`);
        return `The chart service returned ${res.status}. Tell the user charting is temporarily unavailable and to try again shortly.`;
      }
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      console.error("[tool:render_chart] fetch failed:", err);
      return `Could not reach the chart service: ${(err as Error).message}. Ask the user to retry.`;
    }
    const result = await thread.postFile({
      bytes,
      filename: "chart.png",
      title: props.title,
      altText: props.title ?? "chart",
    });
    return result.ok
      ? "Displayed the chart image to the user."
      : `Failed to send the chart image: ${result.error ?? "unknown error"}.`;
  },
});
