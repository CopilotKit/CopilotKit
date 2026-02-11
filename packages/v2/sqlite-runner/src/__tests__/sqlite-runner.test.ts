import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteAgentRunner } from "..";
import {
  AbstractAgent,
  BaseEvent,
  EventType,
  Message,
  RunAgentInput,
  RunFinishedEvent,
  RunStartedEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageStartEvent,
} from "@ag-ui/client";
import { EMPTY, firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

type RunCallbacks = {
  onEvent: (event: { event: BaseEvent }) => void | Promise<void>;
  onNewMessage?: (args: { message: Message }) => void | Promise<void>;
  onRunStartedEvent?: () => void | Promise<void>;
};

class MockAgent extends AbstractAgent {
  constructor(
    private readonly events: BaseEvent[] = [],
    private readonly emitDefaultRunStarted = true,
  ) {
    super();
  }

  async runAgent(input: RunAgentInput, callbacks: RunCallbacks): Promise<void> {
    if (this.emitDefaultRunStarted) {
      const runStarted: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      };
      await callbacks.onEvent({ event: runStarted });
      await callbacks.onRunStartedEvent?.();
    }

    for (const event of this.events) {
      await callbacks.onEvent({ event });
    }

    const hasTerminalEvent = this.events.some((event) =>
      event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR,
    );

    if (!hasTerminalEvent) {
      const runFinished: RunFinishedEvent = {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      };
      await callbacks.onEvent({ event: runFinished });
    }
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }

  clone(): AbstractAgent {
    return new MockAgent(this.events, this.emitDefaultRunStarted);
  }
}

class StoppableAgent extends AbstractAgent {
  private shouldStop = false;
  private eventDelay: number;

  constructor(eventDelay = 5) {
    super();
    this.eventDelay = eventDelay;
  }

  async runAgent(
    input: RunAgentInput,
    callbacks: RunCallbacks,
  ): Promise<void> {
    this.shouldStop = false;
    let counter = 0;

    const runStarted: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    };
    await callbacks.onEvent({ event: runStarted });
    await callbacks.onRunStartedEvent?.();

    while (!this.shouldStop && counter < 10_000) {
      await new Promise((resolve) => setTimeout(resolve, this.eventDelay));
      const event: BaseEvent = {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: `sqlite-stop-${counter}`,
        delta: `chunk-${counter}`,
      } as TextMessageContentEvent;
      await callbacks.onEvent({ event });
      counter += 1;
    }
  }

  abortRun(): void {
    this.shouldStop = true;
  }

  clone(): AbstractAgent {
    return new StoppableAgent(this.eventDelay);
  }
}

class OpenEventsAgent extends AbstractAgent {
  private shouldStop = false;

  async runAgent(
    input: RunAgentInput,
    callbacks: RunCallbacks,
  ): Promise<void> {
    this.shouldStop = false;
    const messageId = "open-message";
    const toolCallId = "open-tool";

    await callbacks.onEvent({
      event: {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      } as BaseEvent,
    });

    await callbacks.onEvent({
      event: {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: "Partial content",
      } as BaseEvent,
    });

    await callbacks.onEvent({
      event: {
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName: "testTool",
        parentMessageId: messageId,
      } as BaseEvent,
    });

    while (!this.shouldStop) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  abortRun(): void {
    this.shouldStop = true;
  }

  clone(): AbstractAgent {
    return new OpenEventsAgent();
  }
}

describe("SqliteAgentRunner", () => {
  let tempDir: string;
  let dbPath: string;
  let runner: SqliteAgentRunner;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-runner-test-"));
    dbPath = path.join(tempDir, "test.db");
    runner = new SqliteAgentRunner({ dbPath });
  });

  afterEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
  });

  it("emits RUN_STARTED and agent events", async () => {
    const threadId = "sqlite-basic";
    const agent = new MockAgent([
      { type: EventType.TEXT_MESSAGE_START, messageId: "msg-1", role: "assistant" } as TextMessageStartEvent,
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "msg-1", delta: "Hello" } as TextMessageContentEvent,
      { type: EventType.TEXT_MESSAGE_END, messageId: "msg-1" } as TextMessageEndEvent,
      { type: EventType.RUN_FINISHED, threadId, runId: "run-1" } as RunFinishedEvent,
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

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
  });

  it("attaches only new messages on subsequent runs", async () => {
    const threadId = "sqlite-new-messages";
    const existing: Message = { id: "existing", role: "user", content: "hi" };

    await firstValueFrom(
      runner
        .run({
          threadId,
          agent: new MockAgent(),
          input: { threadId, runId: "run-0", messages: [existing], state: {} },
        })
        .pipe(toArray()),
    );

    const newMessage: Message = { id: "new", role: "user", content: "follow up" };

    const secondRun = await firstValueFrom(
      runner
        .run({
          threadId,
          agent: new MockAgent(),
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
    expect(runStarted.input?.messages?.map((m) => m.id)).toEqual(["new"]);

    const db = new Database(dbPath);
    const rows = db
      .prepare("SELECT events FROM agent_runs WHERE thread_id = ? ORDER BY created_at")
      .all(threadId) as { events: string }[];
    db.close();

    expect(rows).toHaveLength(2);
    const run1Stored = JSON.parse(rows[0].events) as BaseEvent[];
    const run2Stored = JSON.parse(rows[1].events) as BaseEvent[];

    const run1Started = run1Stored.find((event) => event.type === EventType.RUN_STARTED) as RunStartedEvent;
    expect(run1Started.input?.messages?.map((m) => m.id)).toEqual(["existing"]);

    const run2Started = run2Stored.find((event) => event.type === EventType.RUN_STARTED) as RunStartedEvent;
    expect(run2Started.input?.messages?.map((m) => m.id)).toEqual(["new"]);
  });

  it("preserves agent-provided input", async () => {
    const threadId = "sqlite-agent-input";
    const providedInput: RunAgentInput = {
      threadId,
      runId: "run-keep",
      messages: [],
      state: { fromAgent: true },
    };

    const agent = new MockAgent(
      [
        {
          type: EventType.RUN_STARTED,
          threadId,
          runId: "run-keep",
          input: providedInput,
        } as RunStartedEvent,
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId: "run-keep",
        } as RunFinishedEvent,
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
            runId: "run-keep",
            messages: [{ id: "ignored", role: "user", content: "hi" }],
            state: {},
          },
        })
        .pipe(toArray()),
    );

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
    const runStarted = events[0] as RunStartedEvent;
    expect(runStarted.input).toBe(providedInput);
  });

  it("persists events across runner instances", async () => {
    const threadId = "sqlite-persist";
    const agent = new MockAgent([
      { type: EventType.TEXT_MESSAGE_START, messageId: "msg", role: "assistant" } as TextMessageStartEvent,
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "msg", delta: "hi" } as TextMessageContentEvent,
      { type: EventType.TEXT_MESSAGE_END, messageId: "msg" } as TextMessageEndEvent,
      { type: EventType.RUN_FINISHED, threadId, runId: "run-1" } as RunFinishedEvent,
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

    const newRunner = new SqliteAgentRunner({ dbPath });
    const replayed = await firstValueFrom(newRunner.connect({ threadId }).pipe(toArray()));

    expect(replayed[0].type).toBe(EventType.RUN_STARTED);
    expect(replayed.slice(1).map((event) => event.type)).toEqual([
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
  });

  it("returns false when stopping a thread that is not running", async () => {
    await expect(runner.stop({ threadId: "sqlite-missing" })).resolves.toBe(false);
  });

  it("stops an active run and completes observables", async () => {
    const threadId = "sqlite-stop";
    const agent = new StoppableAgent(2);
    const input: RunAgentInput = {
      threadId,
      runId: "sqlite-stop-run",
      messages: [],
      state: {},
    };

    const run$ = runner.run({ threadId, agent, input });
    const collected = firstValueFrom(run$.pipe(toArray()));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await runner.isRunning({ threadId })).toBe(true);

    const stopped = await runner.stop({ threadId });
    expect(stopped).toBe(true);

    const events = await collected;
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
    expect(await runner.isRunning({ threadId })).toBe(false);
  });

  it("closes open text and tool events when stopping", async () => {
    const threadId = "sqlite-open-events";
    const agent = new OpenEventsAgent();
    const input: RunAgentInput = {
      threadId,
      runId: "sqlite-open-run",
      messages: [],
      state: {},
    };

    const run$ = runner.run({ threadId, agent, input });
    const collected = firstValueFrom(run$.pipe(toArray()));

    await new Promise((resolve) => setTimeout(resolve, 20));
    await runner.stop({ threadId });

    const events = await collected;
    const endingTypes = events.slice(-4).map((event) => event.type);
    expect(endingTypes).toEqual([
      EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.RUN_FINISHED,
    ]);
  });
});
