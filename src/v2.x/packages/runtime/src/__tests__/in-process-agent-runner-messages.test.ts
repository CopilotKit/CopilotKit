import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAgentRunner } from "../runner/in-memory";
import {
  AbstractAgent,
  BaseEvent,
  EventType,
  Message,
  RunAgentInput,
  RunStartedEvent,
} from "@ag-ui/client";
import { EMPTY, Observable, firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";

type RunAgentCallbacks = {
  onEvent: (event: { event: BaseEvent }) => void;
  onNewMessage?: (args: { message: Message }) => void;
  onRunStartedEvent?: (args: { event: BaseEvent }) => void;
};

class MessageAwareAgent extends AbstractAgent {
  constructor(
    private readonly events: BaseEvent[] = [],
    private readonly emitDefaultRunStarted = true,
  ) {
    super();
  }

  protected run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }

  async runAgent(
    input: RunAgentInput,
    callbacks: RunAgentCallbacks,
  ): Promise<void> {
    if (this.emitDefaultRunStarted) {
      const runStarted: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      };

      callbacks.onEvent({ event: runStarted });
      callbacks.onRunStartedEvent?.({ event: runStarted });
    }

    for (const event of this.events) {
      callbacks.onEvent({ event });
    }
  }
}

describe("InMemoryAgentRunner – run started inputs", () => {
  let runner: InMemoryAgentRunner;

  beforeEach(() => {
    runner = new InMemoryAgentRunner();
  });

  it("attaches every input message to the emitted RUN_STARTED event", async () => {
    const threadId = "thread-all-messages";
    const messages: Message[] = [
      { id: "user-1", role: "user", content: "User message" },
      { id: "assistant-1", role: "assistant", content: "Assistant message" },
      { id: "developer-1", role: "developer", content: "Developer hint" },
      { id: "system-1", role: "system", content: "System prompt" },
      {
        id: "tool-call-1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tool-call-1",
            type: "function",
            function: { name: "calculator", arguments: "{\"a\":1}" },
          },
        ],
      },
      {
        id: "tool-result-1",
        role: "tool",
        content: "result",
        toolCallId: "tool-call-1",
      },
    ];

    const agent = new MessageAwareAgent();
    const input: RunAgentInput = {
      threadId,
      runId: "run-1",
      state: {},
      messages,
    };

    const runEvents = await firstValueFrom(
      runner.run({ threadId, agent, input }).pipe(toArray()),
    );

    expect(runEvents[0].type).toBe(EventType.RUN_STARTED);
    const runStarted = runEvents[0] as RunStartedEvent;
    expect(runStarted.input?.messages).toEqual(messages);

    const terminalTypes = runEvents.slice(1).map((event) => event.type);
    expect(terminalTypes.every((type) => type === EventType.RUN_ERROR || type === EventType.RUN_FINISHED)).toBe(true);

    const connectEvents = await firstValueFrom(
      runner.connect({ threadId }).pipe(toArray()),
    );

    expect(connectEvents[0].type).toBe(EventType.RUN_STARTED);
    const connectRunStarted = connectEvents[0] as RunStartedEvent;
    expect(connectRunStarted.input?.messages).toEqual(messages);
    const connectTerminalTypes = connectEvents.slice(1).map((event) => event.type);
    expect(
      connectTerminalTypes.every((type) => type === EventType.RUN_ERROR || type === EventType.RUN_FINISHED),
    ).toBe(true);
  });

  it("only includes new messages on subsequent runs", async () => {
    const threadId = "thread-new-messages";
    const existing: Message = {
      id: "existing-msg",
      role: "user",
      content: "Hi there",
    };

    await firstValueFrom(
      runner
        .run({
          threadId,
          agent: new MessageAwareAgent(),
          input: { threadId, runId: "run-0", state: {}, messages: [existing] },
        })
        .pipe(toArray()),
    );

    const newMessage: Message = {
      id: "new-msg",
      role: "user",
      content: "Second question",
    };

    const secondRunEvents = await firstValueFrom(
      runner
        .run({
          threadId,
          agent: new MessageAwareAgent(),
          input: {
            threadId,
            runId: "run-1",
            state: {},
            messages: [existing, newMessage],
          },
        })
        .pipe(toArray()),
    );

    expect(secondRunEvents[0].type).toBe(EventType.RUN_STARTED);
    const runStarted = secondRunEvents[0] as RunStartedEvent;
    expect(runStarted.input?.messages).toEqual([newMessage]);
    const secondTerminalTypes = secondRunEvents.slice(1).map((event) => event.type);
    expect(
      secondTerminalTypes.every((type) => type === EventType.RUN_ERROR || type === EventType.RUN_FINISHED),
    ).toBe(true);

    const connectEvents = await firstValueFrom(
      runner.connect({ threadId }).pipe(toArray()),
    );

    const latestRunStarted = connectEvents
      .filter((event) => event.type === EventType.RUN_STARTED)
      .pop() as RunStartedEvent;
    expect(latestRunStarted.input?.messages).toEqual([newMessage]);
  });

  it("preserves agent-provided RUN_STARTED input", async () => {
    const threadId = "thread-agent-input";
    const providedInput: RunAgentInput = {
      threadId,
      runId: "run-preserve",
      state: { injected: true },
      messages: [],
    };

    const agent = new MessageAwareAgent(
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

    const runEvents = await firstValueFrom(
      runner
        .run({
          threadId,
          agent,
          input: {
            threadId,
            runId: "run-preserve",
            state: {},
            messages: [{ id: "extra", role: "user", content: "Hello" }],
          },
        })
        .pipe(toArray()),
    );

    const runStarted = runEvents[0] as RunStartedEvent;
    expect(runStarted.input).toBe(providedInput);
  });
});
