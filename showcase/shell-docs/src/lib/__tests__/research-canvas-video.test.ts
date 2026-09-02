import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const researchCanvasVideoSource = readFileSync(
  new URL(
    "../../content/docs/integrations/langgraph/videos/research-canvas.mdx",
    import.meta.url,
  ),
  "utf8",
);

describe("Research Canvas video page", () => {
  it("identifies the v1 recording and links the current v2 implementation", () => {
    expect(researchCanvasVideoSource).toContain(
      '<YouTubeVideo videoId="0b6BVqPwqA0"',
    );
    expect(researchCanvasVideoSource).toContain(
      "This recording uses CopilotKit v1 APIs.",
    );
    expect(researchCanvasVideoSource).toContain(
      "[current CopilotKit v2 source code](https://github.com/CopilotKit/CopilotKit/blob/main/examples/canvas/research-canvas/readme.md)",
    );
    expect(researchCanvasVideoSource).toContain(
      "[v1 to v2 migration guide](/migrate/v2)",
    );
  });
});
