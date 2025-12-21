import { describe, it, expect, beforeEach, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { MockAgent, createToolCallMessage, createTool } from "./test-utils";

describe("CopilotKitCore Tool Simple", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
  });

  it("should execute a simple tool", async () => {
    console.log("Starting simple tool test");

    const toolName = "simpleTool";
    const tool = createTool({
      name: toolName,
      handler: vi.fn(async () => {
        console.log("Tool handler called");
        return "Simple result";
      }),
      followUp: false, // Important: no follow-up to avoid recursion
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage(toolName, { input: "test" });
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    console.log("About to run agent");
    await copilotKitCore.runAgent({ agent: agent as any });
    console.log("Agent run complete");

    expect(tool.handler).toHaveBeenCalledWith(
      { input: "test" },
      expect.objectContaining({
        id: expect.any(String),
        function: expect.objectContaining({
          name: toolName,
          arguments: '{"input":"test"}',
        }),
      }),
    );
    expect(agent.messages.length).toBeGreaterThan(0);
  });
});
