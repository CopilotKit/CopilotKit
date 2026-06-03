/**
 * `render_diagram` — the agent emits Mermaid source; we render it to a PNG
 * locally (headless Chromium) and deliver it to the thread via `ctx.postFile`.
 * On invalid Mermaid the tool returns the parser error so the agent can fix
 * and retry rather than posting a broken image.
 */
import { z } from "zod";
import type { FrontendTool } from "@copilotkit/slack";
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

export const renderDiagramTool: FrontendTool<typeof schema> = {
  name: "render_diagram",
  description:
    "Render a Mermaid diagram as an image and post it to the Slack thread. " +
    "Pass Mermaid source (flowchart/sequence/state/etc). Use this to diagram " +
    "a flow, architecture, or incident timeline. The image renders inline.",
  parameters: schema,
  async handler({ title, mermaid }, ctx) {
    if (!ctx.postFile) {
      return JSON.stringify({ ok: false, error: "file delivery unavailable" });
    }
    try {
      const png = await renderDiagram(mermaid);
      const res = await ctx.postFile({
        bytes: png,
        filename: `${slug(title ?? "diagram")}.png`,
        title: title ?? "Diagram",
        altText: title ?? "Generated diagram",
      });
      return JSON.stringify({
        ok: res.ok,
        posted: res.ok,
        ...(res.error ? { error: res.error } : {}),
      });
    } catch (e) {
      // Surface the Mermaid parse error so the agent can repair the source.
      return JSON.stringify({ ok: false, error: (e as Error).message });
    }
  },
};
