import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createToolCallMessage,
  createAssistantMessage,
  createTool,
} from "./test-utils";

describe("CopilotKitCore - abort during tool execution", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should NOT restart the run when stopAgent is called during tool execution", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const tool = createTool({
      name: "slowTool",
      handler: vi.fn(async () => {
        // Simulate: user clicks stop while this handler is running
        copilotKitCore.stopAgent({ agent: agent as any });
        return "Tool completed";
      }),
      followUp: true, // Would normally trigger a follow-up runAgent()
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("slowTool");
    agent.setNewMessages([message]);

    // On the second runAgent call (the follow-up), return a plain message
    let callCount = 0;
    agent.runAgentCallback = () => {
      callCount++;
      if (callCount === 2) {
        agent.setNewMessages([
          createAssistantMessage({ content: "Follow-up response" }),
        ]);
      }
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    // The tool handler ran
    expect(tool.handler).toHaveBeenCalledOnce();

    // But the follow-up runAgent() should NOT have been called
    // because stopAgent() was called during tool execution
    expect(agent.runAgentCalls).toHaveLength(1);
  });

  it("should pass an AbortSignal to the tool handler context", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    let receivedSignal: AbortSignal | undefined;
    const tool = createTool({
      name: "signalTool",
      handler: vi.fn(async (_args: any, context: any) => {
        receivedSignal = context.signal;
        return "done";
      }),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("signalTool");
    agent.setNewMessages([message]);

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal!.aborted).toBe(false);
  });

  it("should abort the signal when stopAgent is called during tool execution", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    let signalAbortedDuringHandler = false;
    const tool = createTool({
      name: "abortableTool",
      handler: vi.fn(async (_args: any, context: any) => {
        // Signal should not be aborted yet
        expect(context.signal.aborted).toBe(false);

        // Simulate: user clicks stop while handler is running
        copilotKitCore.stopAgent({ agent: agent as any });

        // Signal should now be aborted
        signalAbortedDuringHandler = context.signal.aborted;
        return "done";
      }),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("abortableTool");
    agent.setNewMessages([message]);

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(signalAbortedDuringHandler).toBe(true);
  });

  it("should NOT restart the run when agent.abortRun() is called directly during tool execution", async () => {
    const agent = new MockAgent({ agentId: "test" });
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const tool = createTool({
      name: "slowTool2",
      handler: vi.fn(async () => {
        // Simulate: user calls agent.abortRun() directly (not via stopAgent)
        agent.abortRun();
        return "Tool completed";
      }),
      followUp: true,
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("slowTool2");
    agent.setNewMessages([message]);

    let callCount = 0;
    agent.runAgentCallback = () => {
      callCount++;
      if (callCount === 2) {
        agent.setNewMessages([
          createAssistantMessage({ content: "Follow-up response" }),
        ]);
      }
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(tool.handler).toHaveBeenCalledOnce();
    // agent.abortRun() should also prevent the follow-up restart
    expect(agent.runAgentCalls).toHaveLength(1);
  });
});
