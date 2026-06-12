import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAgentRunner } from "../in-memory";
import type { InMemoryThread } from "../in-memory";
import type {
  BaseEvent,
  Message,
  RunAgentInput,
  RunErrorEvent,
  RunStartedEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageStartEvent,
  ToolCallResultEvent,
} from "@ag-ui/client";
import { AbstractAgent, EventType } from "@ag-ui/client";
import { EMPTY, firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";

const stripTerminalEvents = (events: BaseEvent[]) =>
  events.filter(
    (event) =>
      event.type !== EventType.RUN_FINISHED &&
      event.type !== EventType.RUN_ERROR,
  );

class TestAgent extends AbstractAgent {
  constructor(
    private readonly events: BaseEvent[] = [],
    private readonly emitDefaultRunStarted = true,
  ) {
    super();
  }

  async runAgent(
    input: RunAgentInput,
    options: {
      onEvent: (event: { event: BaseEvent }) => void;
      onNewMessage?: (args: { message: Message }) => void;
      onRunStartedEvent?: () => void;
    },
  ): Promise<void> {
    if (this.emitDefaultRunStarted) {
      const runStarted: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      };
      options.onEvent({ event: runStarted });
      options.onRunStartedEvent?.();
    }

    for (const event of this.events) {
      options.onEvent({ event });
    }
  }

  clone(): AbstractAgent {
    return new TestAgent(this.events, this.emitDefaultRunStarted);
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

class ThrowingAgent extends AbstractAgent {
  constructor(private readonly error: Error) {
    super();
  }

  async runAgent(): Promise<void> {
    throw this.error;
  }

  clone(): AbstractAgent {
    return new ThrowingAgent(this.error);
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

describe("InMemoryAgentRunner", () => {
  let runner: InMemoryAgentRunner;

  beforeEach(() => {
    runner = new InMemoryAgentRunner();
    runner.clearThreads();
  });

  describe("RunStarted payload", () => {
    it("emits RUN_STARTED before agent events", async () => {
      const threadId = "in-memory-basic";
      const agent = new TestAgent([
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: "msg-1",
          role: "assistant",
        } as TextMessageStartEvent,
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "msg-1",
          delta: "Hello",
        } as TextMessageContentEvent,
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: "msg-1",
        } as TextMessageEndEvent,
      ]);

      const events = await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: { threadId, runId: "run-1", messages: [], state: {} },
          })
          .pipe(toArray()),
      );

      const nonTerminalEvents = stripTerminalEvents(events);
      expect(nonTerminalEvents).toHaveLength(4);
      expect(nonTerminalEvents[0].type).toBe(EventType.RUN_STARTED);
      const compacted = nonTerminalEvents.slice(1);
      expect(compacted[0].type).toBe(EventType.TEXT_MESSAGE_START);
      expect(compacted[1].type).toBe(EventType.TEXT_MESSAGE_CONTENT);
      expect((compacted[1] as TextMessageContentEvent).delta).toBe("Hello");
      expect(compacted[2].type).toBe(EventType.TEXT_MESSAGE_END);
    });

    it("attaches only new messages to the RUN_STARTED input", async () => {
      const threadId = "in-memory-new-messages";
      const existing: Message = {
        id: "existing-msg",
        role: "user",
        content: "Hi",
      };

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent: new TestAgent(),
            input: {
              threadId,
              runId: "run-0",
              messages: [existing],
              state: {},
            },
          })
          .pipe(toArray()),
      );

      const newMessage: Message = {
        id: "new-msg",
        role: "user",
        content: "Follow up",
      };

      const secondRun = await firstValueFrom(
        runner
          .run({
            threadId,
            agent: new TestAgent(),
            input: {
              threadId,
              runId: "run-1",
              messages: [existing, newMessage],
              state: { counter: 1 },
            },
          })
          .pipe(toArray()),
      );

      const runStarted = secondRun[0] as RunStartedEvent;
      expect(runStarted.input?.messages?.map((m) => m.id)).toEqual(["new-msg"]);
      expect(runStarted.input?.state).toEqual({ counter: 1 });

      const connectEvents = await firstValueFrom(
        runner.connect({ threadId }).pipe(toArray()),
      );
      const latestRunStarted = connectEvents
        .filter(
          (event): event is RunStartedEvent =>
            event.type === EventType.RUN_STARTED,
        )
        .pop();
      expect(latestRunStarted?.input?.messages?.map((m) => m.id)).toEqual([
        "new-msg",
      ]);
    });

    it("preserves agent-provided RUN_STARTED input", async () => {
      const threadId = "in-memory-agent-input";
      const providedInput: RunAgentInput = {
        threadId,
        runId: "run-preserve",
        messages: [],
        state: { fromAgent: true },
      };

      const agent = new TestAgent(
        [
          {
            type: EventType.RUN_STARTED,
            threadId,
            runId: "run-preserve",
            input: providedInput,
          } as RunStartedEvent,
        ],
        false,
      );

      const events = await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: {
              threadId,
              runId: "run-preserve",
              messages: [{ id: "extra", role: "user", content: "hi" }],
              state: {},
            },
          })
          .pipe(toArray()),
      );

      const nonTerminalEvents = stripTerminalEvents(events);
      expect(nonTerminalEvents).toHaveLength(1);
      const runStarted = nonTerminalEvents[0] as RunStartedEvent;
      expect(runStarted.input).toBe(providedInput);
    });
  });

  describe("Event propagation", () => {
    it("replays agent events for new connections", async () => {
      const threadId = "in-memory-replay";
      const agent = new TestAgent([
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: "msg-1",
          role: "assistant",
        } as TextMessageStartEvent,
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "msg-1",
          delta: "Hello",
        } as TextMessageContentEvent,
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: "msg-1",
        } as TextMessageEndEvent,
      ]);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: { threadId, runId: "run-1", messages: [], state: {} },
          })
          .pipe(toArray()),
      );

      const connectEvents = await firstValueFrom(
        runner.connect({ threadId }).pipe(toArray()),
      );

      const nonTerminalEvents = stripTerminalEvents(connectEvents);
      expect(nonTerminalEvents).toHaveLength(4);
      expect(nonTerminalEvents[0].type).toBe(EventType.RUN_STARTED);
      expect(nonTerminalEvents.slice(1).map((event) => event.type)).toEqual([
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
      ]);
    });

    it("keeps agent-generated tool results", async () => {
      const threadId = "in-memory-tool-results";
      const agent = new TestAgent([
        {
          type: EventType.TOOL_CALL_RESULT,
          messageId: "tool-msg",
          toolCallId: "tool-call",
          content: "42",
          role: "tool",
        } as ToolCallResultEvent,
      ]);

      const events = await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: { threadId, runId: "run-1", messages: [], state: {} },
          })
          .pipe(toArray()),
      );

      const nonTerminalEvents = stripTerminalEvents(events);
      expect(nonTerminalEvents).toHaveLength(2);
      const [, toolResult] = nonTerminalEvents;
      expect(toolResult.type).toBe(EventType.TOOL_CALL_RESULT);
    });
  });

  describe("Error propagation", () => {
    it("propagates the agent error message into the RUN_ERROR event", async () => {
      const threadId = "in-memory-error-propagation";
      const httpError = new Error("HTTP 401: Unauthorized");
      const agent = new ThrowingAgent(httpError);

      const events = await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: { threadId, runId: "run-err", messages: [], state: {} },
          })
          .pipe(toArray()),
      );

      const errorEvent = events.find(
        (event): event is RunErrorEvent => event.type === EventType.RUN_ERROR,
      );

      expect(errorEvent).toBeDefined();
      expect(errorEvent!.message).toBe("HTTP 401: Unauthorized");
      // RUN_ERROR must be the terminal event — the runner must not also emit
      // RUN_FINISHED on the failure path, and nothing should follow the error.
      expect(events[events.length - 1].type).toBe(EventType.RUN_ERROR);
      expect(
        events.filter((e) => e.type === EventType.RUN_FINISHED),
      ).toHaveLength(0);
    });

    it("propagates non-HTTP error messages into the RUN_ERROR event", async () => {
      const threadId = "in-memory-error-generic";
      const agent = new ThrowingAgent(new Error("Connection refused"));

      const events = await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: { threadId, runId: "run-err-2", messages: [], state: {} },
          })
          .pipe(toArray()),
      );

      const errorEvent = events.find(
        (event): event is RunErrorEvent => event.type === EventType.RUN_ERROR,
      );

      expect(errorEvent).toBeDefined();
      expect(errorEvent!.message).toBe("Connection refused");
    });
  });
});

// ---------------------------------------------------------------------------
// Agent that populates this.messages after a run — needed to test the
// listThreads / getThreadMessages fallback which reads agent.messages.
// ---------------------------------------------------------------------------
class MessagePopulatingTestAgent extends AbstractAgent {
  constructor(
    // Accept undefined so `clone()` can forward `this.agentId` losslessly.
    // `AbstractAgent.agentId` is optional (`AgentConfig.agentId?: string`),
    // so coercing undefined to "" would silently turn "no agent id" into
    // "empty agent id" — a different state.
    agentId: string | undefined,
    private readonly inputMessages: Message[],
    private readonly generatedMessages: Message[],
  ) {
    super({ agentId });
  }

  // Override runAgent to simulate what a real agent does: populate this.messages
  // with the full conversation (input + generated) then call the subscriber callbacks.
  // Aligns with TestAgent above — `onEvent` is required so the in-memory runner
  // contract (always supply an event sink) is exercised exactly the same way.
  // `onNewMessage` is declared optional to match TestAgent and the actual
  // runner call site, which always passes it. Without the declaration the
  // mock's options shape silently drifts from production and a regression
  // that starts depending on `onNewMessage` here would compile cleanly.
  async runAgent(
    input: RunAgentInput,
    options: {
      onEvent: (params: { event: BaseEvent }) => void;
      onNewMessage?: (args: { message: Message }) => void;
      onRunStartedEvent?: () => void;
    },
  ): Promise<{ result: unknown; newMessages: Message[] }> {
    const runStarted: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    };
    options.onEvent({ event: runStarted });
    options.onRunStartedEvent?.();

    for (const msg of this.generatedMessages) {
      const start = {
        type: EventType.TEXT_MESSAGE_START,
        messageId: msg.id,
        role: (msg as { role: string }).role,
      } as TextMessageStartEvent;
      const content = {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: msg.id,
        delta: (msg as { content?: string }).content ?? "",
      } as TextMessageContentEvent;
      const end = {
        type: EventType.TEXT_MESSAGE_END,
        messageId: msg.id,
      } as TextMessageEndEvent;
      options.onEvent({ event: start });
      options.onEvent({ event: content });
      options.onEvent({ event: end });
    }

    // Populate this.messages — this is what real AbstractAgent.runAgent does
    this.messages = [...this.inputMessages, ...this.generatedMessages];
    return { result: undefined, newMessages: this.generatedMessages };
  }

  clone(): AbstractAgent {
    return new MessagePopulatingTestAgent(
      this.agentId,
      this.inputMessages,
      this.generatedMessages,
    );
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  // Mirror `TestAgent` and `ThrowingAgent` — `AbstractAgent.connect()` would
  // otherwise inherit production behavior that may try to open a transport.
  // Returning EMPTY keeps clones inert in tests.
  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

describe("InMemoryAgentRunner — listThreads / getThreadMessages", () => {
  let runner: InMemoryAgentRunner;

  const userMessage: Message = { id: "u1", role: "user", content: "Hello" };
  const assistantMessage: Message = {
    id: "a1",
    role: "assistant",
    content: "Hi there!",
  };

  beforeEach(async () => {
    runner = new InMemoryAgentRunner();
    // Reset the module-level GLOBAL_STORE singleton so tests don't leak into each other
    runner.clearThreads();

    // Run a single turn on a unique thread so each test starts fresh
    const agent = new MessagePopulatingTestAgent(
      "test-agent",
      [userMessage],
      [assistantMessage],
    );
    await firstValueFrom(
      runner
        .run({
          threadId: "list-threads-thread-1",
          agent,
          input: {
            threadId: "list-threads-thread-1",
            runId: "run-lt-1",
            messages: [userMessage],
            state: {},
            tools: [],
            context: [],
          },
        })
        .pipe(toArray()),
    );
  });

  describe("listThreads", () => {
    it("returns a summary for each completed thread", () => {
      const threads = runner.listThreads();
      const thread = threads.find(
        (t: InMemoryThread) => t.id === "list-threads-thread-1",
      );
      expect(thread).toBeDefined();
      expect(thread!.agentId).toBe("test-agent");
      expect(thread!.name).toBeNull();
      expect(thread!.archived).toBe(false);
      expect(thread!.createdAt).toBeTruthy();
      expect(thread!.updatedAt).toBeTruthy();
    });

    it("returns threads sorted most-recently-updated first", async () => {
      // Run a second thread after a delay long enough that timer-resolution
      // jitter on slow CI runners cannot collapse the two timestamps. 20ms
      // sits comfortably above typical setTimeout granularity (~4ms in Node)
      // and the file-system timestamp resolution we observed flakes around.
      await new Promise((r) => setTimeout(r, 20));
      const agent2 = new MessagePopulatingTestAgent(
        "test-agent",
        [userMessage],
        [assistantMessage],
      );
      await firstValueFrom(
        runner
          .run({
            threadId: "list-threads-thread-2",
            agent: agent2,
            input: {
              threadId: "list-threads-thread-2",
              runId: "run-lt-2",
              messages: [userMessage],
              state: {},
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const threads = runner.listThreads();
      const ids = threads.map((t: InMemoryThread) => t.id);
      const idx1 = ids.indexOf("list-threads-thread-1");
      const idx2 = ids.indexOf("list-threads-thread-2");
      // thread-2 is more recent, should appear before thread-1
      expect(idx2).toBeLessThan(idx1);
    });

    it("returns an empty array when no threads have been run", () => {
      const freshRunner = new InMemoryAgentRunner();
      freshRunner.clearThreads();
      expect(freshRunner.listThreads()).toEqual([]);
    });
  });

  describe("getThreadMessages", () => {
    it("returns all messages for a completed thread", () => {
      const messages = runner.getThreadMessages("list-threads-thread-1");
      expect(messages).toHaveLength(2);
      const roles = messages.map((m) => (m as { role: string }).role);
      expect(roles).toContain("user");
      expect(roles).toContain("assistant");
    });

    it("includes message content", () => {
      const messages = runner.getThreadMessages("list-threads-thread-1");
      const user = messages.find(
        (m) => (m as { role: string }).role === "user",
      ) as {
        content?: string;
      };
      const assistant = messages.find(
        (m) => (m as { role: string }).role === "assistant",
      ) as { content?: string };
      expect(user?.content).toBe("Hello");
      expect(assistant?.content).toBe("Hi there!");
    });

    it("returns an empty array for an unknown threadId", () => {
      const messages = runner.getThreadMessages("nonexistent-thread-xyz");
      expect(messages).toEqual([]);
    });

    it("reflects the most recent run's full message history", async () => {
      const followUp: Message = {
        id: "u2",
        role: "user",
        content: "Follow up",
      };
      const followUpReply: Message = {
        id: "a2",
        role: "assistant",
        content: "Sure!",
      };
      const agent2 = new MessagePopulatingTestAgent(
        "test-agent",
        [userMessage, assistantMessage, followUp],
        [followUpReply],
      );
      await firstValueFrom(
        runner
          .run({
            threadId: "list-threads-thread-1",
            agent: agent2,
            input: {
              threadId: "list-threads-thread-1",
              runId: "run-lt-turn-2",
              messages: [userMessage, assistantMessage, followUp],
              state: {},
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const messages = runner.getThreadMessages("list-threads-thread-1");
      // Should have all 4 messages from the second run's snapshot
      expect(messages).toHaveLength(4);
    });
  });

  describe("getThreadEvents", () => {
    it("returns stored events for a completed thread", () => {
      const events = runner.getThreadEvents("list-threads-thread-1");
      // The beforeEach runs a single turn. The MessagePopulatingTestAgent
      // emits RUN_STARTED + a TEXT_MESSAGE triple for the assistant reply
      // and never emits a terminal event itself.
      expect(events.length).toBeGreaterThan(0);
      const types = events.map((e) => e.type);
      expect(types).toContain(EventType.RUN_STARTED);
      // Content events must be present so the inspector can replay full
      // thread history — guard against a regression that strips them
      // during compaction.
      expect(types).toContain(EventType.TEXT_MESSAGE_START);
      expect(types).toContain(EventType.TEXT_MESSAGE_CONTENT);
      expect(types).toContain(EventType.TEXT_MESSAGE_END);
      // finalizeRunEvents mutates the events array to append a synthetic
      // terminal event when the agent does not emit one itself: a
      // RUN_ERROR with code INCOMPLETE_STREAM. Asserting this explicitly
      // guards against a regression where the synthetic event is dropped
      // (the inspector would render an in-progress thread forever) or
      // where the code is silently changed to something inspectors don't
      // recognise.
      const terminal = events.find(
        (e): e is BaseEvent & { code?: string } =>
          e.type === EventType.RUN_ERROR,
      );
      expect(terminal).toBeDefined();
      expect((terminal as { code?: string }).code).toBe("INCOMPLETE_STREAM");
    });

    it("returns an empty array for an unknown threadId", () => {
      expect(runner.getThreadEvents("nonexistent-thread-xyz")).toEqual([]);
    });

    it("flattens events across multiple historic runs", async () => {
      const followUp: Message = {
        id: "u2",
        role: "user",
        content: "Follow up",
      };
      const agent2 = new MessagePopulatingTestAgent(
        "test-agent",
        [userMessage, assistantMessage, followUp],
        [{ id: "a2", role: "assistant", content: "Sure!" }],
      );
      await firstValueFrom(
        runner
          .run({
            threadId: "list-threads-thread-1",
            agent: agent2,
            input: {
              threadId: "list-threads-thread-1",
              runId: "run-lt-turn-2",
              messages: [userMessage, assistantMessage, followUp],
              state: {},
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const events = runner.getThreadEvents("list-threads-thread-1");
      const runStartedCount = events.filter(
        (e) => e.type === EventType.RUN_STARTED,
      ).length;
      // Two runs means two RUN_STARTED events survive compaction.
      expect(runStartedCount).toBe(2);
    });
  });

  describe("getThreadState", () => {
    it("returns null when the thread has never emitted a state snapshot", () => {
      // The beforeEach agent doesn't emit STATE_SNAPSHOT events.
      expect(runner.getThreadState("list-threads-thread-1")).toBeNull();
    });

    it("returns null for an unknown threadId", () => {
      expect(runner.getThreadState("nonexistent-thread-xyz")).toBeNull();
    });

    it("returns the last STATE_SNAPSHOT payload after a run", async () => {
      const snapshot = { counter: 7, name: "alpha" };
      const stateAgent = new TestAgent(
        [
          {
            type: EventType.STATE_SNAPSHOT,
            snapshot,
          } as BaseEvent,
        ],
        true,
      );
      await firstValueFrom(
        runner
          .run({
            threadId: "thread-with-state",
            agent: stateAgent,
            input: {
              threadId: "thread-with-state",
              runId: "run-state-1",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      expect(runner.getThreadState("thread-with-state")).toEqual(snapshot);
    });

    it("returns the most recent snapshot across multiple runs", async () => {
      const first = { step: 1 };
      const second = { step: 2 };

      const run = async (threadId: string, runId: string, snapshot: object) => {
        const agent = new TestAgent(
          [{ type: EventType.STATE_SNAPSHOT, snapshot } as BaseEvent],
          true,
        );
        await firstValueFrom(
          runner
            .run({
              threadId,
              agent,
              input: {
                threadId,
                runId,
                messages: [],
                state: {},
                tools: [],
                context: [],
              },
            })
            .pipe(toArray()),
        );
      };

      await run("thread-multi-state", "run-a", first);
      await run("thread-multi-state", "run-b", second);

      expect(runner.getThreadState("thread-multi-state")).toEqual(second);

      // Cross-thread isolation: a snapshot on a different thread must not
      // bleed into the original thread's state. This guards against any
      // accidental "last-write-wins" leak in the per-thread state store.
      const otherThreadSnapshot = { step: 999 };
      await run("thread-other", "run-other", otherThreadSnapshot);

      expect(runner.getThreadState("thread-other")).toEqual(
        otherThreadSnapshot,
      );
      expect(runner.getThreadState("thread-multi-state")).toEqual(second);
    });
  });
});
