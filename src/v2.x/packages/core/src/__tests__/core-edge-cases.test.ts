import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createAssistantMessage,
  createToolCallMessage,
  createToolResultMessage,
  createTool,
} from "./test-utils";

describe("CopilotKitCore.runAgent - Edge Cases", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should skip tool call when result already exists in newMessages", async () => {
    const tool = createTool({
      name: "alreadyProcessedTool",
      handler: vi.fn(async () => "Should not be called"),
    });
    copilotKitCore.addTool(tool);

    const toolCallId = "processed-call";
    const assistantMsg = createToolCallMessage("alreadyProcessedTool");
    if (assistantMsg.role === 'assistant' && assistantMsg.toolCalls && assistantMsg.toolCalls[0]) {
      assistantMsg.toolCalls[0].id = toolCallId;
    }
    const existingResult = createToolResultMessage(toolCallId, "Already processed");

    const agent = new MockAgent({
      newMessages: [assistantMsg, existingResult],
    });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(tool.handler).not.toHaveBeenCalled();
  });

  it("should handle empty tool function name", async () => {
    const message = createAssistantMessage({
      content: "",
      toolCalls: [{
        id: "empty-name-call",
        type: "function",
        function: {
          name: "",
          arguments: "{}",
        },
      }],
    });

    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(agent.messages.filter(m => m.role === "tool")).toHaveLength(0);
  });

  it("should handle tool arguments as empty string", async () => {
    const tool = createTool({
      name: "emptyArgsTool",
      handler: vi.fn(async (args) => `Received: ${JSON.stringify(args)}`),
    });
    copilotKitCore.addTool(tool);

    const message = createAssistantMessage({
      content: "",
      toolCalls: [{
        id: "empty-args-call",
        type: "function",
        function: {
          name: "emptyArgsTool",
          arguments: "",
        },
      }],
    });

    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await expect(copilotKitCore.runAgent({ agent: agent as any })).rejects.toThrow();
  });

  it("should handle very large tool result", async () => {
    const largeResult = "x".repeat(100000); // 100KB string
    const tool = createTool({
      name: "largeTool",
      handler: vi.fn(async () => largeResult),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("largeTool");
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await copilotKitCore.runAgent({ agent: agent as any });

    const toolMessage = agent.messages.find(m => m.role === "tool");
    expect(toolMessage?.content).toBe(largeResult);
  });

  it("should handle tool handler modifying agent state", async () => {
    const tool = createTool({
      name: "stateTool",
      handler: vi.fn(async () => {
        // Try to modify agent messages during execution
        agent.messages.push(createAssistantMessage({ content: "Injected" }));
        return "Result";
      }),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("stateTool");
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await copilotKitCore.runAgent({ agent: agent as any });

    // The injected message should be present
    expect(agent.messages.some(m => m.content === "Injected")).toBe(true);
    // Tool result should still be added correctly
    expect(agent.messages.some(m => m.role === "tool" && m.content === "Result")).toBe(true);
  });

  it("should propagate errors from agent.runAgent", async () => {
    const errorMessage = "Agent execution failed";
    const agent = new MockAgent({
      error: new Error(errorMessage)
    });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await expect(copilotKitCore.runAgent({ agent: agent as any }))
      .rejects
      .toThrow(errorMessage);
  });

  it("should handle tool with invalid JSON arguments", async () => {
    const toolName = "invalidJsonTool";
    const tool = createTool({
      name: toolName,
      handler: vi.fn(async () => "Should not be called"),
    });
    copilotKitCore.addTool(tool);

    const message = createAssistantMessage({
      content: "",
      toolCalls: [{
        id: "tool-call-1",
        type: "function",
        function: {
          name: toolName,
          arguments: "{ invalid json",
        },
      }],
    });
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await expect(copilotKitCore.runAgent({ agent: agent as any })).rejects.toThrow();
    expect(tool.handler).not.toHaveBeenCalled();
  });
});