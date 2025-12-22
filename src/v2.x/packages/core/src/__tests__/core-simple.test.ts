import { describe, it, expect, beforeEach, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { MockAgent, createMessage, createAssistantMessage } from "./test-utils";

describe("CopilotKitCore.runAgent Simple", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
  });

  it("should run agent without tools", async () => {
    const messages = [
      createMessage({ content: "Hello" }),
      createAssistantMessage({ content: "Hi there!" }),
    ];
    const agent = new MockAgent({ newMessages: messages });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    const result = await copilotKitCore.runAgent({ agent: agent as any });

    expect(result.newMessages).toEqual(messages);
    expect(agent.runAgentCalls).toHaveLength(1);
  });
});