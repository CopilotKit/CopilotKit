import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAgentRunner } from "../in-memory";
import {
  AbstractAgent,
  BaseEvent,
  EventType,
  Message,
  RunAgentInput,
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
    (event) => event.type !== EventType.RUN_FINISHED && event.type !== EventType.RUN_ERROR,
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
      const existing: Message = { id: "existing-msg", role: "user", content: "Hi" };

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent: new TestAgent(),
            input: { threadId, runId: "run-0", messages: [existing], state: {} },
          })
          .pipe(toArray()),
      );

      const newMessage: Message = { id: "new-msg", role: "user", content: "Follow up" };

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
        .filter((event): event is RunStartedEvent => event.type === EventType.RUN_STARTED)
        .pop();
      expect(latestRunStarted?.input?.messages?.map((m) => m.id)).toEqual(["new-msg"]);
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
});
