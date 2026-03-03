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

// ---------------------------------------------------------------------------
// Phoenix & ws mocks
// ---------------------------------------------------------------------------

class MockPush {
  private callbacks = new Map<string, Function>();

  receive(status: string, callback: Function): MockPush {
    this.callbacks.set(status, callback);
    return this;
  }

  /** Test helper — fire a registered receive callback. */
  trigger(status: string, response?: unknown): void {
    this.callbacks.get(status)?.(response);
  }
}

class MockChannel {
  private handlers = new Map<string, Array<(payload: any) => void>>();
  pushLog: Array<{ event: string; payload: any }> = [];
  left = false;
  private joinPush = new MockPush();

  on(event: string, callback: (payload: any) => void): number {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(callback);
    return 0;
  }

  join(): MockPush {
    return this.joinPush;
  }

  push(event: string, payload: any): MockPush {
    this.pushLog.push({ event, payload });
    return new MockPush();
  }

  leave(): void {
    this.left = true;
  }

  /** Test helper — simulate the server acknowledging (or rejecting) the join. */
  triggerJoin(status: "ok" | "error", response?: unknown): void {
    this.joinPush.trigger(status, response);
  }

  /** Test helper — simulate the server pushing an AG-UI event. */
  serverPush(eventType: string, payload: BaseEvent): void {
    for (const handler of this.handlers.get(eventType) ?? []) {
      handler(payload);
    }
  }
}

/** All mock channels created during a test, in order. */
let mockChannels: MockChannel[] = [];

vi.mock("phoenix", () => ({
  Socket: class MockSocket {
    constructor(_url: string, _opts?: any) {}
    connect(): void {}
    channel(_topic: string, _params?: any): MockChannel {
      const ch = new MockChannel();
      mockChannels.push(ch);
      return ch;
    }
  },
  Channel: MockChannel,
}));

vi.mock("ws", () => ({ default: class MockWebSocket {} }));

// ---------------------------------------------------------------------------
// Mock agent — IntelligenceAgentRunner never calls runAgent(); it only needs
// the agent reference for abortRun().
// ---------------------------------------------------------------------------

class MockAgent extends AbstractAgent {
  aborted = false;

  async runAgent(): Promise<void> {
    // Not invoked by IntelligenceAgentRunner.
  }

  abortRun(): void {
    this.aborted = true;
  }

  clone(): AbstractAgent {
    return new MockAgent();
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Import under test — must come AFTER vi.mock calls so phoenix/ws are mocked.
// ---------------------------------------------------------------------------

const { IntelligenceAgentRunner } = await import("../intelligence");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IntelligenceAgentRunner", () => {
  let runner: InstanceType<typeof IntelligenceAgentRunner>;
  let agent: MockAgent;

  beforeEach(() => {
    mockChannels = [];
    agent = new MockAgent();
    runner = new IntelligenceAgentRunner({ url: "ws://localhost:4000/socket" });
  });

  // -----------------------------------------------------------------------
  // run()
  // -----------------------------------------------------------------------

  describe("run", () => {
    it("forwards AG-UI events from the channel and completes on RUN_FINISHED", async () => {
      const threadId = "t-1";
      const input = createRunInput({ threadId, runId: "r-1" });

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      const runStarted: RunStartedEvent = {
        type: EventType.RUN_STARTED,
        threadId,
        runId: "r-1",
      };
      const msgStart: TextMessageStartEvent = {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "msg-1",
        role: "assistant",
      };
      const msgContent: TextMessageContentEvent = {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "msg-1",
        delta: "Hello",
      };
      const msgEnd: TextMessageEndEvent = {
        type: EventType.TEXT_MESSAGE_END,
        messageId: "msg-1",
      };
      const runFinished: RunFinishedEvent = {
        type: EventType.RUN_FINISHED,
        threadId,
        runId: "r-1",
      };

      ch.serverPush(EventType.RUN_STARTED, runStarted);
      ch.serverPush(EventType.TEXT_MESSAGE_START, msgStart);
      ch.serverPush(EventType.TEXT_MESSAGE_CONTENT, msgContent);
      ch.serverPush(EventType.TEXT_MESSAGE_END, msgEnd);
      ch.serverPush(EventType.RUN_FINISHED, runFinished);

      const events = await eventsPromise;

      expect(events.map((e) => e.type)).toEqual([
        EventType.RUN_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.RUN_FINISHED,
      ]);
      expect((events[2] as TextMessageContentEvent).delta).toBe("Hello");
    });

    it("completes on RUN_ERROR", async () => {
      const threadId = "t-err";
      const input = createRunInput({ threadId, runId: "r-err" });

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      const runError: RunErrorEvent = {
        type: EventType.RUN_ERROR,
        message: "Something went wrong",
      };
      ch.serverPush(EventType.RUN_ERROR, runError);

      const events = await eventsPromise;

      expect(events.some((e) => e.type === EventType.RUN_ERROR)).toBe(true);
      const err = events.find(
        (e): e is RunErrorEvent => e.type === EventType.RUN_ERROR,
      );
      expect(err!.message).toBe("Something went wrong");
    });

    it("finalizes open message streams before completing", async () => {
      const threadId = "t-finalize";
      const input = createRunInput({ threadId, runId: "r-fin" });

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      // Emit an unclosed text message, then RUN_FINISHED.
      ch.serverPush(EventType.TEXT_MESSAGE_START, {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "open-msg",
        role: "assistant",
      } as BaseEvent);
      ch.serverPush(EventType.RUN_FINISHED, {
        type: EventType.RUN_FINISHED,
        threadId,
        runId: "r-fin",
      } as BaseEvent);

      const events = await eventsPromise;
      const types = events.map((e) => e.type);

      // finalizeRunEvents should have appended TEXT_MESSAGE_END for the
      // unclosed message. Since the terminal event already exists it won't
      // add another one.
      expect(types).toContain(EventType.TEXT_MESSAGE_END);
    });

    it("throws when the thread is already running", () => {
      const threadId = "t-dup";
      const input = createRunInput({ threadId, runId: "r-dup" });

      // Start a run but don't complete it.
      runner.run({ threadId, agent, input });

      expect(() => runner.run({ threadId, agent, input })).toThrow(
        "Thread already running",
      );
    });

    it("emits RUN_ERROR and completes when channel join fails", async () => {
      const threadId = "t-join-err";
      const input = createRunInput({ threadId, runId: "r-join-err" });

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

    it("pushes a CUSTOM run event to the channel after joining", () => {
      const threadId = "t-push";
      const input = createRunInput({
        threadId,
        runId: "r-push",
        messages: [{ id: "m1", role: "user", content: "hi" }],
      });

      runner.run({ threadId, agent, input });
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      expect(ch.pushLog).toHaveLength(1);
      expect(ch.pushLog[0].event).toBe(EventType.CUSTOM);
      expect(ch.pushLog[0].payload).toMatchObject({
        type: EventType.CUSTOM,
        name: "run",
        value: {
          threadId,
          runId: "r-push",
          messages: [{ id: "m1", role: "user", content: "hi" }],
        },
      });
    });
  });

  // -----------------------------------------------------------------------
  // connect()
  // -----------------------------------------------------------------------

  describe("connect", () => {
    it("forwards events and completes on RUN_FINISHED", async () => {
      const threadId = "t-connect";

      const eventsPromise = collectEvents(runner.connect({ threadId }));
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      ch.serverPush(EventType.RUN_STARTED, {
        type: EventType.RUN_STARTED,
        threadId,
        runId: "r-hist",
      } as BaseEvent);
      ch.serverPush(EventType.RUN_FINISHED, {
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

    it("pushes a CUSTOM connect event after joining", () => {
      const threadId = "t-connect-push";
      runner.connect({ threadId });
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      expect(ch.pushLog).toHaveLength(1);
      expect(ch.pushLog[0].payload).toMatchObject({
        type: EventType.CUSTOM,
        name: "connect",
        value: { threadId },
      });
    });

    it("completes immediately on channel join failure", async () => {
      const eventsPromise = collectEvents(
        runner.connect({ threadId: "t-connect-err" }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("error");

      const events = await eventsPromise;
      expect(events).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // isRunning()
  // -----------------------------------------------------------------------

  describe("isRunning", () => {
    it("returns false for unknown threads", async () => {
      expect(await runner.isRunning({ threadId: "nope" })).toBe(false);
    });

    it("returns true while a run is active", async () => {
      const threadId = "t-running";
      const input = createRunInput({ threadId, runId: "r-running" });
      runner.run({ threadId, agent, input });

      expect(await runner.isRunning({ threadId })).toBe(true);
    });

    it("returns false after a run completes", async () => {
      const threadId = "t-done";
      const input = createRunInput({ threadId, runId: "r-done" });

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");
      ch.serverPush(EventType.RUN_FINISHED, {
        type: EventType.RUN_FINISHED,
        threadId,
        runId: "r-done",
      } as BaseEvent);
      await eventsPromise;

      expect(await runner.isRunning({ threadId })).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // stop()
  // -----------------------------------------------------------------------

  describe("stop", () => {
    it("pushes a CUSTOM stop event and calls abortRun on the agent", async () => {
      const threadId = "t-stop";
      const input = createRunInput({ threadId, runId: "r-stop" });
      runner.run({ threadId, agent, input });

      const result = await runner.stop({ threadId });

      expect(result).toBe(true);
      expect(agent.aborted).toBe(true);

      const ch = mockChannels[0];
      const stopPush = ch.pushLog.find((p) => p.payload?.name === "stop");
      expect(stopPush).toBeDefined();
      expect(stopPush!.event).toBe(EventType.CUSTOM);
      expect(stopPush!.payload).toMatchObject({
        type: EventType.CUSTOM,
        name: "stop",
        value: { threadId },
      });
    });

    it("returns false when the thread is not running", async () => {
      expect(await runner.stop({ threadId: "nope" })).toBe(false);
    });

    it("returns false when stop has already been requested", async () => {
      const threadId = "t-stop-twice";
      const input = createRunInput({ threadId, runId: "r-stop2" });
      runner.run({ threadId, agent, input });

      expect(await runner.stop({ threadId })).toBe(true);
      expect(await runner.stop({ threadId })).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  describe("cleanup", () => {
    it("leaves the channel after the run completes", async () => {
      const threadId = "t-cleanup";
      const input = createRunInput({ threadId, runId: "r-cleanup" });

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("ok");
      ch.serverPush(EventType.RUN_FINISHED, {
        type: EventType.RUN_FINISHED,
        threadId,
        runId: "r-cleanup",
      } as BaseEvent);
      await eventsPromise;

      expect(ch.left).toBe(true);
    });

    it("leaves the channel after a join failure", async () => {
      const threadId = "t-cleanup-err";
      const input = createRunInput({ threadId, runId: "r-cleanup-err" });

      const eventsPromise = collectEvents(
        runner.run({ threadId, agent, input }),
      );
      const ch = mockChannels[0];
      ch.triggerJoin("error", { reason: "denied" });
      await eventsPromise;

      expect(ch.left).toBe(true);
    });
  });
});
