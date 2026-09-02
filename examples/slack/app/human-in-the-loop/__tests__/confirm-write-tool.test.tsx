import { describe, it, expect } from "vitest";
import { renderToIR } from "@copilotkit/channels";
import type { ChannelNode } from "@copilotkit/channels";
import { renderSlackMessage } from "@copilotkit/channels/slack";
import { confirmWriteTool } from "../confirm-write-tool.js";

/** A fake thread recording what the tool posts, and whether it blocked. */
function fakeThread() {
  const posted: unknown[] = [];
  const thread = {
    async post(ui: unknown) {
      posted.push(ui);
      return { id: "msg_1" };
    },
    async awaitChoice() {
      throw new Error("confirm_write must not block on awaitChoice");
    },
  };
  return { thread, posted };
}

describe("confirm_write tool", () => {
  it("posts a ConfirmWrite card and returns without waiting for a click", async () => {
    const { thread, posted } = fakeThread();

    const result = await confirmWriteTool.handler(
      {
        action: "Create Linear issue",
        detail: "CPK-9: Checkout 500s under load",
      },
      { thread, platform: "slack" } as never,
    );

    // The posted UI is a ConfirmWrite card: amber accent + header carrying the action.
    expect(posted).toHaveLength(1);
    const { blocks, accent } = renderSlackMessage(
      renderToIR(posted[0] as ChannelNode),
    );
    expect(accent).toBe("#E2B340");
    const header = blocks.find((b) => b.type === "header") as
      | { text: { text: string } }
      | undefined;
    expect(header?.text.text).toContain("Create Linear issue");

    // The agent is told to stop rather than to write.
    expect(result).toContain("Approval requested");
    expect(result).toContain("end your turn");
  });

  it("accepts a null detail, which models send for an omitted optional", async () => {
    const { thread, posted } = fakeThread();

    await confirmWriteTool.handler(
      { action: "Create Linear issue", detail: null } as never,
      { thread, platform: "slack" } as never,
    );

    expect(posted).toHaveLength(1);
  });

  it("does not block: it never calls awaitChoice", async () => {
    const { thread } = fakeThread();

    // fakeThread throws if awaitChoice is reached, so completing proves the
    // handler returned on its own — the managed path rejects awaitChoice.
    await expect(
      confirmWriteTool.handler(
        { action: "Create Linear issue" } as never,
        {
          thread,
          platform: "slack",
        } as never,
      ),
    ).resolves.toBeTypeOf("string");
  });
});
