import type {
  AgentSubscriber,
  AssistantMessage,
  BaseEvent,
  Message,
  RunAgentInput,
  RunAgentResult,
} from "@ag-ui/client";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { EMPTY } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import {
  createAssistantMessage,
  createMessage,
  createTool,
  createToolCallMessage,
  createToolResultMessage,
  getToolMessage,
} from "./test-utils";

class SnapshotTruncatingAgent extends AbstractAgent {
  constructor({
    initialMessages,
    finalMessages,
    streamedMessages,
    returnedNewMessages = [],
    initialThreadId = "thread-1",
    finalThreadId,
  }: {
    initialMessages: Message[];
    finalMessages: Message[];
    streamedMessages: Message[];
    returnedNewMessages?: Message[];
    initialThreadId?: string | null;
    finalThreadId?: string;
  }) {
    super(
      initialThreadId === null
        ? {}
        : { threadId: initialThreadId ?? "thread-1" },
    );
    this.setMessages(initialMessages);
    if (initialThreadId === null) {
      this.threadId = undefined as unknown as string;
    }
    this.finalMessages = finalMessages;
    this.streamedMessages = streamedMessages;
    this.returnedNewMessages = returnedNewMessages;
    this.finalThreadId = finalThreadId;
  }

  private readonly finalMessages: Message[];
  private readonly streamedMessages: Message[];
  private readonly returnedNewMessages: Message[];
  private readonly finalThreadId: string | undefined;
  public readonly runAgentCalls: RunAgentInput[] = [];

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }

  override async runAgent(
    input: RunAgentInput,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    this.runAgentCalls.push(input);
    const threadId = this.threadId;
    await subscriber?.onRunStartedEvent?.({
      event: {
        type: EventType.RUN_STARTED,
        threadId: threadId ?? (undefined as unknown as string),
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
    if (this.finalThreadId) {
      this.threadId = this.finalThreadId;
    }
    this.setMessages(this.finalMessages);
    return { result: undefined, newMessages: this.returnedNewMessages };
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

    const agent = new SnapshotTruncatingAgent({
      initialMessages: [userMessage],
      finalMessages: [userMessage],
      streamedMessages: [userMessage, assistantMessage],
    });
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

  it("does not restore streamed messages after the agent switches threads", async () => {
    const copilotKitCore = new CopilotKitCore({});
    const userMessage = createMessage({
      id: "thread-a-user",
      content: "Create a report",
    });
    const oldThreadAssistantMessage = createToolCallMessage(
      "generateReport",
      { name: "safety" },
      { id: "thread-a-assistant" },
    ) as AssistantMessage;
    const newThreadMessage = createMessage({
      id: "thread-b-user",
      content: "Thread B message",
    });
    const agent = new SnapshotTruncatingAgent({
      initialMessages: [userMessage],
      finalMessages: [newThreadMessage],
      streamedMessages: [userMessage, oldThreadAssistantMessage],
      finalThreadId: "thread-2",
    });
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

    expect(tool.handler).not.toHaveBeenCalled();
    expect(result.newMessages).toEqual([]);
    expect(agent.messages.map((message) => message.id)).toEqual([
      newThreadMessage.id,
    ]);
  });

  it("preserves observed stream order when restoring omitted tool calls", async () => {
    const copilotKitCore = new CopilotKitCore({});
    const calls: string[] = [];
    const userMessage = createMessage({
      id: "user-1",
      content: "Run both tools",
    });
    const firstAssistantMessage = createToolCallMessage(
      "firstTool",
      {},
      { id: "assistant-1" },
    ) as AssistantMessage;
    const secondAssistantMessage = createToolCallMessage(
      "secondTool",
      {},
      { id: "assistant-2" },
    ) as AssistantMessage;
    const agent = new SnapshotTruncatingAgent({
      initialMessages: [userMessage],
      finalMessages: [userMessage, secondAssistantMessage],
      streamedMessages: [
        userMessage,
        firstAssistantMessage,
        secondAssistantMessage,
      ],
      returnedNewMessages: [secondAssistantMessage],
    });

    copilotKitCore.addTool(
      createTool({
        name: "firstTool",
        handler: vi.fn(async () => {
          calls.push("first");
          return "first-result";
        }),
        followUp: false,
      }),
    );
    copilotKitCore.addTool(
      createTool({
        name: "secondTool",
        handler: vi.fn(async () => {
          calls.push("second");
          return "second-result";
        }),
        followUp: false,
      }),
    );
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const result = await copilotKitCore.runAgent({ agent: agent as any });

    expect(result.newMessages.map((message) => message.id)).toEqual([
      firstAssistantMessage.id,
      secondAssistantMessage.id,
    ]);
    expect(calls).toEqual(["first", "second"]);
  });

  it("does not restore deliberately pruned plain text streamed messages", async () => {
    const copilotKitCore = new CopilotKitCore({});
    const userMessage = createMessage({
      id: "user-1",
      content: "Summarize the thread",
    });
    const streamedDraftMessage = createAssistantMessage({
      id: "assistant-draft",
      content: "Draft text that the backend pruned",
    });
    const summaryMessage = createAssistantMessage({
      id: "summary-1",
      content: "Final compacted summary",
    });
    const agent = new SnapshotTruncatingAgent({
      initialMessages: [userMessage],
      finalMessages: [userMessage, summaryMessage],
      streamedMessages: [userMessage, streamedDraftMessage],
      returnedNewMessages: [summaryMessage],
    });

    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as any,
    });

    const result = await copilotKitCore.runAgent({ agent: agent as any });

    expect(result.newMessages.map((message) => message.id)).toEqual([
      summaryMessage.id,
    ]);
    expect(agent.messages.map((message) => message.id)).toEqual([
      userMessage.id,
      summaryMessage.id,
    ]);
  });

  it("does not restore streamed frontend tool calls that already have final results", async () => {
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
    const finalToolResult = createToolResultMessage(
      toolCallId,
      "already-created",
      { id: "tool-result-1" },
    );
    const agent = new SnapshotTruncatingAgent({
      initialMessages: [userMessage],
      finalMessages: [userMessage, finalToolResult],
      streamedMessages: [userMessage, assistantMessage],
      returnedNewMessages: [finalToolResult],
    });
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

    expect(tool.handler).not.toHaveBeenCalled();
    expect(result.newMessages.map((message) => message.id)).toEqual([
      finalToolResult.id,
    ]);
    expect(agent.messages.map((message) => message.id)).toEqual([
      userMessage.id,
      finalToolResult.id,
    ]);
  });

  it("does not restore streamed messages when no thread identity exists", async () => {
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
    const agent = new SnapshotTruncatingAgent({
      initialMessages: [userMessage],
      finalMessages: [userMessage],
      streamedMessages: [userMessage, assistantMessage],
      initialThreadId: null,
    });
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

    expect(tool.handler).not.toHaveBeenCalled();
    expect(result.newMessages).toEqual([]);
    expect(agent.messages.map((message) => message.id)).toEqual([
      userMessage.id,
    ]);
  });
});
