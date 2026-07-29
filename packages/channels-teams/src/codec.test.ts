import { describe, expect, it } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { teamsCodec } from "./codec.js";

describe("teamsCodec", () => {
  it("renders portable IR without adapter credentials", () => {
    const ir: ChannelNode[] = [
      {
        type: "header",
        props: { children: [{ type: "text", props: { value: "hi" } }] },
      },
    ];

    expect(teamsCodec.platform).toBe("teams");
    expect(teamsCodec.renderEgress(ir)).toEqual({
      card: {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.5",
        body: [
          {
            type: "TextBlock",
            text: "hi",
            size: "Large",
            weight: "Bolder",
            wrap: true,
          },
        ],
      },
    });
  });
});
