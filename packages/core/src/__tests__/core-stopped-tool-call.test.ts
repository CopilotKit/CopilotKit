import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createToolCallMessage,
  createTool,
  getAssistantMessage,
} from "./test-utils";

describe("CopilotKitCore - unanswered tool call from stopped run", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should answer unanswered tool calls with a stopped result when a run is stopped", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const tool = createTool({
      name: "send_email",
      handler: vi.fn(async () => "email sent"),
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("send_email");
    const assistant = getAssistantMessage(message);
    const toolCallId = assistant.toolCalls![0]!.id;
    agent.setNewMessages([message]);

    agent.runAgentCallback = () => {
      copilotKitCore.stopAgent({ agent: agent as any });
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    // The tool handler should NOT have executed because the run was stopped
    expect(tool.handler).not.toHaveBeenCalled();

    // But the tool call MUST be answered with a stopped result so subsequent turns succeed
    const toolResult = agent.messages.find(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolResult).toBeDefined();
    expect(JSON.parse(toolResult!.content as string)).toMatchObject({
      status: "stopped",
      reason: "stop_requested",
      message: "Run stopped by user",
    });
  });

  it("should answer unanswered tool call even when the tool is not registered on frontend", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    // Tool "unknown_tool" is NOT added to copilotKitCore
    const message = createToolCallMessage("unknown_tool");
    const assistant = getAssistantMessage(message);
    const toolCallId = assistant.toolCalls![0]!.id;
    agent.setNewMessages([message]);

    agent.runAgentCallback = () => {
      copilotKitCore.stopAgent({ agent: agent as any });
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    const toolResult = agent.messages.find(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolResult).toBeDefined();
    expect(JSON.parse(toolResult!.content as string)).toMatchObject({
      status: "stopped",
      reason: "stop_requested",
      message: "Run stopped by user",
    });
  });

  it("should replace transport placeholders like FORWARDED_TO_CLIENT with a stopped result when a run is stopped", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const tool = createTool({
      name: "fetch_data",
      handler: vi.fn(async () => "data"),
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("fetch_data");
    const toolCallId = getAssistantMessage(message).toolCalls![0]!.id;
    const placeholder = {
      id: "placeholder-1",
      role: "tool" as const,
      toolCallId,
      content: "Forwarded to client",
    };

    agent.setNewMessages([message, placeholder]);

    agent.runAgentCallback = () => {
      copilotKitCore.stopAgent({ agent: agent as any });
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(tool.handler).not.toHaveBeenCalled();

    // The placeholder should be replaced by the stopped result
    const toolResults = agent.messages.filter(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]!.content).not.toBe("Forwarded to client");
    expect(JSON.parse(toolResults[0]!.content as string)).toMatchObject({
      status: "stopped",
    });
  });

  it("should clean up multiple duplicate placeholder messages when stopped", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const tool = createTool({
      name: "dup_tool",
      handler: vi.fn(async () => "data"),
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("dup_tool");
    const toolCallId = getAssistantMessage(message).toolCalls![0]!.id;
    const placeholder1 = {
      id: "placeholder-1",
      role: "tool" as const,
      toolCallId,
      content: "Forwarded to client",
    };
    const placeholder2 = {
      id: "placeholder-2",
      role: "tool" as const,
      toolCallId,
      content: "Forwarded to client",
    };

    agent.setNewMessages([message, placeholder1, placeholder2]);

    agent.runAgentCallback = () => {
      copilotKitCore.stopAgent({ agent: agent as any });
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    const toolResults = agent.messages.filter(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]!.content).not.toBe("Forwarded to client");
    expect(JSON.parse(toolResults[0]!.content as string)).toMatchObject({
      status: "stopped",
    });
  });

  it("should never overwrite existing valid tool results when a run is stopped", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const tool = createTool({
      name: "valid_tool",
      handler: vi.fn(async () => "new result"),
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("valid_tool");
    const toolCallId = getAssistantMessage(message).toolCalls![0]!.id;
    const existingResult = {
      id: "result-1",
      role: "tool" as const,
      toolCallId,
      content: JSON.stringify({ status: "success", data: "already completed" }),
    };

    agent.setNewMessages([message, existingResult]);

    agent.runAgentCallback = () => {
      copilotKitCore.stopAgent({ agent: agent as any });
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(tool.handler).not.toHaveBeenCalled();

    // The valid result must NOT be overwritten with a stopped result
    const toolResults = agent.messages.filter(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]!.content).toBe(
      JSON.stringify({ status: "success", data: "already completed" }),
    );
  });

  it("should preserve existing real tool result even if a duplicate placeholder was present", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const tool = createTool({
      name: "mixed_tool",
      handler: vi.fn(async () => "new result"),
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("mixed_tool");
    const toolCallId = getAssistantMessage(message).toolCalls![0]!.id;
    const placeholder = {
      id: "placeholder-1",
      role: "tool" as const,
      toolCallId,
      content: "Forwarded to client",
    };
    const realResult = {
      id: "real-1",
      role: "tool" as const,
      toolCallId,
      content: JSON.stringify({ status: "success", data: "real result" }),
    };

    // Both a placeholder and a real result exist
    agent.setNewMessages([message, placeholder, realResult]);

    agent.runAgentCallback = () => {
      copilotKitCore.stopAgent({ agent: agent as any });
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(tool.handler).not.toHaveBeenCalled();

    // The real result should be kept and placeholder removed
    const toolResults = agent.messages.filter(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]!.content).toBe(
      JSON.stringify({ status: "success", data: "real result" }),
    );
  });

  it("should not trigger follow-up runs when answered with a stopped result", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const tool = createTool({
      name: "follow_up_tool",
      handler: vi.fn(async () => "result"),
      followUp: true,
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("follow_up_tool");
    agent.setNewMessages([message]);

    agent.runAgentCallback = () => {
      copilotKitCore.stopAgent({ agent: agent as any });
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    // Only 1 run occurred (the initial one), no follow-up run was triggered
    expect(agent.runAgentCalls).toHaveLength(1);
  });

  it("should answer multiple unanswered tool calls in a single assistant message with stopped results in order", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    copilotKitCore.addTool(createTool({ name: "toolA" }));
    copilotKitCore.addTool(createTool({ name: "toolB" }));

    const message = {
      id: "msg-assistant",
      role: "assistant" as const,
      content: "",
      toolCalls: [
        {
          id: "call-A",
          type: "function" as const,
          function: { name: "toolA", arguments: "{}" },
        },
        {
          id: "call-B",
          type: "function" as const,
          function: { name: "toolB", arguments: "{}" },
        },
      ],
    };
    agent.setNewMessages([message]);

    agent.runAgentCallback = () => {
      copilotKitCore.stopAgent({ agent: agent as any });
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    const toolA = agent.messages.find(
      (m) => m.role === "tool" && m.toolCallId === "call-A",
    );
    const toolB = agent.messages.find(
      (m) => m.role === "tool" && m.toolCallId === "call-B",
    );

    expect(toolA).toBeDefined();
    expect(toolB).toBeDefined();
    expect(JSON.parse(toolA!.content as string)).toMatchObject({
      status: "stopped",
    });
    expect(JSON.parse(toolB!.content as string)).toMatchObject({
      status: "stopped",
    });

    // Check insertion order: assistant message -> toolA -> toolB
    const assistantIdx = agent.messages.findIndex(
      (m) => m.id === "msg-assistant",
    );
    const toolAIdx = agent.messages.findIndex(
      (m) => m.role === "tool" && m.toolCallId === "call-A",
    );
    const toolBIdx = agent.messages.findIndex(
      (m) => m.role === "tool" && m.toolCallId === "call-B",
    );

    expect(toolAIdx).toBe(assistantIdx + 1);
    expect(toolBIdx).toBe(assistantIdx + 2);
  });

  it("should answer unanswered tool call when stopped via agent.abortRun()", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const tool = createTool({
      name: "calc",
      handler: vi.fn(async () => "42"),
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("calc");
    const assistant = getAssistantMessage(message);
    const toolCallId = assistant.toolCalls![0]!.id;
    agent.setNewMessages([message]);

    agent.runAgentCallback = () => {
      agent.abortRun();
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(tool.handler).not.toHaveBeenCalled();

    const toolResult = agent.messages.find(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolResult).toBeDefined();
    expect(JSON.parse(toolResult!.content as string)).toMatchObject({
      status: "stopped",
    });
  });

  it("should repair tool call pairs so the subsequent turn has all tool calls answered", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    copilotKitCore.addTool(
      createTool({
        name: "action_tool",
        handler: vi.fn(async () => "done"),
      }),
    );

    // Turn 1: Stopped run
    const toolMsg = createToolCallMessage("action_tool");
    const toolCallId = getAssistantMessage(toolMsg).toolCalls![0]!.id;
    agent.setNewMessages([toolMsg]);

    agent.runAgentCallback = () => {
      copilotKitCore.stopAgent({ agent: agent as any });
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    // Turn 2: User sends another message
    agent.runAgentCallback = undefined;
    const userMsg = {
      id: "msg-user-2",
      role: "user" as const,
      content: "Hello again",
    };
    agent.messages.push(userMsg);
    agent.setNewMessages([
      {
        id: "msg-assistant-2",
        role: "assistant" as const,
        content: "I am ready.",
      },
    ]);

    await copilotKitCore.runAgent({ agent: agent as any });

    // Verify all tool calls across all messages have corresponding tool messages
    const assistantToolCalls: string[] = [];
    const answeredToolCallIds = new Set<string>();

    for (const msg of agent.messages) {
      if (msg.role === "assistant" && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          assistantToolCalls.push(tc.id);
        }
      } else if (msg.role === "tool" && msg.toolCallId) {
        answeredToolCallIds.add(msg.toolCallId);
      }
    }

    expect(assistantToolCalls).toContain(toolCallId);
    for (const id of assistantToolCalls) {
      expect(answeredToolCallIds.has(id)).toBe(true);
    }
  });

  it("should answer unanswered tool call even if runAgent throws an error while aborted", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    copilotKitCore.addTool(createTool({ name: "fragile_tool" }));

    const message = createToolCallMessage("fragile_tool");
    const assistant = getAssistantMessage(message);
    const toolCallId = assistant.toolCalls![0]!.id;
    agent.messages.push(message);

    agent.runAgentCallback = () => {
      copilotKitCore.stopAgent({ agent: agent as any });
      throw new Error("Network connection aborted");
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    const toolResult = agent.messages.find(
      (m) => m.role === "tool" && m.toolCallId === toolCallId,
    );
    expect(toolResult).toBeDefined();
    expect(JSON.parse(toolResult!.content as string)).toMatchObject({
      status: "stopped",
      reason: "stop_requested",
    });
  });

  it("should preserve live human-in-the-loop tool unanswered on stop so reconnect can restore it", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const hitlTool = createTool({
      name: "approve_action",
      type: "human-in-the-loop",
      handler: vi.fn(async (_args: any, context: any) => {
        // Wait until aborted
        await new Promise((resolve) => {
          context.signal.addEventListener("abort", resolve);
        });
        return "approved";
      }),
    });
    copilotKitCore.addTool(hitlTool);

    const message = {
      id: "msg-assistant-hitl",
      role: "assistant" as const,
      content: "",
      toolCalls: [
        {
          id: "call-hitl-1",
          type: "function" as const,
          function: { name: "approve_action", arguments: "{}" },
        },
      ],
    };
    agent.setNewMessages([message]);

    // Simulate user pressing stop while HITL tool is waiting
    setTimeout(() => {
      copilotKitCore.stopAgent({ agent: agent as any });
    }, 10);

    await copilotKitCore.runAgent({ agent: agent as any });

    const hitlResult = agent.messages.find(
      (m) => m.role === "tool" && m.toolCallId === "call-hitl-1",
    );
    // Preserved for selective replay on reconnect, not prematurely closed
    expect(hitlResult).toBeUndefined();
  });

  it("should not insert stopped result or leak old message when thread switches during live HITL", async () => {
    const agent = new MockAgent({ agentId: "test", threadId: "thread-A" });
    (agent as any).detachActiveRun = async () => {};
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    let handlerSignal: AbortSignal | undefined;
    const hitlTool = createTool({
      name: "approve_transfer",
      type: "human-in-the-loop",
      handler: vi.fn(async (_args: any, context: any) => {
        handlerSignal = context.signal;
        await new Promise((resolve) => {
          context.signal.addEventListener("abort", resolve);
        });
        return "approved";
      }),
    });
    copilotKitCore.addTool(hitlTool);

    const message = createToolCallMessage("approve_transfer");
    agent.setNewMessages([message]);

    // Initial connection on thread-A
    await copilotKitCore.connectAgent({ agent: agent as any });

    // Start runAgent on thread-A in background
    const runPromise = copilotKitCore.runAgent({ agent: agent as any });

    // Wait until handler is entered and waiting
    await vi.waitFor(() => {
      expect(hitlTool.handler).toHaveBeenCalledOnce();
    });

    // Simulate switching to thread-B: update threadId and clear messages
    agent.threadId = "thread-B";
    agent.setMessages([]);
    agent.setNewMessages([]);

    // connectAgent with thread-B aborts live HITL controllers from thread-A
    await copilotKitCore.connectAgent({ agent: agent as any });

    await runPromise;

    expect(handlerSignal?.aborted).toBe(true);

    // Thread B's messages must NOT contain thread-A's message or stopped result
    expect(agent.messages).toHaveLength(0);
  });
});
