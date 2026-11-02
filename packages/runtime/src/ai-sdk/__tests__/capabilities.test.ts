/**
 * `aiSdkAgent(...).getCapabilities()`, ported from the classic BuiltInAgent
 * `capabilities.test.ts`. The merge rules themselves are pinned on
 * BuiltInAgent in `agent/__tests__/agent.test.ts`; these cases pin that
 * `aiSdkAgent` reports the defaults and passes `capabilities` through.
 */
import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { aiSdkAgent } from "../agent";

describe("aiSdkAgent getCapabilities", () => {
  it("reports the default capabilities", async () => {
    const agent = aiSdkAgent({ model: new MockLanguageModelV3() });

    expect(await agent.getCapabilities()).toEqual({
      tools: { supported: true, clientProvided: true },
      transport: { streaming: true },
      humanInTheLoop: { interrupts: true },
    });
  });

  it("adds configured categories and replaces a whole default category", async () => {
    const agent = aiSdkAgent({
      model: new MockLanguageModelV3(),
      capabilities: {
        tools: { supported: true, clientProvided: true, parallelCalls: true },
        reasoning: { supported: true, streaming: true },
        identity: { name: "my-agent", type: "custom" },
      },
    });

    expect(await agent.getCapabilities()).toEqual({
      tools: { supported: true, clientProvided: true, parallelCalls: true },
      transport: { streaming: true },
      humanInTheLoop: { interrupts: true },
      reasoning: { supported: true, streaming: true },
      identity: { name: "my-agent", type: "custom" },
    });
  });
});
