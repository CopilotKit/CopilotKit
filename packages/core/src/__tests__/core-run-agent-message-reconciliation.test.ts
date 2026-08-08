import type {
  AgentSubscriber,
  AssistantMessage,
  Message,
  RunAgentInput,
  RunAgentResult,
} from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createMessage,
  createTool,
  createToolCallMessage,
  getToolMessage,
} from "./test-utils";

class SnapshotTruncatingAgent extends MockAgent {
  constructor(
    private readonly finalMessages: Message[],
    private readonly streamedMessages: Message[],
  ) {
    super({ messages: finalMessages });
  }

  override async runAgent(
    input: RunAgentInput,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    this.runAgentCalls.push(input);
    await subscriber?.onRunStartedEvent?.({
      event: {
        type: EventType.RUN_STARTED,
        threadId: "thread-1",
        runId: "run-1",
      },
      messages: this.messages,
      state: this.state,
      agent: this as any,
      input: { ...input, runId: "run-1" },
    });
    await subscriber?.onMessagesChanged?.({
      messages: this.streamedMessages,
      state: this.state,
      agent: this as any,
    });
    this.setMessages(this.finalMessages);
    return { result: undefined, newMessages: [] };
  }
}

describe("CopilotKitCore.runAgent - message reconciliation", () => {
  it("preserves streamed assistant tool calls when a late snapshot omits them", async () => {
    const copilotKitCore = new CopilotKitCore({});
    const userMessage = createMessage({
      id: "user-1",
      content: "Create a report",
    });
    const assistantMessage = createToolCallMessage(
      "generateReport",
      { name: "safety" },
      { id: "assistant-1" },
    ) as AssistantMessage;
    const toolCallId = assistantMessage.toolCalls?.[0]?.id;
    if (!toolCallId) throw new Error("Expected tool call id");

    const agent = new SnapshotTruncatingAgent(
      [userMessage],
      [userMessage, assistantMessage],
    );
    const tool = createTool({
      name: "generateReport",
      handler: vi.fn(async () => "report-created"),
      followUp: false,
    });

    copilotKitCore.addTool(tool);
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const result = await copilotKitCore.runAgent({ agent: agent as any });

    expect(tool.handler).toHaveBeenCalledOnce();
    expect(result.newMessages.map((message) => message.id)).toEqual([
      assistantMessage.id,
    ]);
    expect(agent.messages.map((message) => message.id)).toContain(
      assistantMessage.id,
    );
    const toolMessage = getToolMessage(
      agent.messages.find((message) => message.role === "tool"),
    );
    expect(toolMessage.toolCallId).toBe(toolCallId);
    expect(toolMessage.content).toBe("report-created");
  });
});
