/**
 * The `tag_card` render-tool posts the finished `<TagCard>` to the thread. We
 * drive the handler with a minimal fake `thread` whose `post` records the
 * posted Renderable, then assert that rendering it through the shared
 * `renderToIR` → `renderSlackMessage` path yields the expected Block Kit shape.
 */
import { describe, it, expect } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import { renderSlackMessage } from "@copilotkit/bot-slack";
import { tagCardTool } from "../tag-card.js";

/** A fake `thread` that records each posted Renderable. */
function fakeThread() {
  const posts: unknown[] = [];
  const thread = {
    post: async (ui: unknown) => {
      posts.push(ui);
      return { id: "m1" };
    },
  };
  return { posts, ctx: { thread, platform: "slack" } as never };
}

describe("tag_card render-tool", () => {
  it("posts a TagCard rendering to a label header + rationale", async () => {
    const { posts, ctx } = fakeThread();
    const result = await tagCardTool.handler(
      {
        label: "bug",
        rationale: "Reporter hit a 500 on submit; reproducible.",
        confidence: "high",
      },
      ctx,
    );

    expect(posts).toHaveLength(1);
    expect(result).toBe("Displayed the applied tag card to the user.");

    const { blocks } = renderSlackMessage(renderToIR(posts[0] as never));
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "🏷️ Tagged: bug" },
    });
    const json = JSON.stringify(blocks);
    expect(json).toContain("Reporter hit a 500 on submit; reproducible.");
    expect(json).toContain("confidence: high");
  });
});
