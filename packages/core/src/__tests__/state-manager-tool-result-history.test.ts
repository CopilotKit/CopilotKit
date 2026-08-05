import { describe, expect, it } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  AgentSubscriber,
  BaseEvent,
  Message,
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
} from "@ag-ui/client";
import { from, lastValueFrom, throwError } from "rxjs";
import type { Observable } from "rxjs";
import { ProxiedCopilotRuntimeAgent } from "../agent";
import { CopilotKitCore } from "../core";

const threadId = "thread-weather";
const toolCallId = "call_weather";

class ScriptedWeatherAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];
  secondTurnError?: string;

  constructor(private readonly includeSnapshot = true) {
    super({
      agentId: "weather",
      threadId,
      initialMessages: [
        { id: "user-1", role: "user", content: "What is the weather?" },
      ],
    });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);

    if (this.inputs.length === 2) {
      const hasToolResult = input.messages.some(
        (message: Message) =>
          message.role === "tool" && message.toolCallId === toolCallId,
      );
      if (!hasToolResult) {
        this.secondTurnError =
          "400 Bad Request: missing tool result for call_weather";
        return throwError(() => new Error(this.secondTurnError));
      }
      return from([
        {
          type: EventType.RUN_STARTED,
          threadId,
          runId: input.runId,
        },
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId: input.runId,
        },
      ] as BaseEvent[]);
    }

    const assistantToolCall: Message = {
      id: "assistant-weather",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: toolCallId,
          type: "function",
          function: { name: "get_weather", arguments: "{}" },
        },
      ],
    };

    const events: BaseEvent[] = [
      { type: EventType.RUN_STARTED, threadId, runId: input.runId },
      {
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName: "get_weather",
        parentMessageId: assistantToolCall.id,
      },
      { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: "{}" },
      { type: EventType.TOOL_CALL_END, toolCallId },
      {
        type: EventType.TOOL_CALL_RESULT,
        messageId: "event-tool-result",
        toolCallId,
        content: "72 degrees and sunny",
        role: "tool",
      },
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "assistant-weather-text",
        role: "assistant",
      },
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "assistant-weather-text",
        delta: "It is sunny.",
      },
      {
        type: EventType.TEXT_MESSAGE_END,
        messageId: "assistant-weather-text",
      },
    ];

    if (this.includeSnapshot) {
      events.push({
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [
          { id: "user-1", role: "user", content: "What is the weather?" },
          assistantToolCall,
          {
            id: "assistant-weather-text",
            role: "assistant",
            content: "It is sunny.",
          },
        ],
      });
    }

    events.push({ type: EventType.RUN_FINISHED, threadId, runId: input.runId });
    return from(events);
  }
}

class StreamedResultAgent extends AbstractAgent {
  readonly inputs: RunAgentInput[] = [];

  constructor() {
    super({
      agentId: "streamed",
      threadId: "thread-streamed",
      initialMessages: [
        { id: "stream-user", role: "user", content: "request" },
      ],
    });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);
    if (this.inputs.length > 1) {
      return from([
        {
          type: EventType.RUN_STARTED,
          threadId: this.threadId,
          runId: input.runId,
        },
        {
          type: EventType.RUN_FINISHED,
          threadId: this.threadId,
          runId: input.runId,
        },
      ] as BaseEvent[]);
    }

    const assistantToolCall: Message = {
      id: "stream-assistant",
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "stream-call",
          type: "function",
          function: { name: "stream_tool", arguments: "{}" },
        },
      ],
    };
    const result = {
      type: EventType.TOOL_CALL_RESULT,
      messageId: "stream-result",
      toolCallId: "stream-call",
      content: "stream-result",
      role: "tool" as const,
    };

    return from([
      {
        type: EventType.RUN_STARTED,
        threadId: this.threadId,
        runId: input.runId,
      },
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: "stream-call",
        toolCallName: "stream_tool",
        parentMessageId: assistantToolCall.id,
      },
      { type: EventType.TOOL_CALL_END, toolCallId: "stream-call" },
      result,
      { ...result, messageId: "stream-result-duplicate" },
      {
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [
          { id: "stream-user", role: "user", content: "request" },
          assistantToolCall,
        ],
      },
    ] as BaseEvent[]);
  }
}

class ResultEventAgent extends AbstractAgent {
  private testSubscribers: any[] = [];
  private allSubscribers: any[] = [];
  private currentInputs = new Map<string, RunAgentInput>();

  constructor(
    agentId: string,
    agentThreadId: string,
    initialMessages: Message[] = [],
  ) {
    super({ agentId, threadId: agentThreadId, initialMessages });
  }

  run(_input: RunAgentInput): Observable<BaseEvent> {
    return from([]);
  }

  override subscribe(subscriber: any) {
    this.testSubscribers.push(subscriber);
    this.allSubscribers.push(subscriber);
    const subscription = super.subscribe(subscriber);
    return {
      unsubscribe: () => {
        subscription.unsubscribe();
        this.testSubscribers = this.testSubscribers.filter(
          (item) => item !== subscriber,
        );
      },
    };
  }

  private input(runId: string): RunAgentInput {
    const existing = this.currentInputs.get(runId);
    if (existing) return existing;

    const input = {
      threadId: this.threadId,
      runId,
      messages: [...this.messages],
      state: this.state,
      tools: [],
      context: [],
      forwardedProps: {},
    };
    this.currentInputs.set(runId, input);
    return input;
  }

  private startInput(runId: string): RunAgentInput {
    const input = {
      threadId: this.threadId,
      runId,
      messages: [...this.messages],
      state: this.state,
      tools: [],
      context: [],
      forwardedProps: {},
    };
    this.currentInputs.set(runId, input);
    return input;
  }

  private async dispatch(
    subscribers: any[],
    key: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    for (const subscriber of subscribers) {
      await subscriber[key]?.(params);
    }
  }

  async emitRunStarted(runId: string): Promise<void> {
    await this.dispatch(this.testSubscribers, "onRunStartedEvent", {
      event: { type: EventType.RUN_STARTED, threadId: this.threadId, runId },
      messages: this.messages,
      state: this.state,
      agent: this,
      input: this.startInput(runId),
    });
  }

  async emitResult(
    runId: string,
    resultToolCallId: string,
    messageId = `${resultToolCallId}-result`,
    content = `result-${resultToolCallId}`,
  ): Promise<void> {
    await this.dispatch(this.testSubscribers, "onToolCallResultEvent", {
      event: {
        type: EventType.TOOL_CALL_RESULT,
        messageId,
        toolCallId: resultToolCallId,
        content,
      },
      messages: this.messages,
      state: this.state,
      agent: this,
      input: this.input(runId),
    });
  }

  async emitRunFinished(runId: string): Promise<void> {
    await this.dispatch(this.testSubscribers, "onRunFinishedEvent", {
      event: { type: EventType.RUN_FINISHED, threadId: this.threadId, runId },
      messages: this.messages,
      state: this.state,
      agent: this,
      input: this.input(runId),
    });
  }

  async emitMessagesSnapshot(
    runId: string,
    messages: Message[],
  ): Promise<void> {
    this.setMessages(messages);
    await this.dispatch(this.testSubscribers, "onMessagesSnapshotEvent", {
      event: {
        type: EventType.MESSAGES_SNAPSHOT,
        messages,
      },
      messages: this.messages,
      state: this.state,
      agent: this,
      input: this.input(runId),
    });
  }

  async emitRunError(runId: string): Promise<void> {
    await this.dispatch(this.testSubscribers, "onRunErrorEvent", {
      event: {
        type: EventType.RUN_ERROR,
        threadId: this.threadId,
        runId,
        message: "backend failed",
        code: "backend_error",
      },
      messages: this.messages,
      state: this.state,
      agent: this,
      input: this.input(runId),
    });
  }

  async emitRunFailed(runId: string): Promise<void> {
    await this.dispatch(this.testSubscribers, "onRunFailed", {
      error: new Error("aborted"),
      messages: this.messages,
      state: this.state,
      agent: this,
      input: this.input(runId),
    });
  }

  async emitRunFinalized(runId: string): Promise<void> {
    await this.dispatch(this.testSubscribers, "onRunFinalized", {
      messages: this.messages,
      state: this.state,
      agent: this,
      input: this.input(runId),
    });
  }

  async emitLateResult(runId: string, resultToolCallId: string): Promise<void> {
    await this.dispatch(this.allSubscribers, "onToolCallResultEvent", {
      event: {
        type: EventType.TOOL_CALL_RESULT,
        messageId: `${resultToolCallId}-late-result`,
        toolCallId: resultToolCallId,
        content: "late result",
      },
      messages: this.messages,
      state: this.state,
      agent: this,
      input: this.input(runId),
    });
  }

  async emitInputlessMessage(message: Message): Promise<void> {
    await this.dispatch(this.testSubscribers, "onNewMessage", {
      message,
      agent: this,
    });
  }
}

class ConnectingResultEventAgent extends ResultEventAgent {
  constructor(
    agentId: string,
    agentThreadId: string,
    private readonly connectRunId: string,
    private readonly connectToolCallId: string,
    private readonly connectResultId: string,
  ) {
    super(agentId, agentThreadId);
  }

  override async connectAgent(
    _parameters?: RunAgentParameters,
    _subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    this.messages.push({
      id: `assistant-${this.connectToolCallId}`,
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: this.connectToolCallId,
          type: "function",
          function: { name: "connect", arguments: "{}" },
        },
      ],
    });
    await this.emitRunStarted(this.connectRunId);
    await this.emitResult(
      this.connectRunId,
      this.connectToolCallId,
      this.connectResultId,
    );
    await this.emitRunFinished(this.connectRunId);
    return { result: undefined, newMessages: [] };
  }
}

describe("StateManager tool result history", () => {
  it("recovers one result through the real event stream before finalization", async () => {
    const agent = new StreamedResultAgent();
    const messageSnapshots: Message[][] = [];
    agent.subscribe({
      onMessagesChanged: ({ messages }) => {
        messageSnapshots.push([...messages]);
      },
    });
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "streamed", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await core.runAgent({ agent });

    const recoveredResults = agent.messages.filter(
      (message) =>
        message.role === "tool" && message.toolCallId === "stream-call",
    );
    expect(recoveredResults).toHaveLength(1);
    expect(recoveredResults[0]).toEqual(
      expect.objectContaining({
        id: "stream-result-duplicate",
        content: "stream-result",
      }),
    );
    expect(
      messageSnapshots.some((messages) =>
        messages.some(
          (message) =>
            message.role === "tool" && message.toolCallId === "stream-call",
        ),
      ),
    ).toBe(true);

    agent.addMessage({
      id: "stream-user-2",
      role: "user",
      content: "follow-up",
    });
    await expect(core.runAgent({ agent })).resolves.toBeDefined();
    expect(
      agent.inputs[1]?.messages.filter(
        (message: Message) =>
          message.role === "tool" && message.toolCallId === "stream-call",
      ),
    ).toHaveLength(1);
  });

  it("preserves a server tool result in the second-turn input", async () => {
    const agent = new ScriptedWeatherAgent();
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "weather", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await core.runAgent({ agent });
    agent.addMessage({
      id: "user-2",
      role: "user",
      content: "Should I bring an umbrella?",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(core.runAgent({ agent })).resolves.toBeDefined();
    expect(agent.secondTurnError).toBeUndefined();

    const secondTurnMessages = agent.inputs[1]?.messages ?? [];
    expect(secondTurnMessages.map((message: Message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
    expect(
      secondTurnMessages.filter(
        (message: Message) =>
          message.role === "tool" && message.toolCallId === toolCallId,
      ),
    ).toHaveLength(1);
  });

  it("keeps the reported 400 base fault deterministic", async () => {
    const agent = new ScriptedWeatherAgent(false);
    const input: RunAgentInput = {
      threadId,
      runId: "run-base",
      messages: [],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    };

    agent.run(input);
    await expect(
      lastValueFrom(agent.run({ ...input, runId: "run-base-2" })),
    ).rejects.toThrow("400 Bad Request: missing tool result for call_weather");
    expect(agent.secondTurnError).toBe(
      "400 Bad Request: missing tool result for call_weather",
    );
  });

  it("leaves a live result already applied by @ag-ui/client unchanged", async () => {
    const agent = new ScriptedWeatherAgent(false);
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "weather", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await core.runAgent({ agent });

    expect(
      agent.messages.filter(
        (message) =>
          message.role === "tool" && message.toolCallId === toolCallId,
      ),
    ).toHaveLength(1);
  });

  it("recovers duplicate and parallel results in owner order", async () => {
    const agent = new ResultEventAgent("parallel", "thread-parallel", [
      {
        id: "assistant-parallel",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-a",
            type: "function",
            function: { name: "a", arguments: "{}" },
          },
          {
            id: "call-b",
            type: "function",
            function: { name: "b", arguments: "{}" },
          },
        ],
      },
    ]);
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "parallel", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await agent.emitRunStarted("run-parallel");
    await agent.emitResult("run-parallel", "call-b");
    await agent.emitResult("run-parallel", "call-a");
    await agent.emitResult("run-parallel", "call-a", "duplicate-result");
    await agent.emitRunFinished("run-parallel");

    expect(
      agent.messages
        .filter((message) => message.role === "tool")
        .map((message) => message.toolCallId),
    ).toEqual(["call-b", "call-a"]);
    expect(
      agent.messages.filter((message) => message.role === "tool"),
    ).toHaveLength(2);
  });

  it("preserves an existing real result with a different message ID", async () => {
    const existing = {
      id: "real-result-id",
      role: "tool" as const,
      toolCallId: "call-real",
      content: "opaque provider payload",
    };
    const agent = new ResultEventAgent("existing", "thread-existing", [
      {
        id: "assistant-existing",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-real",
            type: "function",
            function: { name: "real", arguments: "{}" },
          },
        ],
      },
      existing,
    ]);
    const existingInHistory = agent.messages[1];
    const before = [...agent.messages];
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "existing", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await agent.emitRunStarted("run-existing");
    await agent.emitResult(
      "run-existing",
      "call-real",
      "event-result",
      "different",
    );
    await agent.emitRunFinished("run-existing");

    expect(agent.messages).toEqual(before);
    expect(agent.messages[1]).toBe(existingInHistory);
  });

  it("replaces a frontend placeholder with the canonical result event", async () => {
    const agent = new ResultEventAgent("placeholder", "thread-placeholder", [
      {
        id: "assistant-placeholder",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-placeholder",
            type: "function",
            function: { name: "placeholder", arguments: "{}" },
          },
        ],
      },
      {
        id: "placeholder-result",
        role: "tool",
        toolCallId: "call-placeholder",
        content: "Forwarded to client",
      },
    ]);
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "placeholder", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await agent.emitRunStarted("run-placeholder");
    await agent.emitResult(
      "run-placeholder",
      "call-placeholder",
      "canonical-placeholder-result",
      "canonical result",
    );

    expect(agent.messages).toEqual([
      expect.objectContaining({ id: "assistant-placeholder" }),
      expect.objectContaining({
        id: "canonical-placeholder-result",
        role: "tool",
        toolCallId: "call-placeholder",
        content: "canonical result",
      }),
    ]);
  });

  it("restores a canonical result after a stale messages snapshot", async () => {
    const assistant = {
      id: "assistant-snapshot-placeholder",
      role: "assistant" as const,
      content: "",
      toolCalls: [
        {
          id: "call-snapshot-placeholder",
          type: "function" as const,
          function: { name: "snapshot-placeholder", arguments: "{}" },
        },
      ],
    };
    const placeholder = {
      id: "snapshot-placeholder-result",
      role: "tool" as const,
      toolCallId: "call-snapshot-placeholder",
      content: "Forwarded to client",
    };
    const agent = new ResultEventAgent(
      "snapshot-placeholder",
      "thread-snapshot-placeholder",
      [assistant, placeholder],
    );
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "snapshot-placeholder", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await agent.emitRunStarted("run-snapshot-placeholder");
    await agent.emitResult(
      "run-snapshot-placeholder",
      "call-snapshot-placeholder",
      "canonical-snapshot-placeholder",
      "canonical snapshot result",
    );
    await agent.emitMessagesSnapshot("run-snapshot-placeholder", [
      assistant,
      placeholder,
      {
        id: "canonical-snapshot-placeholder",
        role: "tool",
        toolCallId: "call-snapshot-placeholder",
        content: "canonical snapshot result",
      },
    ]);
    await agent.emitRunFinished("run-snapshot-placeholder");

    expect(agent.messages).toEqual([
      assistant,
      expect.objectContaining({
        id: "canonical-snapshot-placeholder",
        role: "tool",
        toolCallId: "call-snapshot-placeholder",
        content: "canonical snapshot result",
      }),
    ]);
  });

  it("deduplicates a placeholder before an existing result event", async () => {
    const assistant = {
      id: "assistant-direct-duplicate",
      role: "assistant" as const,
      content: "",
      toolCalls: [
        {
          id: "call-direct-duplicate",
          type: "function" as const,
          function: { name: "direct-duplicate", arguments: "{}" },
        },
      ],
    };
    const agent = new ResultEventAgent(
      "direct-duplicate",
      "thread-direct-duplicate",
      [
        assistant,
        {
          id: "direct-placeholder",
          role: "tool",
          toolCallId: "call-direct-duplicate",
          content: "Forwarded to client",
        },
        {
          id: "direct-existing",
          role: "tool",
          toolCallId: "call-direct-duplicate",
          content: "existing canonical result",
        },
      ] as Message[],
    );
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "direct-duplicate", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await agent.emitRunStarted("run-direct-duplicate");
    await agent.emitResult(
      "run-direct-duplicate",
      "call-direct-duplicate",
      "event-direct-duplicate",
      "event canonical result",
    );

    expect(
      agent.messages.filter(
        (message) =>
          message.role === "tool" &&
          message.toolCallId === "call-direct-duplicate",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "direct-existing",
        content: "existing canonical result",
      }),
    ]);
  });

  it("normalizes structured frontend placeholders before replacing them", async () => {
    const agent = new ResultEventAgent(
      "structured-placeholder",
      "thread-structured",
      [
        {
          id: "assistant-structured",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-structured",
              type: "function",
              function: { name: "structured", arguments: "{}" },
            },
          ],
        },
        {
          id: "structured-result",
          role: "tool",
          toolCallId: "call-structured",
          content: [{ type: "text", text: "  Forwarded to client  " }],
        } as any,
      ],
    );
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "structured-placeholder", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await agent.emitRunStarted("run-structured");
    await agent.emitResult(
      "run-structured",
      "call-structured",
      "canonical-structured-result",
      "canonical structured result",
    );

    expect(agent.messages).toEqual([
      expect.objectContaining({ id: "assistant-structured" }),
      expect.objectContaining({
        id: "canonical-structured-result",
        role: "tool",
        toolCallId: "call-structured",
        content: "canonical structured result",
      }),
    ]);
  });

  it("does not replace an ownerless placeholder", async () => {
    const placeholder = {
      id: "ownerless-result",
      role: "tool" as const,
      toolCallId: "call-ownerless",
      content: " Forwarded to client ",
    };
    const agent = new ResultEventAgent(
      "ownerless-placeholder",
      "thread-ownerless",
      [placeholder],
    );
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "ownerless-placeholder", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await agent.emitRunStarted("run-ownerless");
    await agent.emitResult(
      "run-ownerless",
      "call-ownerless",
      "canonical-ownerless-result",
      "canonical ownerless result",
    );

    expect(agent.messages).toEqual([placeholder]);
  });

  it("associates recovered results for finish and error settlement", async () => {
    const finishAgent = new ResultEventAgent("finish", "thread-finish", [
      {
        id: "assistant-finish",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-finish",
            type: "function",
            function: { name: "finish", arguments: "{}" },
          },
        ],
      },
    ]);
    const errorAgent = new ResultEventAgent("error", "thread-error", [
      {
        id: "assistant-error",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-error",
            type: "function",
            function: { name: "error", arguments: "{}" },
          },
        ],
      },
    ]);
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "finish", agent: finishAgent });
    core.addAgent__unsafe_dev_only({ id: "error", agent: errorAgent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await finishAgent.emitRunStarted("run-finish");
    await finishAgent.emitResult("run-finish", "call-finish");
    await finishAgent.emitRunFinished("run-finish");
    await errorAgent.emitRunStarted("run-error");
    await errorAgent.emitResult("run-error", "call-error");
    await errorAgent.emitRunError("run-error");

    expect(
      core.getRunIdForMessage("finish", "thread-finish", "call-finish-result"),
    ).toBe("run-finish");
    expect(
      core.getRunIdForMessage("error", "thread-error", "call-error-result"),
    ).toBe("run-error");
  });

  it("ignores result events after a run has settled", async () => {
    const agent = new ResultEventAgent("settled", "thread-settled", [
      {
        id: "assistant-settled",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-settled",
            type: "function",
            function: { name: "settled", arguments: "{}" },
          },
        ],
      },
    ]);
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "settled", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await agent.emitRunStarted("run-settled");
    await agent.emitResult("run-settled", "call-settled");
    await agent.emitRunFinished("run-settled");
    const settledMessages = [...agent.messages];
    await agent.emitLateResult("run-settled", "call-settled");

    expect(agent.messages).toEqual(settledMessages);
  });

  it("clears failed runs and recovers before finalization cleanup", async () => {
    const agent = new ResultEventAgent("aborted", "thread-aborted", [
      {
        id: "assistant-aborted",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-aborted",
            type: "function",
            function: { name: "aborted", arguments: "{}" },
          },
        ],
      },
    ]);
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "aborted", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await agent.emitRunStarted("run-aborted");
    await agent.emitResult("run-aborted", "call-aborted");
    await agent.emitRunFailed("run-aborted");
    agent.addMessage({
      id: "message-after-abort",
      role: "user",
      content: "after abort",
    });
    expect(
      core.getRunIdForMessage(
        "aborted",
        "thread-aborted",
        "message-after-abort",
      ),
    ).toBeUndefined();

    await agent.emitRunStarted("run-finalized");
    await agent.emitResult("run-finalized", "call-aborted");
    await agent.emitRunFinalized("run-finalized");
    agent.addMessage({
      id: "message-after-finalized",
      role: "user",
      content: "after finalized",
    });
    expect(
      core.getRunIdForMessage(
        "aborted",
        "thread-aborted",
        "message-after-finalized",
      ),
    ).toBeUndefined();

    expect(agent.messages).toEqual([
      expect.objectContaining({ id: "assistant-aborted" }),
      expect.objectContaining({
        id: "call-aborted-result",
        role: "tool",
        toolCallId: "call-aborted",
      }),
      expect.objectContaining({ id: "message-after-abort" }),
      expect.objectContaining({ id: "message-after-finalized" }),
    ]);
  });

  it("associates proxy recovery with local IDs across shared runtime delegates", async () => {
    const delegateA = new ConnectingResultEventAgent(
      "delegate-a",
      "thread-connect",
      "run-connect-a",
      "call-connect-a",
      "result-connect-a",
    );
    const delegateB = new ConnectingResultEventAgent(
      "delegate-b",
      "thread-connect",
      "run-connect-b",
      "call-connect-b",
      "result-connect-b",
    );
    const proxyA = new ProxiedCopilotRuntimeAgent({
      agentId: "local-connect-a",
      runtimeAgentId: "shared-runtime",
      runtimeUrl: "https://runtime.example",
      runtimeMode: "intelligence",
    });
    const proxyB = new ProxiedCopilotRuntimeAgent({
      agentId: "local-connect-b",
      runtimeAgentId: "shared-runtime",
      runtimeUrl: "https://runtime.example",
      runtimeMode: "intelligence",
    });
    proxyA.threadId = "thread-connect";
    proxyB.threadId = "thread-connect";
    (proxyA as any).delegate = delegateA;
    (proxyB as any).delegate = delegateB;

    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "local-connect-a", agent: proxyA });
    core.addAgent__unsafe_dev_only({ id: "local-connect-b", agent: proxyB });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await proxyA.connectAgent({});
    await proxyB.connectAgent({});

    expect(proxyA.messages.map((message) => message.role)).toEqual([
      "assistant",
      "tool",
    ]);
    expect(proxyB.messages.map((message) => message.role)).toEqual([
      "assistant",
      "tool",
    ]);
    expect(proxyA.messages[1]).toEqual(
      expect.objectContaining({ toolCallId: "call-connect-a" }),
    );
    expect(proxyB.messages[1]).toEqual(
      expect.objectContaining({ toolCallId: "call-connect-b" }),
    );
    expect(
      core.getRunIdForMessage(
        "local-connect-a",
        "thread-connect",
        "result-connect-a",
      ),
    ).toBe("run-connect-a");
    expect(
      core.getRunIdForMessage(
        "local-connect-b",
        "thread-connect",
        "result-connect-b",
      ),
    ).toBe("run-connect-b");
    expect(
      core.getRunIdForMessage(
        "shared-runtime",
        "thread-connect",
        "result-connect-a",
      ),
    ).toBeUndefined();
    expect(
      core.getRunIdForMessage(
        "shared-runtime",
        "thread-connect",
        "result-connect-b",
      ),
    ).toBeUndefined();
    expect(delegateA.agentId).toBe("shared-runtime");
    expect(delegateB.agentId).toBe("shared-runtime");
    expect(proxyA.agentId).toBe("local-connect-a");
    expect(proxyB.agentId).toBe("local-connect-b");
  });

  it("does not create ownerless results or recover after revocation", async () => {
    const agent = new ResultEventAgent("boundary", "thread-boundary", []);
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "boundary", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await agent.emitRunStarted("run-missing-owner");
    await agent.emitResult("run-missing-owner", "missing-owner");
    await agent.emitRunFinished("run-missing-owner");
    expect(agent.messages).toEqual([]);
    expect(
      core.getRunIdForMessage(
        "boundary",
        "thread-boundary",
        "missing-owner-result",
      ),
    ).toBeUndefined();

    const owner = {
      id: "assistant-revoked",
      role: "assistant" as const,
      content: "",
      toolCalls: [
        {
          id: "call-revoked",
          type: "function" as const,
          function: { name: "revoked", arguments: "{}" },
        },
      ],
    };
    agent.messages.push(owner);
    core.removeAgent__unsafe_dev_only("boundary");
    await agent.emitLateResult("run-revoked", "call-revoked");

    expect(agent.messages).toEqual([owner]);
  });

  it("does not let an older terminal event clear a newer active run", async () => {
    const agent = new ResultEventAgent("active", "thread-active", []);
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "active", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await agent.emitRunStarted("run-a");
    await agent.emitRunStarted("run-b");
    await agent.emitRunFinished("run-a");
    agent.addMessage({
      id: "message-after-run-a",
      role: "user",
      content: "still on run b",
    });

    expect(
      core.getRunIdForMessage("active", "thread-active", "message-after-run-a"),
    ).toBe("run-b");
  });

  it("clears active-run fallback state before an agent ID is re-added", async () => {
    const agent = new ResultEventAgent("readd", "thread-readd", []);
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "readd", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await agent.emitRunStarted("removed-run");
    core.removeAgent__unsafe_dev_only("readd");
    core.addAgent__unsafe_dev_only({ id: "readd", agent });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const message = {
      id: "readded-message",
      role: "assistant" as const,
      content: "arrived after re-add",
    };
    await agent.emitInputlessMessage(message);

    expect(core.getRunIdForMessage("readd", "thread-readd", message.id)).toBe(
      undefined,
    );
  });
});
