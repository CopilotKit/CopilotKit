/**
 * `render_mrr` — post an MRR summary card as an image. `<MrrCard/>` is
 * arbitrary app/React JSX (not the `@copilotkit/channels-ui` vocabulary), so
 * the channels-ui JSX pragma compiles it to an unbranded-function
 * `ChannelNode`; `thread.post` peeks at its output and routes it to the
 * Takumi image path automatically — no wrapper needed.
 */
import { z } from "zod";
import { defineChannelTool } from "@copilotkit/channels";
import { MrrCard } from "../components/mrr-card.js";

const schema = z.object({
  value: z.string().describe("Formatted MRR, e.g. '$48,200'."),
  delta: z.number().describe("Percent change vs last period, e.g. 12 or -3."),
});

export const renderMrrTool = defineChannelTool({
  name: "render_mrr",
  description:
    "Render an MRR summary card as an image and post it to the thread.",
  parameters: schema,
  async handler({ value, delta }, { thread }) {
    await thread.post(<MrrCard value={value} delta={delta} />, {
      filename: "mrr.png",
      title: "MRR",
    });
    return "Posted the MRR card.";
  },
});
