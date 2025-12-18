import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createMessage,
  createAssistantMessage,
  createToolCallMessage,
  createTool,
} from "./test-utils";

describe("CopilotKitCore.runAgent - Basic Functionality", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(agent.runAgentCalls[0].forwardedProps).toEqual({});
  });

  it("should forward properties to agent.runAgent", async () => {
    const properties = { apiKey: "test-key", model: "gpt-4" };
    copilotKitCore = new CopilotKitCore({ properties });
    const agent = new MockAgent({ newMessages: [] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls[0].forwardedProps).toEqual(properties);
  });

  it("should handle empty newMessages array", async () => {
    const agent = new MockAgent({ newMessages: [] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    const result = await copilotKitCore.runAgent({ agent: agent as any });

    expect(result.newMessages).toEqual([]);
    expect(agent.runAgentCalls).toHaveLength(1);
  });

  it("should ignore non-assistant messages for tool processing", async () => {
    const messages = [
      createMessage({ role: "user", content: "User message" }),
      createMessage({ role: "system", content: "System message" }),
      createMessage({ role: "tool", content: "Tool result", toolCallId: "123" }),
    ];
    const agent = new MockAgent({ newMessages: messages });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    const result = await copilotKitCore.runAgent({ agent: agent as any });

    expect(result.newMessages).toEqual(messages);
    expect(agent.runAgentCalls).toHaveLength(1);
  });

  it("should handle messages with undefined toolCalls", async () => {
    const message = createAssistantMessage({
      content: "Response",
      toolCalls: undefined
    });
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    const result = await copilotKitCore.runAgent({ agent: agent as any });

    expect(result.newMessages).toEqual([message]);
    expect(agent.runAgentCalls).toHaveLength(1);
  });

  it("should handle tool returning undefined as empty string", async () => {
    const toolName = "undefinedTool";
    const tool = createTool({
      name: toolName,
      handler: vi.fn(async () => undefined),
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage(toolName);
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(agent.messages).toContainEqual(
      expect.objectContaining({
        role: "tool",
        content: "", // Should be empty string, not "undefined"
      })
    );
  });

  it("should handle tool returning null as empty string", async () => {
    const toolName = "nullTool";
    const tool = createTool({
      name: toolName,
      handler: vi.fn(async () => null),
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage(toolName);
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(agent.messages).toContainEqual(
      expect.objectContaining({
        role: "tool",
        content: "", // Should be empty string, not "null"
      })
    );
  });

  it("should return correct result structure", async () => {
    const newMessages = [
      createAssistantMessage({ content: "Test" })
    ];
    const agent = new MockAgent({ newMessages });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    const result = await copilotKitCore.runAgent({ agent: agent as any });

    expect(result).toHaveProperty("newMessages");
    expect(Array.isArray(result.newMessages)).toBe(true);
    expect(result.newMessages).toEqual(newMessages);
  });
});