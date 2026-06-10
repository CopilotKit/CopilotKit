/**
 * `render_diagram` — the agent emits Mermaid source; we render it to a PNG
 * locally (headless Chromium) and deliver it to the thread via `ctx.thread.postFile`.
 * On invalid Mermaid the tool returns the parser error so the agent can fix
 * and retry rather than posting a broken image. After a successful upload we
 * also post a small JSX caption card (`<Context>`) so the tool doubles as a
 * render-tool demo.
 */
import { z } from "zod";
import { Context } from "@copilotkit/bot-ui";
import { defineBotTool } from "@copilotkit/bot";
import { renderDiagram } from "../render/diagram.js";

const schema = z.object({
  title: z
    .string()
    .optional()
    .describe("Short title shown as the image's filename/caption."),
  mermaid: z
    .string()
    .describe(
      "Mermaid diagram source. e.g. 'flowchart TD\\n A[Alert] --> B{Sev?}\\n " +
        "B -->|1| C[Page owner]'. Supports flowchart, sequence, state, etc.",
    ),
});

function slug(s: string): string {
  return (
    (s || "diagram")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "diagram"
  );
}

export const renderDiagramTool = defineBotTool({
  name: "render_diagram",
  description:
    "Render a Mermaid diagram as an image and post it to the Slack thread. " +
    "Pass Mermaid source (flowchart/sequence/state/etc). Use this to diagram " +
    "a flow, architecture, or incident timeline. The image renders inline.",
  parameters: schema,
  async handler({ title, mermaid }, ctx) {
    try {
      const png = await renderDiagram(mermaid);
      const res = await ctx.thread.postFile({
        bytes: png,
        filename: `${slug(title ?? "diagram")}.png`,
        title: title ?? "Diagram",
        altText: title ?? "Generated diagram",
      });
      if (!res.ok) {
        return `Diagram render failed: ${res.error ?? "upload was rejected"}. Fix the Mermaid syntax and retry.`;
      }
      // After the image lands, post a small JSX caption card.
      await ctx.thread.post(
        <Context>{`:triangular_ruler:  *${title ?? "Diagram"}* — rendered as an image above.`}</Context>,
      );
      return "Rendered and posted the diagram image to the thread.";
    } catch (e) {
      // Surface the Mermaid parse error so the agent can repair the source.
      return `Diagram render failed: ${(e as Error).message}. Fix the Mermaid syntax and retry.`;
    }
  },
});
