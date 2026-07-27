import { describe, it, expect } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { slackCodec } from "./codec.js";

describe("slackCodec", () => {
  it("is the slack platform codec", () => {
    expect(slackCodec.platform).toBe("slack");
  });

  it("renders IR to Slack Block Kit via the shared pure renderer", () => {
    const ir: ChannelNode[] = [
      {
        type: "section",
        props: { children: [{ type: "text", props: { value: "hi" } }] },
      },
    ];
    const out = slackCodec.renderEgress(ir) as { blocks: unknown[] };
    expect(out.blocks).toEqual([
      { type: "section", text: { type: "mrkdwn", text: "hi" } },
    ]);
  });
});
