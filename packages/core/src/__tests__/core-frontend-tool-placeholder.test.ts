import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createToolCallMessage,
  createToolResultMessage,
  createTool,
} from "./test-utils";

describe("CopilotKitCore - Frontend Tool Placeholder (remote agent HITL)", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should execute handler and replace placeholder when backend returns a placeholder result", async () => {
    const handler = vi.fn(async () => "Real result");
    const tool = createTool({ name: "myTool", handler, followUp: false });
    copilotKitCore.addTool(tool);

    const toolCallMsg = createToolCallMessage("myTool");
    const toolCallId = (toolCallMsg as any).toolCalls![0].id;
    const placeholder = createToolResultMessage(
      toolCallId,
      "Forwarded to client",
    );

    const agent = new MockAgent({ newMessages: [toolCallMsg, placeholder] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    // Handler was called
    expect(handler).toHaveBeenCalledOnce();

    // The real result message should be present; the placeholder must be gone
    const toolMessages = agent.messages.filter(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolMessages).toHaveLength(1);
    expect((toolMessages[0] as any).content).not.toBe("Forwarded to client");
  });

  it("should preserve placeholder and skip execution when tool has no handler", async () => {
    // A tool definition without a handler represents a backend-only tool
    const tool = createTool({
      name: "backendTool",
      handler: undefined,
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const toolCallMsg = createToolCallMessage("backendTool");
    const toolCallId = (toolCallMsg as any).toolCalls![0].id;
    const placeholder = createToolResultMessage(
      toolCallId,
      "Forwarded to client",
    );

    const agent = new MockAgent({ newMessages: [toolCallMsg, placeholder] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    // The placeholder should remain untouched
    const toolMessages = agent.messages.filter(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolMessages).toHaveLength(1);
    expect((toolMessages[0] as any).content).toBe("Forwarded to client");
  });

  it("should preserve non-placeholder backend results when a frontend handler is registered", async () => {
    const handler = vi.fn(async () => "Real result");
    const tool = createTool({ name: "myTool", handler, followUp: false });
    copilotKitCore.addTool(tool);

    const toolCallMsg = createToolCallMessage("myTool");
    const toolCallId = (toolCallMsg as any).toolCalls![0].id;
    const backendResult = createToolResultMessage(toolCallId, "Backend result");

    const agent = new MockAgent({ newMessages: [toolCallMsg, backendResult] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(handler).not.toHaveBeenCalled();

    const toolMessages = agent.messages.filter(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolMessages).toHaveLength(1);
    expect((toolMessages[0] as any).content).toBe("Backend result");
  });

  it("should execute handler normally when no existing result (BuiltInAgent regression)", async () => {
    const handler = vi.fn(async () => "Result");
    const tool = createTool({ name: "localTool", handler, followUp: false });
    copilotKitCore.addTool(tool);

    // No placeholder — mirrors BuiltInAgent / Vercel AI SDK behaviour
    const toolCallMsg = createToolCallMessage("localTool");
    const agent = new MockAgent({ newMessages: [toolCallMsg] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(handler).toHaveBeenCalledOnce();

    const toolCallId = (toolCallMsg as any).toolCalls![0].id;
    const toolMessages = agent.messages.filter(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolMessages).toHaveLength(1);
  });

  it("should invoke wildcard handler when no specific tool is registered and no existing result", async () => {
    const wildcardHandler = vi.fn(async () => "Wildcard result");
    const wildcardTool = createTool({
      name: "*",
      handler: wildcardHandler,
      followUp: false,
    });
    copilotKitCore.addTool(wildcardTool);

    const toolCallMsg = createToolCallMessage("unknownTool");
    const agent = new MockAgent({ newMessages: [toolCallMsg] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(wildcardHandler).toHaveBeenCalledOnce();
  });

  it("should invoke the wildcard handler when the placeholder is the only existing result", async () => {
    const wildcardHandler = vi.fn(async () => "Wildcard result");
    const wildcardTool = createTool({
      name: "*",
      handler: wildcardHandler,
      followUp: false,
    });
    copilotKitCore.addTool(wildcardTool);

    const toolCallMsg = createToolCallMessage("unknownTool");
    const toolCallId = (toolCallMsg as any).toolCalls![0].id;
    const placeholder = createToolResultMessage(
      toolCallId,
      "Forwarded to client",
    );

    const agent = new MockAgent({ newMessages: [toolCallMsg, placeholder] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(wildcardHandler).toHaveBeenCalledOnce();

    const toolMessages = agent.messages.filter(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolMessages).toHaveLength(1);
    expect((toolMessages[0] as any).content).toBe("Wildcard result");
  });

  it("should send exactly one real tool message into the follow-up run after replacing the placeholder", async () => {
    let agent: MockAgent;
    const toolMessagesSeenByFollowUp: Array<{
      content: unknown;
      count: number;
      hasAssistantToolCall: boolean;
    }> = [];

    const handler = vi.fn(async () => {
      agent.setNewMessages([]);
      return "Real result";
    });
    const tool = createTool({ name: "myTool", handler, followUp: true });
    copilotKitCore.addTool(tool);

    const toolCallMsg = createToolCallMessage("myTool");
    const toolCallId = (toolCallMsg as any).toolCalls![0].id;
    const placeholder = createToolResultMessage(
      toolCallId,
      "Forwarded to client",
    );

    agent = new MockAgent({
      newMessages: [toolCallMsg, placeholder],
      runAgentCallback: () => {
        if (agent.runAgentCalls.length !== 2) {
          return;
        }

        const toolMessages = agent.messages.filter(
          (m) => m.role === "tool" && m.toolCallId === toolCallId,
        );
        toolMessagesSeenByFollowUp.push({
          content: (toolMessages[0] as any)?.content,
          count: toolMessages.length,
          hasAssistantToolCall: agent.messages.some(
            (m) =>
              m.role === "assistant" &&
              (m as any).toolCalls?.some(
                (toolCall: any) => toolCall.id === toolCallId,
              ),
          ),
        });
      },
    });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(handler).toHaveBeenCalledOnce();
    expect(agent.runAgentCalls).toHaveLength(2);
    expect(toolMessagesSeenByFollowUp).toEqual([
      {
        content: "Real result",
        count: 1,
        hasAssistantToolCall: true,
      },
    ]);
  });
});
