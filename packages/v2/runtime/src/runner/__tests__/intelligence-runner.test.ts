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
import { MockChannel } from "../../../../core/src/__tests__/test-utils";

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
    runner = new IntelligenceAgentRunner({ url: "ws://localhost:4000/socket" });
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

      // Agent events should be pushed to the channel under "ag-ui"
      expect(ch.pushLog.every((p) => p.event === "ag-ui")).toBe(true);
      const payloadTypes = ch.pushLog.map((p) => p.payload.type);
      expect(payloadTypes).toContain(EventType.RUN_STARTED);
      expect(payloadTypes).toContain(EventType.TEXT_MESSAGE_CONTENT);
      expect(payloadTypes).toContain(EventType.RUN_FINISHED);
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
      expect(errorPush!.payload.message).toBe("Something went wrong");
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
      expect(chPayloadTypes).toContain(EventType.TEXT_MESSAGE_START);
      expect(chPayloadTypes).toContain(EventType.TEXT_MESSAGE_END);
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
  });

  describe("connect", () => {
    it("forwards events and completes on RUN_FINISHED", async () => {
      const threadId = "t-connect";

      const eventsPromise = collectEvents(runner.connect({ threadId }));
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      ch.serverPush("ag-ui", {
        type: EventType.RUN_STARTED,
        threadId,
        runId: "r-hist",
      } as BaseEvent);
      ch.serverPush("ag-ui", {
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
      const sub = runner.connect({ threadId }).subscribe();
      const ch = mockChannels[0];
      ch.triggerJoin("ok");

      expect(ch.pushLog).toHaveLength(1);
      expect(ch.pushLog[0].payload).toMatchObject({
        type: EventType.CUSTOM,
        name: "connect",
        value: { threadId },
      });
      sub.unsubscribe();
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
    it("leaves the channel after the run completes", async () => {
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
    });

    it("leaves the channel after a join failure", async () => {
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
    });
  });
});
