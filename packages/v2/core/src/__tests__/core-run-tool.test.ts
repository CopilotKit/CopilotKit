import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore, CopilotKitCoreErrorCode } from "../core";
import {
  MockAgent,
  createTool,
} from "./test-utils";

describe("CopilotKitCore.runTool", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should execute tool handler with correct args and return result", async () => {
    const handler = vi.fn(async (args: any) => `Result: ${args.key}`);
    const tool = createTool({
      name: "TestTool",
      handler,
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    const result = await copilotKitCore.runTool({
      name: "TestTool",
      parameters: { key: "value" },
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      { key: "value" },
      expect.objectContaining({
        toolCall: expect.objectContaining({
          function: expect.objectContaining({ name: "TestTool" }),
        }),
        agent: expect.anything(),
      }),
    );
    expect(result.result).toBe("Result: value");
    expect(result.error).toBeUndefined();
    expect(result.toolCallId).toBeDefined();
  });

  it("should add assistant and tool messages to agent.messages", async () => {
    const tool = createTool({
      name: "MsgTool",
      handler: vi.fn(async () => "tool-result"),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    const result = await copilotKitCore.runTool({
      name: "MsgTool",
      parameters: { foo: "bar" },
    });

    // Should have 2 messages: assistant + tool
    expect(agent.messages).toHaveLength(2);

    const assistantMsg = agent.messages[0];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.toolCalls).toHaveLength(1);
    expect(assistantMsg.toolCalls![0].function.name).toBe("MsgTool");
    expect(JSON.parse(assistantMsg.toolCalls![0].function.arguments)).toEqual({
      foo: "bar",
    });

    const toolMsg = agent.messages[1];
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.toolCallId).toBe(result.toolCallId);
    expect(toolMsg.content).toBe("tool-result");
  });

  it("should throw TOOL_NOT_FOUND when tool does not exist", async () => {
    const agent = new MockAgent({ agentId: "default" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    const onError = vi.fn();
    copilotKitCore.subscribe({ onError });

    await expect(
      copilotKitCore.runTool({
        name: "NonExistent",
      }),
    ).rejects.toThrow("Tool not found: NonExistent");

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: CopilotKitCoreErrorCode.TOOL_NOT_FOUND,
      }),
    );
  });

  it("should throw AGENT_NOT_FOUND when agent does not exist", async () => {
    const tool = createTool({ name: "SomeTool", followUp: false });
    copilotKitCore.addTool(tool);

    const onError = vi.fn();
    copilotKitCore.subscribe({ onError });

    await expect(
      copilotKitCore.runTool({
        name: "SomeTool",
        agentId: "nonexistent-agent",
      }),
    ).rejects.toThrow("Agent not found: nonexistent-agent");

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: CopilotKitCoreErrorCode.AGENT_NOT_FOUND,
      }),
    );
  });

  it("should not trigger agent run when followUp is false (default)", async () => {
    const tool = createTool({
      name: "NoFollowUp",
      handler: vi.fn(async () => "done"),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    await copilotKitCore.runTool({ name: "NoFollowUp" });

    // runAgent should NOT have been called
    expect(agent.runAgentCalls).toHaveLength(0);
  });

  it("should trigger agent run when followUp is 'generate'", async () => {
    const tool = createTool({
      name: "FollowUpTool",
      handler: vi.fn(async () => "done"),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default", newMessages: [] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    await copilotKitCore.runTool({
      name: "FollowUpTool",
      followUp: "generate",
    });

    // runAgent should have been called once
    expect(agent.runAgentCalls).toHaveLength(1);
  });

  it("should add user message and trigger agent run when followUp is custom text", async () => {
    const tool = createTool({
      name: "CustomFollowUp",
      handler: vi.fn(async () => "done"),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default", newMessages: [] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    await copilotKitCore.runTool({
      name: "CustomFollowUp",
      followUp: "Please summarize the result",
    });

    // Should have 3 messages: assistant + tool + user
    const userMessages = agent.messages.filter((m) => m.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe("Please summarize the result");

    // runAgent should have been called once
    expect(agent.runAgentCalls).toHaveLength(1);
  });

  it("should capture handler errors and return them in result", async () => {
    const tool = createTool({
      name: "ErrorTool",
      handler: vi.fn(async () => {
        throw new Error("Handler exploded");
      }),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    const result = await copilotKitCore.runTool({ name: "ErrorTool" });

    expect(result.error).toBe("Handler exploded");
    expect(result.result).toBe("Error: Handler exploded");
  });

  it("should not trigger follow-up on handler error even if followUp is set", async () => {
    const tool = createTool({
      name: "ErrorNoFollowUp",
      handler: vi.fn(async () => {
        throw new Error("fail");
      }),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default", newMessages: [] });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    await copilotKitCore.runTool({
      name: "ErrorNoFollowUp",
      followUp: "generate",
    });

    // Should NOT have triggered runAgent because handler errored
    expect(agent.runAgentCalls).toHaveLength(0);
  });

  it("should handle render-only tools (no handler) with empty result", async () => {
    const tool = createTool({
      name: "RenderOnly",
      handler: undefined,
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    const result = await copilotKitCore.runTool({ name: "RenderOnly" });

    expect(result.result).toBe("");
    expect(result.error).toBeUndefined();

    // Messages should still be created
    expect(agent.messages).toHaveLength(2);
    expect(agent.messages[0].role).toBe("assistant");
    expect(agent.messages[1].role).toBe("tool");
  });

  it("should fire onToolExecutionStart and onToolExecutionEnd events", async () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    copilotKitCore.subscribe({
      onToolExecutionStart: onStart,
      onToolExecutionEnd: onEnd,
    });

    const tool = createTool({
      name: "EventTool",
      handler: vi.fn(async () => "result"),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    await copilotKitCore.runTool({
      name: "EventTool",
      parameters: { x: 1 },
    });

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "EventTool",
        agentId: "default",
        args: { x: 1 },
      }),
    );

    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "EventTool",
        agentId: "default",
        result: "result",
      }),
    );
  });

  it("should look up agent-scoped tool when agentId is provided", async () => {
    const globalHandler = vi.fn(async () => "global");
    const agentHandler = vi.fn(async () => "agent-specific");

    copilotKitCore.addTool(
      createTool({
        name: "ScopedTool",
        handler: globalHandler,
        followUp: false,
      }),
    );
    copilotKitCore.addTool(
      createTool({
        name: "ScopedTool",
        handler: agentHandler,
        agentId: "my-agent",
        followUp: false,
      }),
    );

    const agent = new MockAgent({ agentId: "my-agent" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "my-agent",
      agent: agent as any,
    });

    const result = await copilotKitCore.runTool({
      name: "ScopedTool",
      agentId: "my-agent",
    });

    expect(agentHandler).toHaveBeenCalledOnce();
    expect(globalHandler).not.toHaveBeenCalled();
    expect(result.result).toBe("agent-specific");
  });

  it("should use default agent when agentId is omitted", async () => {
    const tool = createTool({
      name: "DefaultAgent",
      handler: vi.fn(async () => "ok"),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    const result = await copilotKitCore.runTool({ name: "DefaultAgent" });

    expect(result.result).toBe("ok");
    // Messages should be on the default agent
    expect(agent.messages).toHaveLength(2);
  });

  it("should handle object results by JSON stringifying them", async () => {
    const tool = createTool({
      name: "ObjectResult",
      handler: vi.fn(async () => ({ data: [1, 2, 3] })),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    const result = await copilotKitCore.runTool({ name: "ObjectResult" });

    expect(result.result).toBe('{"data":[1,2,3]}');
  });

  it("should handle null/undefined results as empty string", async () => {
    const tool = createTool({
      name: "NullResult",
      handler: vi.fn(async () => null),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    const result = await copilotKitCore.runTool({ name: "NullResult" });

    expect(result.result).toBe("");
  });

  it("should default parameters to empty object when omitted", async () => {
    const handler = vi.fn(async () => "done");
    const tool = createTool({
      name: "NoParams",
      handler,
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const agent = new MockAgent({ agentId: "default" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "default",
      agent: agent as any,
    });

    await copilotKitCore.runTool({ name: "NoParams" });

    // Handler should receive empty object
    expect(handler).toHaveBeenCalledWith(
      {},
      expect.anything(),
    );

    // Assistant message should have empty args
    const assistantMsg = agent.messages[0];
    expect(JSON.parse(assistantMsg.toolCalls![0].function.arguments)).toEqual(
      {},
    );
  });
});
