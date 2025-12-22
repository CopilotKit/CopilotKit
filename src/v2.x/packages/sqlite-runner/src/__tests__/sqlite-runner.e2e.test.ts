import { describe, it, expect, afterEach } from "vitest";
import { SqliteAgentRunner } from "..";
import {
  AbstractAgent,
  BaseEvent,
  EventType,
  Message,
  RunAgentInput,
  RunErrorEvent,
  RunFinishedEvent,
  RunStartedEvent,
} from "@ag-ui/client";
import { EMPTY, Subscription, firstValueFrom, from } from "rxjs";
import { toArray } from "rxjs/operators";

type RunCallbacks = {
  onEvent: (event: { event: BaseEvent }) => void;
  onNewMessage?: (args: { message: Message }) => void;
  onRunStartedEvent?: () => void;
};

const createdRunners: SqliteAgentRunner[] = [];

afterEach(() => {
  while (createdRunners.length > 0) {
    const runner = createdRunners.pop();
    runner?.close();
  }
});

function createRunner(): SqliteAgentRunner {
  const runner = new SqliteAgentRunner();
  createdRunners.push(runner);
  return runner;
}

interface EmitAgentOptions {
  events?: BaseEvent[];
  emitDefaultRunStarted?: boolean;
  includeRunFinished?: boolean;
  runFinishedEvent?: RunFinishedEvent;
  afterEvent?: (args: { event: BaseEvent; index: number }) => void | Promise<void>;
}

class EmitAgent extends AbstractAgent {
  constructor(private readonly options: EmitAgentOptions = {}) {
    super();
  }

  async runAgent(input: RunAgentInput, callbacks: RunCallbacks): Promise<void> {
    const {
      emitDefaultRunStarted = true,
      includeRunFinished = true,
      runFinishedEvent,
      afterEvent,
    } = this.options;
    const scriptedEvents = this.options.events ?? [];

    let index = 0;
    const emit = async (event: BaseEvent) => {
      callbacks.onEvent({ event });
      if (event.type === EventType.RUN_STARTED) {
        callbacks.onRunStartedEvent?.();
      }
      await afterEvent?.({ event, index });
      index += 1;
    };

    if (emitDefaultRunStarted) {
      const runStarted: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
        parentRunId: input.parentRunId,
      };
      await emit(runStarted);
    }

    for (const event of scriptedEvents) {
      await emit(event);
    }

    const hasRunFinishedEvent =
      scriptedEvents.some((event) => event.type === EventType.RUN_FINISHED) ||
      runFinishedEvent?.type === EventType.RUN_FINISHED;

    if (includeRunFinished && !hasRunFinishedEvent) {
      const finishEvent: RunFinishedEvent =
        runFinishedEvent ?? {
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        };
      await emit(finishEvent);
    }
  }

  clone(): AbstractAgent {
    return new EmitAgent({
      ...this.options,
      events: this.options.events ? [...this.options.events] : undefined,
    });
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

class ReplayAgent extends AbstractAgent {
  constructor(private readonly replayEvents: BaseEvent[], threadId: string) {
    super({ threadId });
  }

  async runAgent(): Promise<void> {
    throw new Error("not used");
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return from(this.replayEvents);
  }
}

class RunnerConnectAgent extends AbstractAgent {
  constructor(private readonly runner: SqliteAgentRunner, threadId: string) {
    super({ threadId });
  }

  async runAgent(): Promise<void> {
    throw new Error("not used");
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(input: RunAgentInput): ReturnType<AbstractAgent["connect"]> {
    return this.runner.connect({ threadId: input.threadId });
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function collectEvents(observable: ReturnType<SqliteAgentRunner["run"]> | ReturnType<SqliteAgentRunner["connect"]>) {
  return firstValueFrom(observable.pipe(toArray()));
}

function createRunInput({
  threadId,
  runId,
  messages,
  state,
  parentRunId,
}: {
  threadId: string;
  runId: string;
  messages: Message[];
  state?: Record<string, unknown>;
  parentRunId?: string | null;
}): RunAgentInput {
  return {
    threadId,
    runId,
    parentRunId: parentRunId ?? undefined,
    state: state ?? {},
    messages,
    tools: [],
    context: [],
    forwardedProps: undefined,
  };
}

function expectRunStartedEvent(event: BaseEvent, expectedMessages: Message[]) {
  expect(event.type).toBe(EventType.RUN_STARTED);
  const runStarted = event as RunStartedEvent;
  expect(runStarted.input?.messages).toEqual(expectedMessages);
}

function createTextMessageEvents({
  messageId,
  role = "assistant",
  content,
}: {
  messageId: string;
  role?: "assistant" | "developer" | "system" | "user";
  content: string;
}): BaseEvent[] {
  return [
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role,
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: content,
    },
    {
      type: EventType.TEXT_MESSAGE_END,
      messageId,
    },
  ] as BaseEvent[];
}

function createToolCallEvents({
  toolCallId,
  parentMessageId,
  toolName,
  argsJson,
  resultMessageId,
  resultContent,
}: {
  toolCallId: string;
  parentMessageId: string;
  toolName: string;
  argsJson: string;
  resultMessageId: string;
  resultContent: string;
}): BaseEvent[] {
  return [
    {
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: toolName,
      parentMessageId,
    },
    {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: argsJson,
    },
    {
      type: EventType.TOOL_CALL_END,
      toolCallId,
    },
    {
      type: EventType.TOOL_CALL_RESULT,
      toolCallId,
      messageId: resultMessageId,
      content: resultContent,
      role: "tool",
    },
  ] as BaseEvent[];
}

describe("SqliteAgentRunner e2e", () => {
  describe("Fresh Replay After Single Run", () => {
    it("replays sanitized message history on connectAgent", async () => {
      const runner = createRunner();
      const threadId = "thread-fresh-replay";
      const existingMessage: Message = {
        id: "message-existing",
        role: "user",
        content: "Hello there",
      };

      const runEvents = await collectEvents(
        runner.run({
          threadId,
          agent: new EmitAgent(),
          input: createRunInput({
            threadId,
            runId: "run-0",
            messages: [existingMessage],
          }),
        }),
      );

      expectRunStartedEvent(runEvents[0], [existingMessage]);
      expect(runEvents.at(-1)?.type).toBe(EventType.RUN_FINISHED);

      const replayEvents = await collectEvents(runner.connect({ threadId }));
      const replayAgent = new ReplayAgent(replayEvents, threadId);
      await replayAgent.connectAgent({ runId: "replay-run" });

      expect(replayAgent.messages).toEqual([existingMessage]);
    });
  });

  describe("New Messages on Subsequent Runs", () => {
    it("merges new message IDs without duplicating history", async () => {
      const runner = createRunner();
      const threadId = "thread-subsequent-runs";
      const existingMessage: Message = {
        id: "msg-existing",
        role: "user",
        content: "First turn",
      };

      const initialRunEvents = await collectEvents(
        runner.run({
          threadId,
          agent: new EmitAgent(),
          input: createRunInput({
            threadId,
            runId: "run-0",
            messages: [existingMessage],
          }),
        }),
      );
      expectRunStartedEvent(initialRunEvents[0], [existingMessage]);

      const newMessage: Message = {
        id: "msg-new",
        role: "user",
        content: "Second turn",
      };

      const secondRunEvents = await collectEvents(
        runner.run({
          threadId,
          agent: new EmitAgent(),
          input: createRunInput({
            threadId,
            runId: "run-1",
            messages: [existingMessage, newMessage],
          }),
        }),
      );

      expectRunStartedEvent(secondRunEvents[0], [newMessage]);

      const replayEvents = await collectEvents(runner.connect({ threadId }));
      const replayAgent = new ReplayAgent(replayEvents, threadId);
      await replayAgent.connectAgent({ runId: "replay-run" });

      expect(replayAgent.messages).toEqual([existingMessage, newMessage]);
      expect(new Set(replayAgent.messages.map((message) => message.id)).size).toBe(
        replayAgent.messages.length,
      );
    });
  });

  describe("Fresh Agent Connection After Prior Runs", () => {
    it("hydrates a brand-new agent via connect()", async () => {
      const runner = createRunner();
      const threadId = "thread-new-agent-connection";
      const existingMessage: Message = {
        id: "existing-connection",
        role: "user",
        content: "Persist me",
      };

      const runEvents = await collectEvents(
        runner.run({
          threadId,
          agent: new EmitAgent(),
          input: createRunInput({
            threadId,
            runId: "run-0",
            messages: [existingMessage],
          }),
        }),
      );
      expectRunStartedEvent(runEvents[0], [existingMessage]);

      const connectingAgent = new RunnerConnectAgent(runner, threadId);
      await connectingAgent.connectAgent({ runId: "connect-run" });

      expect(connectingAgent.messages).toEqual([existingMessage]);
    });
  });

  describe("Mixed Roles and Tool Results", () => {
    it("preserves agent-emitted tool events alongside heterogeneous inputs", async () => {
      const runner = createRunner();
      const threadId = "thread-mixed-roles";

      const systemMessage: Message = {
        id: "sys-1",
        role: "system",
        content: "Global directive",
      };
      const developerMessage: Message = {
        id: "dev-1",
        role: "developer",
        content: "Internal guidance",
      };
      const userMessage: Message = {
        id: "user-1",
        role: "user",
        content: "Need the weather",
      };
      const baseMessages = [systemMessage, developerMessage, userMessage];

      const assistantMessageId = "assistant-1";
      const toolCallId = "tool-call-1";
      const toolMessageId = "tool-msg-1";

      const agentEvents: BaseEvent[] = [
        ...createTextMessageEvents({
          messageId: assistantMessageId,
          content: "Calling the weather tool",
        }),
        ...createToolCallEvents({
          toolCallId,
          parentMessageId: assistantMessageId,
          toolName: "getWeather",
          argsJson: '{"location":"NYC"}',
          resultMessageId: toolMessageId,
          resultContent: '{"temp":72}',
        }),
      ];

      const runEvents = await collectEvents(
        runner.run({
          threadId,
          agent: new EmitAgent({ events: agentEvents }),
          input: createRunInput({
            threadId,
            runId: "run-0",
            messages: baseMessages,
          }),
        }),
      );

      expectRunStartedEvent(runEvents[0], baseMessages);
      expect(runEvents.filter((event) => event.type === EventType.TOOL_CALL_RESULT)).toHaveLength(1);

      const replayEvents = await collectEvents(runner.connect({ threadId }));
      const replayAgent = new ReplayAgent(replayEvents, threadId);
      await replayAgent.connectAgent({ runId: "replay-run" });

      expect(replayAgent.messages).toEqual([
        systemMessage,
        developerMessage,
        userMessage,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "Calling the weather tool",
          toolCalls: [
            {
              id: toolCallId,
              type: "function",
              function: {
                name: "getWeather",
                arguments: '{"location":"NYC"}',
              },
            },
          ],
        },
        {
          id: toolMessageId,
          role: "tool",
          content: '{"temp":72}',
          toolCallId,
        },
      ]);
      expect(replayAgent.messages.filter((message) => message.role === "tool")).toHaveLength(1);
    });
  });

  describe("Multiple Consecutive Runs with Agent Output", () => {
    it("deduplicates input history while emitting each agent message once", async () => {
      const runner = createRunner();
      const threadId = "thread-multi-runs";
      const systemMessage: Message = {
        id: "system-shared",
        role: "system",
        content: "System context",
      };
      const userMessages: Message[] = [];

      for (let index = 0; index < 3; index += 1) {
        const userMessage: Message = {
          id: `user-${index + 1}`,
          role: "user",
          content: `User message ${index + 1}`,
        };
        userMessages.push(userMessage);

        const messagesForRun = [systemMessage, ...userMessages];
        const assistantId = `assistant-${index + 1}`;
        const toolCallId = `tool-call-${index + 1}`;
        const toolMessageId = `tool-msg-${index + 1}`;

        const events: BaseEvent[] = [
          ...createTextMessageEvents({
            messageId: assistantId,
            content: `Assistant reply ${index + 1}`,
          }),
          ...createToolCallEvents({
            toolCallId,
            parentMessageId: assistantId,
            toolName: `tool-${index + 1}`,
            argsJson: `{"step":${index + 1}}`,
            resultMessageId: toolMessageId,
            resultContent: `{"ok":${index + 1}}`,
          }),
        ];

        const runEvents = await collectEvents(
          runner.run({
            threadId,
            agent: new EmitAgent({ events }),
            input: createRunInput({
              threadId,
              runId: `run-${index}`,
              messages: messagesForRun,
            }),
          }),
        );

        if (index === 0) {
          expectRunStartedEvent(runEvents[0], messagesForRun);
        } else {
          expectRunStartedEvent(runEvents[0], [userMessage]);
        }
        expect(runEvents.at(-1)?.type).toBe(EventType.RUN_FINISHED);
      }

      const replayEvents = await collectEvents(runner.connect({ threadId }));
      const replayAgent = new ReplayAgent(replayEvents, threadId);
      await replayAgent.connectAgent({ runId: "replay-final" });

      const finalMessages = replayAgent.messages;
      expect(new Set(finalMessages.map((message) => message.id)).size).toBe(finalMessages.length);
      const roleCounts = finalMessages.reduce<Record<string, number>>((counts, message) => {
        counts[message.role] = (counts[message.role] ?? 0) + 1;
        return counts;
      }, {});
      expect(roleCounts.system).toBe(1);
      expect(roleCounts.user).toBe(3);
      expect(roleCounts.assistant).toBe(3);
      expect(roleCounts.tool).toBe(3);
    });
  });

  describe("Agent-Provided RUN_STARTED input", () => {
    it("forwards the agent-specified payload without sanitizing", async () => {
      const runner = createRunner();
      const threadId = "thread-custom-run-started";
      const runId = "run-0";

      const customMessages: Message[] = [
        {
          id: "custom-user",
          role: "user",
          content: "Pre-sent content",
        },
      ];
      const customInput: RunAgentInput = {
        threadId,
        runId,
        parentRunId: undefined,
        state: { injected: true },
        messages: customMessages,
        tools: [],
        context: [],
        forwardedProps: { source: "agent" },
      };
      const customRunStarted: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId,
        runId,
        parentRunId: null,
        input: customInput,
      };

      const agentEvents: BaseEvent[] = [
        customRunStarted,
        ...createTextMessageEvents({
          messageId: "agent-message",
          content: "Custom start acknowledged",
        }),
      ];

      const runEvents = await collectEvents(
        runner.run({
          threadId,
          agent: new EmitAgent({
            events: agentEvents,
            emitDefaultRunStarted: false,
          }),
          input: createRunInput({
            threadId,
            runId,
            messages: [],
          }),
        }),
      );

      expect(runEvents[0]).toEqual(customRunStarted);
      expect(runEvents.filter((event) => event.type === EventType.RUN_FINISHED)).toHaveLength(1);

      const replayEvents = await collectEvents(runner.connect({ threadId }));
      const replayAgent = new ReplayAgent(replayEvents, threadId);
      await replayAgent.connectAgent({ runId: "replay-run" });
      expect(replayAgent.messages.find((message) => message.id === "custom-user")).toEqual(
        customMessages[0],
      );
    });
  });

  describe("Concurrent Connections During Run", () => {
    it("streams in-flight events to live subscribers and persists final history", async () => {
      const runner = createRunner();
      const threadId = "thread-concurrency";
      const runId = "run-live";
      const initialMessage: Message = {
        id: "initial-user",
        role: "user",
        content: "Start run",
      };

      const runStartedSignal = createDeferred<void>();
      const resumeSignal = createDeferred<void>();

      const agent = new EmitAgent({
        events: [
          ...createTextMessageEvents({
            messageId: "assistant-live",
            content: "Streaming content",
          }),
        ],
        afterEvent: async ({ event }) => {
          if (event.type === EventType.RUN_STARTED) {
            runStartedSignal.resolve();
            await resumeSignal.promise;
          }
        },
      });

      const runEvents: BaseEvent[] = [];
      const run$ = runner.run({
        threadId,
        agent,
        input: createRunInput({
          threadId,
          runId,
          messages: [initialMessage],
        }),
      });

      let runSubscription: Subscription;
      const runCompletion = new Promise<void>((resolve, reject) => {
        runSubscription = run$.subscribe({
          next: (event) => runEvents.push(event),
          error: (error) => {
            runSubscription.unsubscribe();
            reject(error);
          },
          complete: () => {
            runSubscription.unsubscribe();
            resolve();
          },
        });
      });

      await runStartedSignal.promise;

      const liveEvents: BaseEvent[] = [];
      const connect$ = runner.connect({ threadId });
      let connectSubscription: Subscription;
      const connectCompletion = new Promise<void>((resolve, reject) => {
        connectSubscription = connect$.subscribe({
          next: (event) => liveEvents.push(event),
          error: (error) => {
            connectSubscription.unsubscribe();
            reject(error);
          },
          complete: () => {
            connectSubscription.unsubscribe();
            resolve();
          },
        });
      });

      resumeSignal.resolve();

      await Promise.all([runCompletion, connectCompletion]);

      expectRunStartedEvent(runEvents[0], [initialMessage]);
      expect(runEvents.at(-1)?.type).toBe(EventType.RUN_FINISHED);
      expect(liveEvents).toEqual(runEvents);

      const persistedEvents = await collectEvents(runner.connect({ threadId }));
      expect(persistedEvents).toEqual(runEvents);

      const replayAgent = new ReplayAgent(persistedEvents, threadId);
      await replayAgent.connectAgent({ runId: "replay-run" });
      expect(replayAgent.messages.map((message) => message.id)).toEqual([
        initialMessage.id,
        "assistant-live",
      ]);
    });
  });

  describe("Error Handling", () => {
    it("propagates RUN_ERROR while retaining input history", async () => {
      const runner = createRunner();
      const threadId = "thread-run-error";
      const userMessage: Message = {
        id: "error-user",
        role: "user",
        content: "Trigger error",
      };

      const runErrorEvent: RunErrorEvent = {
        type: EventType.RUN_ERROR,
        message: "Agent failure",
      };

      const runEvents = await collectEvents(
        runner.run({
          threadId,
          agent: new EmitAgent({
            events: [runErrorEvent],
            includeRunFinished: false,
          }),
          input: createRunInput({
            threadId,
            runId: "run-error",
            messages: [userMessage],
          }),
        }),
      );

      expectRunStartedEvent(runEvents[0], [userMessage]);
      expect(runEvents.at(-1)).toEqual(runErrorEvent);

      const replayEvents = await collectEvents(runner.connect({ threadId }));
      const replayAgent = new ReplayAgent(replayEvents, threadId);
      const capturedRunErrors: RunErrorEvent[] = [];
      const result = await replayAgent.connectAgent(
        { runId: "replay-run" },
        {
          onRunErrorEvent: ({ event }) => {
            capturedRunErrors.push(event);
          },
        },
      );

      expect(runEvents.at(-1)?.type).toBe(EventType.RUN_ERROR);
      expect(capturedRunErrors).toHaveLength(1);
      expect(capturedRunErrors[0]).toMatchObject(runErrorEvent);
      expect(result.newMessages).toEqual([userMessage]);
      expect(replayAgent.messages).toEqual([userMessage]);
    });
  });
});
