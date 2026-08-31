import type { Message } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { createTool, createToolCallMessage, MockAgent } from "./test-utils";

class MockReplayAgent extends MockAgent {
  public connectAgentCalls: unknown[] = [];
  public detachActiveRun = vi.fn(async () => {});

  setMessages(messages: Message[]): void {
    this.messages = messages;
  }

  setState(state: Record<string, unknown>): void {
    this.state = state;
  }

  async connectAgent(input: unknown): Promise<{ newMessages: Message[] }> {
    this.connectAgentCalls.push(input);
    return {
      newMessages: [createToolCallMessage("replayedTool")],
    };
  }
}

describe("CopilotKitCore.connectAgent passive replay", () => {
  it("does not execute frontend tools or trigger follow-up runs for replayed assistant tool calls", async () => {
    const copilotKitCore = new CopilotKitCore({});
    const tool = createTool({
      name: "replayedTool",
      handler: vi.fn(async () => "replayed result"),
      followUp: true,
    });
    copilotKitCore.addTool(tool);
    const agent = new MockReplayAgent({
      agentId: "test",
      threadId: "thread-1",
    });

    const result = await copilotKitCore.connectAgent({
      agent: agent as never,
    });

    expect(result.newMessages).toHaveLength(1);
    expect(tool.handler).not.toHaveBeenCalled();
    expect(agent.connectAgentCalls).toHaveLength(1);
    expect(agent.runAgentCalls).toHaveLength(0);
  });

  it("continues to execute frontend tools during normal user runAgent calls", async () => {
    const copilotKitCore = new CopilotKitCore({});
    const tool = createTool({
      name: "replayedTool",
      handler: vi.fn(async () => "run result"),
      followUp: false,
    });
    copilotKitCore.addTool(tool);
    const agent = new MockReplayAgent({
      agentId: "test",
      newMessages: [createToolCallMessage("replayedTool")],
      threadId: "thread-1",
    });

    await copilotKitCore.runAgent({
      agent: agent as never,
    });

    expect(tool.handler).toHaveBeenCalledTimes(1);
    expect(agent.runAgentCalls).toHaveLength(1);
    expect(agent.connectAgentCalls).toHaveLength(0);
  });
});
