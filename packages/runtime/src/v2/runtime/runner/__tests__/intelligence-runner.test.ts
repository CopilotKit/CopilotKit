import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AbstractAgent,
  BaseEvent,
  EventType,
  RunAgentInput,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
} from "@ag-ui/client";
import { EMPTY, firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";
import {
  MockChannel,
  MockSocket,
} from "../../../../../../core/src/__tests__/test-utils";

let mockChannels: MockChannel[] = [];
let mockSockets: MockSocket[] = [];

class MockSocketImpl extends MockSocket {
  constructor(url: string, opts?: any) {
    super(url, opts);
    mockSockets.push(this);
  }

  channel(topic: string, params: Record<string, any> = {}): MockChannel {
    const ch = super.channel(topic, params);
    mockChannels.push(ch);
    return ch;
  }
}

vi.mock("phoenix", () => ({
  Socket: MockSocketImpl,
  Channel: MockChannel,
}));

vi.mock("ws", () => ({ default: class MockWebSocket {} }));

class MockAgent extends AbstractAgent {
  aborted = false;
  private events: BaseEvent[];

  constructor(events: BaseEvent[] = []) {
    super();
    this.events = events;
  }

  async runAgent(
    _input: RunAgentInput,
    subscriber?: { onEvent?: (arg: { event: BaseEvent }) => void },
  ): Promise<void> {
    for (const event of this.events) {
      subscriber?.onEvent?.({ event });
    }
  }

  abortRun(): void {
    this.aborted = true;
  }

  clone(): AbstractAgent {
    return new MockAgent(this.events);
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

class ThrowingMockAgent extends AbstractAgent {
  aborted = false;
  private errorMessage: string;

  constructor(errorMessage = "Agent exploded") {
    super();
    this.errorMessage = errorMessage;
  }

  async runAgent(): Promise<void> {
    throw new Error(this.errorMessage);
  }

  abortRun(): void {
    this.aborted = true;
  }

  clone(): AbstractAgent {
    return new ThrowingMockAgent(this.errorMessage);
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

/**
 * An agent whose runAgent() blocks until abortRun() is called,
 * then rejects — simulating how a real agent's AbortController
 * would cause in-flight work to fail on abort.
 */
class BlockingMockAgent extends AbstractAgent {
  aborted = false;
  private rejectFn: ((reason: Error) => void) | null = null;

  async runAgent(): Promise<void> {
    return new Promise<void>((_resolve, reject) => {
      this.rejectFn = reject;
    });
  }

  abortRun(): void {
    this.aborted = true;
    this.rejectFn?.(new Error("Aborted"));
  }

  clone(): AbstractAgent {
    return new BlockingMockAgent();
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

function createRunInput(
  overrides: Partial<RunAgentInput> & { threadId: string; runId: string },
): RunAgentInput {
  return {
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: undefined,
    ...overrides,
  };
}

async function collectEvents(
  observable: ReturnType<
    import("../intelligence").IntelligenceAgentRunner["run"]
  >,
) {
  return firstValueFrom(observable.pipe(toArray()));
}

// Must come after vi.mock so phoenix/ws are mocked when the module is loaded.
const { IntelligenceAgentRunner } = await import("../intelligence");

describe("IntelligenceAgentRunner", () => {
  let runner: InstanceType<typeof IntelligenceAgentRunner>;

  beforeEach(() => {
    mockChannels = [];
    mockSockets = [];
    runner = new IntelligenceAgentRunner({ url: "ws://localhost:4000/runner" });
  });

  it("passes Phoenix authToken to the runner socket when configured", () => {
    runner = new IntelligenceAgentRunner({
      url: "ws://localhost:4000/runner",
      authToken: "cpk_test_key",
    });

    const threadId = "t-auth";
    const input = createRunInput({ threadId, runId: "r-auth" });
    const agent = new MockAgent();

    const sub = runner.run({ threadId, agent, input }).subscribe();

    expect(mockSockets[0]?.opts).toMatchObject({
      authToken: "cpk_test_key",
    });

    sub.unsubscribe();
  });

  describe("run", () => {
    it("calls runAgent() and completes the Observable (events go to channel only)", async () => {
      const threadId = "t-1";
      const input = createRunInput({ threadId, runId: "r-1" });

      const agentEvents: BaseEvent[] = [
        {
          type: EventType.RUN_STARTED,
          threadId,
          runId: "r-1",
        } as RunStartedEvent,
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
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId: "r-1",
        } as RunFinishedEvent,
      ];
      const agent = new MockAgent(agentEvents);

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      const events = await eventsPromise;

      // Agent events are NOT emitted to the Observable — only to the channel.
      // The Observable only receives finalization events (none needed here).
      expect(events).toHaveLength(0);
    });

    it("pushes agent events to the Phoenix channel", async () => {
      const threadId = "t-push";
      const input = createRunInput({ threadId, runId: "r-push" });

      const agentEvents: BaseEvent[] = [
        {
          type: EventType.RUN_STARTED,
          threadId,
          runId: "r-push",
        } as RunStartedEvent,
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "msg-1",
          delta: "hi",
        } as TextMessageContentEvent,
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId: "r-push",
        } as RunFinishedEvent,
      ];
      const agent = new MockAgent(agentEvents);

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      await eventsPromise;

      // Agent events should be pushed to the ingestion channel under "event".
      expect(ch.pushLog.every((p) => p.event === "event")).toBe(true);
      const payloadTypes = ch.pushLog.map((p) => p.payload.type);
      expect(payloadTypes).toContain(EventType.RUN_STARTED);
      expect(payloadTypes).toContain(EventType.TEXT_MESSAGE_CONTENT);
      expect(payloadTypes).toContain(EventType.RUN_FINISHED);
      expect(ch.pushLog[0].payload).toMatchObject({
        thread_id: threadId,
        run_id: "r-push",
      });
      expect(ch.pushLog[0].payload.metadata.cpki_event_id).toEqual(
        expect.any(String),
      );
      expect(ch.pushLog[0].payload.metadata.cpki_event_seq).toBe(1);
      expect(ch.pushLog[1].payload.metadata.cpki_event_seq).toBe(2);
      expect(ch.pushLog[2].payload.metadata.cpki_event_seq).toBe(3);
    });

    it("overrides conflicting event thread and run ownership before pushing to the channel", async () => {
      const threadId = "t-canonical";
      const input = createRunInput({ threadId, runId: "r-canonical" });

      const agent = new MockAgent([
        {
          type: EventType.RUN_STARTED,
          threadId: "backend-thread",
          runId: "backend-run",
        } as RunStartedEvent,
        {
          type: EventType.RUN_FINISHED,
          threadId: "backend-thread",
          runId: "backend-run",
        } as RunFinishedEvent,
      ]);

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      await eventsPromise;

      expect(ch.pushLog.map((entry) => entry.payload)).toEqual([
        expect.objectContaining({
          type: EventType.RUN_STARTED,
          threadId,
          runId: input.runId,
          thread_id: threadId,
          run_id: input.runId,
        }),
        expect.objectContaining({
          type: EventType.RUN_FINISHED,
          threadId,
          runId: input.runId,
          thread_id: threadId,
          run_id: input.runId,
        }),
      ]);
    });

    it("rewrites RUN_STARTED input.messages to the unseen persisted subset", async () => {
      const threadId = "t-persisted-input";
      const input = createRunInput({
        threadId,
        runId: "r-persisted-input",
        messages: [
          {
            id: "msg-existing",
            role: "user",
            content: "Existing",
          },
          {
            id: "msg-new",
            role: "user",
            content: "New",
          },
        ],
      });

      const agent = new MockAgent([
        {
          type: EventType.RUN_STARTED,
          threadId,
          runId: "r-persisted-input",
          input,
        } as RunStartedEvent,
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId: "r-persisted-input",
        } as RunFinishedEvent,
      ]);

      const eventsPromise = collectEvents(
        runner.run({
          threadId,
          agent,
          input,
          persistedInputMessages: [
            {
              id: "msg-new",
              role: "user",
              content: "New",
            },
          ],
        }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      await eventsPromise;

      expect(ch.pushLog[0].payload.type).toBe(EventType.RUN_STARTED);
      expect(ch.pushLog[0].payload.input.messages).toEqual([
        {
          id: "msg-new",
          role: "user",
          content: "New",
        },
      ]);
    });

    it("synthesizes RUN_STARTED before other events when the agent omits it", async () => {
      const threadId = "t-synth-run-started";
      const input = createRunInput({
        threadId,
        runId: "r-synth-run-started",
        messages: [
          {
            id: "msg-new",
            role: "user",
            content: "Persist me",
          },
        ],
      });

      const agent = new MockAgent([
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "msg-1",
          delta: "hello",
        } as TextMessageContentEvent,
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId: "r-synth-run-started",
        } as RunFinishedEvent,
      ]);

      const eventsPromise = collectEvents(
        runner.run({
          threadId,
          agent,
          input,
          persistedInputMessages: input.messages,
        }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      await eventsPromise;

      expect(ch.pushLog[0].payload.type).toBe(EventType.RUN_STARTED);
      expect(ch.pushLog[0].payload.input.messages).toEqual(input.messages);
      expect(ch.pushLog[1].payload.type).toBe(EventType.TEXT_MESSAGE_CONTENT);
    });

    it("does not push any CUSTOM run event to the channel", async () => {
      const threadId = "t-no-custom";
      const input = createRunInput({ threadId, runId: "r-no-custom" });

      const agentEvents: BaseEvent[] = [
        {
          type: EventType.RUN_STARTED,
          threadId,
          runId: "r-no-custom",
        } as RunStartedEvent,
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId: "r-no-custom",
        } as RunFinishedEvent,
      ];
      const agent = new MockAgent(agentEvents);

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      await eventsPromise;

      const customRunPush = ch.pushLog.find(
        (p) => p.event === EventType.CUSTOM && p.payload?.name === "run",
      );
      expect(customRunPush).toBeUndefined();
    });

    it("pushes RUN_ERROR to the channel when agent throws", async () => {
      const threadId = "t-err";
      const input = createRunInput({ threadId, runId: "r-err" });
      const agent = new ThrowingMockAgent("Something went wrong");

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      await eventsPromise;

      const errorPush = ch.pushLog.find(
        (p) => p.payload?.type === EventType.RUN_ERROR,
      );
      expect(errorPush).toBeDefined();
      expect(errorPush!.payload).toMatchObject({
        type: EventType.RUN_ERROR,
        message: "Something went wrong",
        threadId,
        runId: input.runId,
        thread_id: threadId,
        run_id: input.runId,
      });
    });

    it("finalizes open message streams before completing", async () => {
      const threadId = "t-finalize";
      const input = createRunInput({ threadId, runId: "r-fin" });

      // Emit an unclosed text message, then RUN_FINISHED.
      const agentEvents: BaseEvent[] = [
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: "open-msg",
          role: "assistant",
        } as BaseEvent,
        { type: EventType.RUN_FINISHED, threadId, runId: "r-fin" } as BaseEvent,
      ];
      const agent = new MockAgent(agentEvents);

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      await eventsPromise;

      // finalizeRunEvents appends TEXT_MESSAGE_END for the unclosed message.
      // Verify the channel received both agent and finalization events.
      const chPayloadTypes = ch.pushLog.map((p) => p.payload.type);
      expect(chPayloadTypes).toContain(EventType.RUN_STARTED);
      expect(chPayloadTypes).toContain(EventType.TEXT_MESSAGE_START);
      expect(chPayloadTypes).toContain(EventType.TEXT_MESSAGE_END);
      expect(ch.pushLog.map((p) => p.payload.metadata.cpki_event_seq)).toEqual([
        1, 2, 3, 4,
      ]);
    });

    it("preserves runner event order with increasing cpki_event_seq", async () => {
      const threadId = "t-seq";
      const input = createRunInput({ threadId, runId: "r-seq" });

      const agent = new MockAgent([
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "msg-1",
          delta: "first",
        } as TextMessageContentEvent,
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "msg-1",
          delta: "second",
        } as TextMessageContentEvent,
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "msg-1",
          delta: "third",
        } as TextMessageContentEvent,
      ]);

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      await eventsPromise;

      expect(
        ch.pushLog.map((entry) => entry.payload.metadata.cpki_event_seq),
      ).toEqual([1, 2, 3, 4, 5]);
    });

    it("throws when the thread is already running", () => {
      const threadId = "t-dup";
      const input = createRunInput({ threadId, runId: "r-dup" });
      const agent = new MockAgent();

      // Start a run and subscribe so the Observable body executes.
      const sub = runner.run({ threadId, agent, input }).subscribe();

      expect(() => runner.run({ threadId, agent, input })).toThrow(
        "Thread already running",
      );
      sub.unsubscribe();
    });

    it("emits RUN_ERROR and completes when channel join fails", async () => {
      const threadId = "t-join-err";
      const input = createRunInput({ threadId, runId: "r-join-err" });
      const agent = new MockAgent();

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];

      ch.triggerJoin("error", { reason: "unauthorized" });

      const events = await eventsPromise;

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(EventType.RUN_ERROR);
      expect((events[0] as RunErrorEvent).message).toContain("unauthorized");
    });

    it("emits RUN_ERROR and completes when channel join times out", async () => {
      const threadId = "t-join-timeout";
      const input = createRunInput({ threadId, runId: "r-join-timeout" });
      const agent = new MockAgent();

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];

      ch.triggerJoin("timeout");

      const events = await eventsPromise;

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(EventType.RUN_ERROR);
      expect((events[0] as RunErrorEvent).message).toBe(
        "Timed out joining channel",
      );
    });
  });

  describe("run channel ownership", () => {
    it("uses runId for the ingestion channel topic", async () => {
      const threadId = "t-jc";
      const input = createRunInput({ threadId, runId: "r-jc" });
      const agent = new MockAgent([
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId: "r-jc",
        } as RunFinishedEvent,
      ]);

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      expect(ch.topic).toBe("ingestion:r-jc");
      expect(ch.params).toEqual({ thread_id: threadId, run_id: "r-jc" });
      ch.triggerJoin("ok");
      await eventsPromise;
    });

    it("keeps pushed event payload ownership on canonical threadId and runId", async () => {
      const threadId = "t-no-jc";
      const input = createRunInput({ threadId, runId: "r-no-jc" });
      const agent = new MockAgent([
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId: "r-no-jc",
        } as RunFinishedEvent,
      ]);

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");
      await eventsPromise;

      expect(ch.pushLog[0].payload).toEqual(
        expect.objectContaining({
          threadId,
          runId: "r-no-jc",
          thread_id: threadId,
          run_id: "r-no-jc",
        }),
      );
    });
  });

  describe("connect", () => {
    it("forwards thread channel events and completes on RUN_FINISHED", async () => {
      const threadId = "t-connect";

      const eventsPromise = collectEvents(runner.connect({ threadId }));
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      ch.serverPush("ag_ui_event", {
        type: EventType.RUN_STARTED,
        threadId,
        runId: "r-hist",
      } as BaseEvent);
      ch.serverPush("ag_ui_event", {
        type: EventType.RUN_FINISHED,
        threadId,
        runId: "r-hist",
      } as BaseEvent);

      const events = await eventsPromise;

      expect(events.map((e) => e.type)).toEqual([
        EventType.RUN_STARTED,
        EventType.RUN_FINISHED,
      ]);
    });

    it("does not push a CUSTOM connect event after joining", () => {
      const threadId = "t-connect-no-push";
      const sub = runner.connect({ threadId }).subscribe();
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      expect(ch.pushLog).toHaveLength(0);
      sub.unsubscribe();
    });

    it("joins the thread topic when joinCode is provided", () => {
      const threadId = "t-connect-jc";
      const sub = runner
        .connect({ threadId, joinCode: "join-connect-456" })
        .subscribe();
      const ch = mockChannels[0];

      expect(ch.topic).toBe(`thread:${threadId}`);
      sub.unsubscribe();
    });

    it("joins the thread topic when joinCode is not provided", () => {
      const threadId = "t-connect-no-jc";
      const sub = runner.connect({ threadId }).subscribe();
      const ch = mockChannels[0];

      expect(ch.topic).toBe(`thread:${threadId}`);
      sub.unsubscribe();
    });

    it("errors the observable on channel join failure", async () => {
      let error: Error | null = null;
      const promise = new Promise<void>((resolve) => {
        runner.connect({ threadId: "t-connect-err" }).subscribe({
          error: (err) => {
            error = err;
            resolve();
          },
          complete: () => resolve(),
        });
      });
      const ch = mockChannels[0];
      ch.triggerJoin("error", { reason: "unauthorized" });

      await promise;
      expect(error).toBeInstanceOf(Error);
      expect(error!.message).toContain("Failed to join channel");
    });

    it("errors the observable on channel join timeout", async () => {
      let error: Error | null = null;
      const promise = new Promise<void>((resolve) => {
        runner.connect({ threadId: "t-connect-timeout" }).subscribe({
          error: (err) => {
            error = err;
            resolve();
          },
          complete: () => resolve(),
        });
      });
      const ch = mockChannels[0];
      ch.triggerJoin("timeout");

      await promise;
      expect(error).toBeInstanceOf(Error);
      expect(error!.message).toBe("Timed out joining channel");
    });
  });

  describe("isRunning", () => {
    it("returns false for unknown threads", async () => {
      expect(await runner.isRunning({ threadId: "nope" })).toBe(false);
    });

    it("returns true while a run is active", async () => {
      const threadId = "t-running";
      const input = createRunInput({ threadId, runId: "r-running" });
      const agent = new MockAgent();
      const sub = runner.run({ threadId, agent, input }).subscribe();

      expect(await runner.isRunning({ threadId })).toBe(true);
      sub.unsubscribe();
    });

    it("returns false after a run completes", async () => {
      const threadId = "t-done";
      const input = createRunInput({ threadId, runId: "r-done" });

      const agentEvents: BaseEvent[] = [
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId: "r-done",
        } as RunFinishedEvent,
      ];
      const agent = new MockAgent(agentEvents);

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");
      await eventsPromise;

      expect(await runner.isRunning({ threadId })).toBe(false);
    });
  });

  describe("stop", () => {
    it("calls abortRun on the agent directly, no CUSTOM stop push", async () => {
      const threadId = "t-stop";
      const input = createRunInput({ threadId, runId: "r-stop" });
      const agent = new MockAgent();
      const sub = runner.run({ threadId, agent, input }).subscribe();

      const result = await runner.stop({ threadId });

      expect(result).toBe(true);
      expect(agent.aborted).toBe(true);

      const ch = mockChannels[0];
      const stopPush = ch.pushLog.find((p) => p.payload?.name === "stop");
      expect(stopPush).toBeUndefined();
      sub.unsubscribe();
    });

    it("returns false when the thread is not running", async () => {
      expect(await runner.stop({ threadId: "nope" })).toBe(false);
    });

    it("returns false when stop has already been requested", async () => {
      const threadId = "t-stop-twice";
      const input = createRunInput({ threadId, runId: "r-stop2" });
      const agent = new MockAgent();
      const sub = runner.run({ threadId, agent, input }).subscribe();

      expect(await runner.stop({ threadId })).toBe(true);
      expect(await runner.stop({ threadId })).toBe(false);
      sub.unsubscribe();
    });
  });

  describe("cleanup", () => {
    it("leaves the channel and disconnects the socket after the run completes", async () => {
      const threadId = "t-cleanup";
      const input = createRunInput({ threadId, runId: "r-cleanup" });

      const agentEvents: BaseEvent[] = [
        {
          type: EventType.RUN_FINISHED,
          threadId,
          runId: "r-cleanup",
        } as RunFinishedEvent,
      ];
      const agent = new MockAgent(agentEvents);

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");
      await eventsPromise;

      expect(ch.left).toBe(true);
      // Per-run socket should also be disconnected.
      // mockSockets[0] is the socket created for this run.
      expect(mockSockets[0].disconnected).toBe(true);
    });

    it("leaves the channel and disconnects the socket after a join failure", async () => {
      const threadId = "t-cleanup-err";
      const input = createRunInput({ threadId, runId: "r-cleanup-err" });
      const agent = new MockAgent();

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("error", { reason: "denied" });
      await eventsPromise;

      expect(ch.left).toBe(true);
      expect(mockSockets[0].disconnected).toBe(true);
    });
  });

  describe("per-run socket isolation", () => {
    it("creates a separate socket for each run", () => {
      const agent = new MockAgent();
      const sub1 = runner
        .run({
          threadId: "t-iso-1",
          agent,
          input: createRunInput({ threadId: "t-iso-1", runId: "r-1" }),
        })
        .subscribe();
      const sub2 = runner
        .run({
          threadId: "t-iso-2",
          agent,
          input: createRunInput({ threadId: "t-iso-2", runId: "r-2" }),
        })
        .subscribe();

      // Each run should create its own socket (no shared socket).
      expect(mockSockets.length).toBe(2);
      expect(mockSockets[0]).not.toBe(mockSockets[1]);

      sub1.unsubscribe();
      sub2.unsubscribe();
    });

    it("disconnecting one run's socket does not affect another", async () => {
      const agent1 = new MockAgent([
        {
          type: EventType.RUN_FINISHED,
          threadId: "t-a",
          runId: "r-a",
        } as RunFinishedEvent,
      ]);
      const agent2 = new MockAgent();

      // Start two runs
      const promise1 = collectEvents(
        runner.run({
          threadId: "t-a",
          agent: agent1,
          input: createRunInput({ threadId: "t-a", runId: "r-a" }),
        }),
      );
      const sub2 = runner
        .run({
          threadId: "t-b",
          agent: agent2,
          input: createRunInput({ threadId: "t-b", runId: "r-b" }),
        })
        .subscribe();

      // Complete run 1
      mockChannels[0].triggerJoin("ok");
      await promise1;

      // Run 1's socket is disconnected, run 2's socket is untouched.
      expect(mockSockets[0].disconnected).toBe(true);
      expect(mockSockets[1].disconnected).toBe(false);

      sub2.unsubscribe();
    });
  });

  describe("socket error exhaustion", () => {
    it("does not abort the agent on a single socket error", () => {
      const threadId = "t-single-err";
      const input = createRunInput({ threadId, runId: "r-single-err" });
      const agent = new BlockingMockAgent();

      const sub = runner.run({ threadId, agent, input }).subscribe();
      const socket = mockSockets[0];
      mockChannels[0].triggerJoin("ok");

      socket.triggerError(new Error("network blip"));

      expect(agent.aborted).toBe(false);
      sub.unsubscribe();
    });

    it("aborts the agent after 5 consecutive socket errors", async () => {
      const threadId = "t-exhaust";
      const input = createRunInput({ threadId, runId: "r-exhaust" });
      const agent = new BlockingMockAgent();

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const socket = mockSockets[0];
      mockChannels[0].triggerJoin("ok");

      // Fire 5 consecutive errors — should trigger abortRun()
      for (let i = 0; i < 5; i++) {
        socket.triggerError(new Error("connection lost"));
      }

      // The abort causes runAgent() to reject, which cascades through
      // catchError → finalize → removeThread → Observable completes.
      await eventsPromise;

      expect(agent.aborted).toBe(true);
    });

    it("resets the error counter on successful reconnection", () => {
      const threadId = "t-reset";
      const input = createRunInput({ threadId, runId: "r-reset" });
      const agent = new BlockingMockAgent();

      const sub = runner.run({ threadId, agent, input }).subscribe();
      const socket = mockSockets[0];
      mockChannels[0].triggerJoin("ok");

      // 4 errors (just below threshold)
      for (let i = 0; i < 4; i++) {
        socket.triggerError();
      }
      expect(agent.aborted).toBe(false);

      // Successful reconnect resets the counter
      socket.triggerOpen();

      // 4 more errors — still below threshold because counter was reset
      for (let i = 0; i < 4; i++) {
        socket.triggerError();
      }
      expect(agent.aborted).toBe(false);

      sub.unsubscribe();
    });

    it("fully cleans up after socket error exhaustion", async () => {
      const threadId = "t-exhaust-cleanup";
      const input = createRunInput({ threadId, runId: "r-exhaust-cleanup" });
      const agent = new BlockingMockAgent();

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const socket = mockSockets[0];
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      for (let i = 0; i < 5; i++) {
        socket.triggerError();
      }

      await eventsPromise;

      expect(ch.left).toBe(true);
      expect(socket.disconnected).toBe(true);
      expect(await runner.isRunning({ threadId })).toBe(false);
    });
  });
});
