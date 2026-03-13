import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
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
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    console.log("About to run agent");
    await copilotKitCore.runAgent({ agent: agent as any });
    console.log("Agent run complete");

    expect(tool.handler).toHaveBeenCalledWith(
      { input: "test" },
      {
        toolCall: expect.objectContaining({
          id: expect.any(String),
          function: expect.objectContaining({
            name: toolName,
            arguments: '{"input":"test"}',
          }),
        }),
        agent: expect.objectContaining({
          agentId: "test",
        }),
      },
    );
    expect(agent.messages.length).toBeGreaterThan(0);
  });

  it("should pass the same agent instance to the handler with correct agentId", async () => {
    const expectedAgentId = "my-custom-agent";
    let capturedAgent: AbstractAgent | null = null;

    const toolName = "agentCaptureTool";
    const tool = createTool({
      name: toolName,
      handler: vi.fn(async (_args, context) => {
        capturedAgent = context.agent;
        return "captured";
      }),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage(toolName, { value: "test" });
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: expectedAgentId,
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    // Verify the agent was captured
    expect(capturedAgent).not.toBeNull();
    // Verify it's the same agent instance
    expect(capturedAgent).toBe(agent);
    // Verify the agentId matches what was set up
    expect(capturedAgent!.agentId).toBe(expectedAgentId);
  });
});
