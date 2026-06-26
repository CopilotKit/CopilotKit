/**
 * `confirm_tag` is a blocking HITL tool: it posts the `<ConfirmTag>` card via
 * `thread.awaitChoice` and resolves to the clicked button's value. We test the
 * card renders Apply/Cancel actions, and that the tool turns the resolved
 * choice into the right instruction back to the agent.
 */
import { describe, it, expect } from "vitest";
import { renderToIR } from "@copilotkit/bot-ui";
import { renderSlackMessage } from "@copilotkit/bot-slack";
import { ConfirmTag, confirmTagTool } from "../confirm-tag.js";

describe("ConfirmTag card", () => {
  it("renders the proposed label, rationale, and Apply/Cancel actions", () => {
    const { blocks } = renderSlackMessage(
      renderToIR(
        <ConfirmTag label="bug" rationale="500 on submit, reproducible" />,
      ),
    );
    const json = JSON.stringify(blocks);
    expect(json).toContain("Apply");
    expect(json).toContain("Cancel");
    expect(json).toContain("500 on submit, reproducible");
  });
});

describe("confirm_tag tool", () => {
  it("tells the agent to apply the tag when the user approves", async () => {
    const ctx = {
      thread: { awaitChoice: async () => ({ confirmed: true }) },
    } as never;
    const result = await confirmTagTool.handler(
      { label: "bug", rationale: "500 on submit" },
      ctx,
    );
    expect(result).toContain("APPROVED");
  });

  it("tells the agent to stop when the user declines", async () => {
    const ctx = {
      thread: { awaitChoice: async () => ({ confirmed: false }) },
    } as never;
    const result = await confirmTagTool.handler(
      { label: "bug", rationale: "500 on submit" },
      ctx,
    );
    expect(result).toContain("DECLINED");
  });
});
