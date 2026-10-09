import type { Message } from "@ag-ui/client";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createAssistantMessage,
  createTool,
  createMultipleToolCallsMessage,
} from "./test-utils";

function getToolCallIds(message: Message): string[] {
  if (message.role !== "assistant") {
    throw new Error("Expected assistant message");
  }

  return message.toolCalls?.map((tc) => tc.id) ?? [];
}

function getToolResultMessage(
  message: Message | undefined,
): Extract<Message, { role: "tool" }> {
  if (!message || message.role !== "tool") {
    throw new Error("Expected tool message");
  }

  return message;
}

describe("CopilotKitCore.runAgent - Parallel Tool Order", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should preserve tool result ordering for parallel tool calls with followUp: false", async () => {
    const toolA = createTool({
      name: "toolA",
      handler: vi.fn(async () => "Result A"),
      followUp: false,
    });
    const toolB = createTool({
      name: "toolB",
      handler: vi.fn(async () => "Result B"),
      followUp: false,
    });

    copilotKitCore.addTool(toolA);
    copilotKitCore.addTool(toolB);

    // Create a message with two parallel tool calls in order: [A, B]
    const message = createMultipleToolCallsMessage([
      { name: "toolA" },
      { name: "toolB" },
    ]);

    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    // Verify both handlers were called
    expect(toolA.handler).toHaveBeenCalled();
    expect(toolB.handler).toHaveBeenCalled();

    // The message structure should be: [assistant, toolResultA, toolResultB, ...]
    // Find the assistant message
    const assistantIndex = agent.messages.findIndex((m) => m.id === message.id);
    expect(assistantIndex).toBeGreaterThanOrEqual(0);

    // The next two messages should be tool results in order
    const firstToolResult = getToolResultMessage(
      agent.messages[assistantIndex + 1],
    );
    const secondToolResult = getToolResultMessage(
      agent.messages[assistantIndex + 2],
    );

    // Verify the order: first result corresponds to toolA, second to toolB
    const toolCallIds = getToolCallIds(message);
    expect(firstToolResult.toolCallId).toBe(toolCallIds[0]);
    expect(secondToolResult.toolCallId).toBe(toolCallIds[1]);
  });

  it("should preserve tool result ordering with one tool having followUp: true", async () => {
    const toolA = createTool({
      name: "toolA",
      handler: vi.fn(async () => "Result A"),
      followUp: false,
    });
    const toolB = createTool({
      name: "toolB",
      handler: vi.fn(async () => "Result B"),
      followUp: true, // This will trigger a follow-up
    });

    copilotKitCore.addTool(toolA);
    copilotKitCore.addTool(toolB);

    // Create a message with two parallel tool calls in order: [A, B]
    const message = createMultipleToolCallsMessage([
      { name: "toolA" },
      { name: "toolB" },
    ]);

    const followUpMessage = createAssistantMessage({
      content: "Follow-up response",
    });

    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    let callCount = 0;
    agent.runAgentCallback = () => {
      callCount++;
      if (callCount === 2) {
        agent.setNewMessages([followUpMessage]);
      }
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    // Verify both handlers were called
    expect(toolA.handler).toHaveBeenCalled();
    expect(toolB.handler).toHaveBeenCalled();

    // Verify the follow-up was triggered
    expect(agent.runAgentCalls.length).toBeGreaterThan(1);

    // Find the assistant message from the first call
    const assistantIndex = agent.messages.findIndex((m) => m.id === message.id);
    expect(assistantIndex).toBeGreaterThanOrEqual(0);

    // The next two messages should be tool results in order
    const firstToolResult = getToolResultMessage(
      agent.messages[assistantIndex + 1],
    );
    const secondToolResult = getToolResultMessage(
      agent.messages[assistantIndex + 2],
    );

    // Verify the order: first result corresponds to toolA, second to toolB
    const toolCallIds = getToolCallIds(message);
    expect(firstToolResult.toolCallId).toBe(toolCallIds[0]);
    expect(secondToolResult.toolCallId).toBe(toolCallIds[1]);
  });

  it("should preserve tool result ordering with three parallel tool calls", async () => {
    const tools = [
      createTool({
        name: "tool1",
        handler: vi.fn(async () => "Result 1"),
        followUp: false,
      }),
      createTool({
        name: "tool2",
        handler: vi.fn(async () => "Result 2"),
        followUp: false,
      }),
      createTool({
        name: "tool3",
        handler: vi.fn(async () => "Result 3"),
        followUp: false,
      }),
    ];

    tools.forEach((tool) => copilotKitCore.addTool(tool));

    // Create a message with three parallel tool calls in order: [1, 2, 3]
    const message = createMultipleToolCallsMessage([
      { name: "tool1" },
      { name: "tool2" },
      { name: "tool3" },
    ]);

    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    // Verify all handlers were called
    tools.forEach((tool) => {
      expect(tool.handler).toHaveBeenCalled();
    });

    // Find the assistant message
    const assistantIndex = agent.messages.findIndex((m) => m.id === message.id);

    // The next three messages should be tool results in order
    const toolResults = [
      getToolResultMessage(agent.messages[assistantIndex + 1]),
      getToolResultMessage(agent.messages[assistantIndex + 2]),
      getToolResultMessage(agent.messages[assistantIndex + 3]),
    ];

    // Verify the order
    const toolCallIds = getToolCallIds(message);
    toolResults.forEach((result, index) => {
      expect(result.toolCallId).toBe(toolCallIds[index]);
    });
  });
});
