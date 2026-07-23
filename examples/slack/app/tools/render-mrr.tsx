/**
 * `render_mrr` — post an MRR summary card (and an optional signups bar chart)
 * as images. `<MrrCard/>` and `<BarChart/>` are arbitrary app/React JSX (not
 * the `@copilotkit/channels-ui` vocabulary), so the channels-ui JSX pragma
 * compiles them to unbranded-function `ChannelNode`s; `thread.post` peeks at
 * their output and routes them to the Takumi image path automatically — no
 * wrapper needed.
 */
import { z } from "zod";
import { defineChannelTool } from "@copilotkit/channels";
import { BarChart } from "@copilotkit/channels/charts";
import { MrrCard } from "../components/mrr-card.js";

const schema = z.object({
  value: z.string().describe("Formatted MRR, e.g. '$48,200'."),
  delta: z.number().describe("Percent change vs last period, e.g. 12 or -3."),
  series: z
    .array(z.object({ label: z.string(), value: z.number() }))
    .optional()
    .describe("Optional daily signups to chart below the card."),
});

export const renderMrrTool = defineChannelTool({
  name: "render_mrr",
  description:
    "Render an MRR summary card (and optional signups bar chart) as images and post them to the thread.",
  parameters: schema,
  async handler({ value, delta, series }, { thread }) {
    await thread.post(<MrrCard value={value} delta={delta} />, {
      filename: "mrr.png",
      title: "MRR",
    });
    if (series?.length) {
      await thread.post(<BarChart title="Signups / day" data={series} />, {
        filename: "signups.png",
      });
    }
    return (
      "Posted the MRR card" + (series?.length ? " and signups chart." : ".")
    );
  },
});
