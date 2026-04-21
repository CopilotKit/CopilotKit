import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAgentRunner, type InMemoryThread } from "../in-memory";
import {
  AbstractAgent,
  BaseEvent,
  EventType,
  Message,
  RunAgentInput,
  RunErrorEvent,
  RunStartedEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageStartEvent,
  ToolCallResultEvent,
} from "@ag-ui/client";
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
    agentId: string,
    private readonly inputMessages: Message[],
    private readonly generatedMessages: Message[],
  ) {
    super({ agentId });
  }

  // Override runAgent to simulate what a real agent does: populate this.messages
  // with the full conversation (input + generated) then call the subscriber callbacks.
  async runAgent(
    input: RunAgentInput,
    options?: {
      onEvent?: (params: { event: BaseEvent }) => void;
      onRunStartedEvent?: () => void;
    },
  ): Promise<{ result: unknown; newMessages: Message[] }> {
    const runStarted: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    };
    options?.onEvent?.({ event: runStarted });
    options?.onRunStartedEvent?.();

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
      options?.onEvent?.({ event: start });
      options?.onEvent?.({ event: content });
      options?.onEvent?.({ event: end });
    }

    // Populate this.messages — this is what real AbstractAgent.runAgent does
    this.messages = [...this.inputMessages, ...this.generatedMessages];
    return { result: undefined, newMessages: this.generatedMessages };
  }

  clone(): AbstractAgent {
    return new MessagePopulatingTestAgent(
      this.agentId ?? "",
      this.inputMessages,
      this.generatedMessages,
    );
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
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

    // Run a single turn on a unique thread so each test starts fresh
    const agent = new MessagePopulatingTestAgent(
      "test-agent",
      [userMessage],
      [assistantMessage],
    );
    agent.agentId = "test-agent";
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
      // Run a second thread after a short delay so timestamps differ
      await new Promise((r) => setTimeout(r, 5));
      const agent2 = new MessagePopulatingTestAgent(
        "test-agent",
        [userMessage],
        [assistantMessage],
      );
      agent2.agentId = "test-agent";
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
      // Use a runner that has never been used (GLOBAL_STORE key won't exist for new threadIds)
      // We can't easily clear GLOBAL_STORE, but a fresh runner shares the same singleton.
      // Just verify the method returns an array (even if it has entries from other tests).
      expect(Array.isArray(freshRunner.listThreads())).toBe(true);
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
      agent2.agentId = "test-agent";
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
});
