import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAgentRunner } from "../runner/in-memory";
import { AbstractAgent, BaseEvent, EventType, RunAgentInput } from "@ag-ui/client";
import { firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";

const stripTerminalEvents = (events: BaseEvent[]) =>
  events.filter(
    (event) => event.type !== EventType.RUN_FINISHED && event.type !== EventType.RUN_ERROR,
  );

// Mock agent implementations for testing
class MockAgent extends AbstractAgent {
  private events: BaseEvent[];
  private delay: number;

  constructor(events: BaseEvent[] = [], delay: number = 0) {
    super();
    this.events = events;
    this.delay = delay;
  }

  async runAgent(
    input: RunAgentInput,
    options: { onEvent: (event: { event: BaseEvent }) => void }
  ): Promise<void> {
    for (const event of this.events) {
      if (this.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delay));
      }
      options.onEvent({ event });
    }
  }

  clone(): AbstractAgent {
    return new MockAgent(this.events, this.delay);
  }
}

class DelayedEventAgent extends AbstractAgent {
  private eventCount: number;
  private eventDelay: number;
  private prefix: string;

  constructor(eventCount: number = 5, eventDelay: number = 10, prefix: string = "delayed") {
    super();
    this.eventCount = eventCount;
    this.eventDelay = eventDelay;
    this.prefix = prefix;
  }

  async runAgent(
    input: RunAgentInput,
    options: { onEvent: (event: { event: BaseEvent }) => void }
  ): Promise<void> {
    for (let i = 0; i < this.eventCount; i++) {
      await new Promise((resolve) => setTimeout(resolve, this.eventDelay));
      options.onEvent({
        event: {
          type: "message",
          id: `${this.prefix}-${i}`,
          timestamp: new Date().toISOString(),
          data: { index: i, prefix: this.prefix }
        } as BaseEvent
      });
    }
  }

  clone(): AbstractAgent {
    return new DelayedEventAgent(this.eventCount, this.eventDelay, this.prefix);
  }
}

class ErrorThrowingAgent extends AbstractAgent {
  private throwAfterEvents: number;
  private errorMessage: string;

  constructor(throwAfterEvents: number = 2, errorMessage: string = "Test error") {
    super();
    this.throwAfterEvents = throwAfterEvents;
    this.errorMessage = errorMessage;
  }

  async runAgent(
    input: RunAgentInput,
    options: { onEvent: (event: { event: BaseEvent }) => void }
  ): Promise<void> {
    for (let i = 0; i < this.throwAfterEvents; i++) {
      options.onEvent({
        event: {
          type: "message",
          id: `error-agent-${i}`,
          timestamp: new Date().toISOString(),
          data: { index: i }
        } as BaseEvent
      });
    }
    throw new Error(this.errorMessage);
  }

  clone(): AbstractAgent {
    return new ErrorThrowingAgent(this.throwAfterEvents, this.errorMessage);
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
    options: { onEvent: (event: { event: BaseEvent }) => void }
  ): Promise<void> {
    this.shouldStop = false;
    let counter = 0;

    while (!this.shouldStop && counter < 10_000) {
      await new Promise((resolve) => setTimeout(resolve, this.eventDelay));
      const event: BaseEvent = {
        type: "message",
        id: `stoppable-${counter}`,
        timestamp: new Date().toISOString(),
        data: { counter },
      } as BaseEvent;
      options.onEvent({ event });
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
    options: { onEvent: (event: { event: BaseEvent }) => void }
  ): Promise<void> {
    this.shouldStop = false;
    const messageId = "open-message";
    const toolCallId = "open-tool";

    options.onEvent({
      event: {
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      } as BaseEvent,
    });

    options.onEvent({
      event: {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: "Partial content",
      } as BaseEvent,
    });

    options.onEvent({
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

class MultiEventAgent extends AbstractAgent {
  private runId: string;

  constructor(runId: string) {
    super();
    this.runId = runId;
  }

  async runAgent(
    input: RunAgentInput,
    options: { onEvent: (event: { event: BaseEvent }) => void }
  ): Promise<void> {
    // Emit different types of events
    const eventTypes = ["start", "message", "tool_call", "tool_result", "end"];
    
    for (const eventType of eventTypes) {
      options.onEvent({
        event: {
          type: eventType,
          id: `${this.runId}-${eventType}`,
          timestamp: new Date().toISOString(),
          data: { 
            runId: this.runId,
            eventType,
            metadata: { source: "MultiEventAgent" }
          }
        } as BaseEvent
      });
    }
  }

  clone(): AbstractAgent {
    return new MultiEventAgent(this.runId);
  }
}

describe("InMemoryAgentRunner", () => {
  let runner: InMemoryAgentRunner;

  beforeEach(() => {
    runner = new InMemoryAgentRunner();
  });

  describe("Basic Functionality", () => {
    it("should run a single agent and collect all events", async () => {
      const threadId = "test-thread-1";
      const events: BaseEvent[] = [
        { type: "start", id: "1", timestamp: new Date().toISOString(), data: {} } as BaseEvent,
        { type: "message", id: "2", timestamp: new Date().toISOString(), data: { text: "Hello" } } as BaseEvent,
        { type: "end", id: "3", timestamp: new Date().toISOString(), data: {} } as BaseEvent,
      ];

      const agent = new MockAgent(events);
      const input: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-1",
      };

      const runObservable = runner.run({ threadId, agent, input });
      const collectedEvents = await firstValueFrom(runObservable.pipe(toArray()));

      const agentEvents = stripTerminalEvents(collectedEvents);
      expect(agentEvents).toEqual(events);
    });

    it("should allow connecting after run completes and receive all past events", async () => {
      const threadId = "test-thread-3";
      const events: BaseEvent[] = [
        { type: "message", id: "past-1", timestamp: new Date().toISOString(), data: {} } as BaseEvent,
        { type: "message", id: "past-2", timestamp: new Date().toISOString(), data: {} } as BaseEvent,
      ];

      const agent = new MockAgent(events);
      const input: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-3",
      };

      // Run and wait for completion
      const runObservable = runner.run({ threadId, agent, input });
      await firstValueFrom(runObservable.pipe(toArray()));

      // Connect after completion
      const connectObservable = runner.connect({ threadId });
      const collectedEvents = await firstValueFrom(connectObservable.pipe(toArray()));

      const storedAgentEvents = stripTerminalEvents(collectedEvents);
      expect(storedAgentEvents).toEqual(events);
    });
  });

  describe("Multiple Runs", () => {
    it("should accumulate events from multiple sequential runs on same thread", async () => {
      const threadId = "test-thread-multi-1";
      
      // First run
      const agent1 = new MultiEventAgent("run-1");
      const input1: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-1",
      };

      const run1 = runner.run({ threadId, agent: agent1, input: input1 });
      await firstValueFrom(run1.pipe(toArray()));

      // Second run
      const agent2 = new MultiEventAgent("run-2");
      const input2: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-2",
      };

      const run2 = runner.run({ threadId, agent: agent2, input: input2 });
      await firstValueFrom(run2.pipe(toArray()));

      // Third run
      const agent3 = new MultiEventAgent("run-3");
      const input3: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-3",
      };

      const run3 = runner.run({ threadId, agent: agent3, input: input3 });
      await firstValueFrom(run3.pipe(toArray()));

      // Connect and verify all events
      const connectObservable = runner.connect({ threadId });
      const allEvents = await firstValueFrom(connectObservable.pipe(toArray()));

      const agentEvents = stripTerminalEvents(allEvents);
      expect(agentEvents).toHaveLength(15); // 5 events per run × 3 runs

      // Verify events from all runs are present
      const run1Events = agentEvents.filter((e) => e.id?.startsWith("run-1"));
      const run2Events = agentEvents.filter((e) => e.id?.startsWith("run-2"));
      const run3Events = agentEvents.filter((e) => e.id?.startsWith("run-3"));

      expect(run1Events).toHaveLength(5);
      expect(run2Events).toHaveLength(5);
      expect(run3Events).toHaveLength(5);

      // Verify order preservation
      const runOrder = agentEvents.map((e) => e.id?.split("-")[0] + "-" + e.id?.split("-")[1]);
      expect(runOrder.slice(0, 5).every((id) => id?.startsWith("run-1"))).toBe(true);
      expect(runOrder.slice(5, 10).every((id) => id?.startsWith("run-2"))).toBe(true);
      expect(runOrder.slice(10, 15).every((id) => id?.startsWith("run-3"))).toBe(true);
    });

    it("should handle connect during multiple runs", async () => {
      const threadId = "test-thread-multi-2";
      
      // Start first run
      const agent1 = new DelayedEventAgent(5, 20, "first");
      const input1: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-1",
      };

      const run1Observable = runner.run({ threadId, agent: agent1, input: input1 });

      // Wait a bit to ensure first run is in progress
      await new Promise(resolve => setTimeout(resolve, 50));

      // Connect during first run
      const connectObservable = runner.connect({ threadId });
      const eventCollector = firstValueFrom(connectObservable.pipe(toArray()));

      // Wait for first run to complete
      await firstValueFrom(run1Observable.pipe(toArray()));

      // Collect all events from the connect during first run
      const allEvents = await eventCollector;

      // Connect only receives events from the first run since it completes
      const firstRunAgentEvents = stripTerminalEvents(allEvents);
      expect(firstRunAgentEvents).toHaveLength(5);
      const firstRunEvents = firstRunAgentEvents.filter((e) => e.id?.startsWith("first"));

      expect(firstRunEvents).toHaveLength(5);

      // Start second run
      const agent2 = new DelayedEventAgent(3, 10, "second");
      const input2: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-2",
      };

      const run2Observable = runner.run({ threadId, agent: agent2, input: input2 });
      await firstValueFrom(run2Observable.pipe(toArray()));

      // Connect after both runs to verify all events are accumulated
      const allEventsAfter = await firstValueFrom(runner.connect({ threadId }).pipe(toArray()));
      expect(stripTerminalEvents(allEventsAfter)).toHaveLength(8); // 5 from first + 3 from second
    });

    it("should preserve event order across different agent types", async () => {
      const threadId = "test-thread-multi-3";
      
      // Run different types of agents
      const agents = [
        new MockAgent([
          { type: "mock", id: "mock-1", timestamp: new Date().toISOString(), data: {} } as BaseEvent,
          { type: "mock", id: "mock-2", timestamp: new Date().toISOString(), data: {} } as BaseEvent,
        ]),
        new MultiEventAgent("multi"),
        new DelayedEventAgent(2, 0, "delayed"),
      ];

      for (let i = 0; i < agents.length; i++) {
        const input: RunAgentInput = {
          messages: [],
          state: {},
          threadId,
          runId: `run-${i}`,
        };

        const run = runner.run({ threadId, agent: agents[i], input });
        await firstValueFrom(run.pipe(toArray()));
      }

      // Verify all events are preserved
      const connectObservable = runner.connect({ threadId });
      const allEvents = await firstValueFrom(connectObservable.pipe(toArray()));

      const agentEvents = stripTerminalEvents(allEvents);
      expect(agentEvents).toHaveLength(9); // 2 + 5 + 2

      // Verify event groups are in order
      expect(agentEvents[0].id).toBe("mock-1");
      expect(agentEvents[1].id).toBe("mock-2");
      expect(agentEvents[2].id).toContain("multi");
      expect(agentEvents[7].id).toContain("delayed");
    });
  });

  describe("Concurrent Subscribers", () => {
    it("should provide same events to multiple concurrent connect calls", async () => {
      const threadId = "test-thread-concurrent-1";
      const agent = new MultiEventAgent("concurrent");
      const input: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-concurrent",
      };

      // Run agent
      const runObservable = runner.run({ threadId, agent, input });
      await firstValueFrom(runObservable.pipe(toArray()));

      // Multiple concurrent connects
      const connect1 = runner.connect({ threadId });
      const connect2 = runner.connect({ threadId });
      const connect3 = runner.connect({ threadId });

      const [events1, events2, events3] = await Promise.all([
        firstValueFrom(connect1.pipe(toArray())),
        firstValueFrom(connect2.pipe(toArray())),
        firstValueFrom(connect3.pipe(toArray())),
      ]);

      // All should receive same events including RUN_FINISHED
      const agentEvents1 = stripTerminalEvents(events1);
      const agentEvents2 = stripTerminalEvents(events2);
      const agentEvents3 = stripTerminalEvents(events3);
      expect(agentEvents1).toHaveLength(5);
      expect(agentEvents2).toHaveLength(5);
      expect(agentEvents3).toHaveLength(5);
      expect(events1).toEqual(events2);
      expect(events2).toEqual(events3);
    });

    it("should handle late subscribers during active run", async () => {
      const threadId = "test-thread-concurrent-2";
      const agent = new DelayedEventAgent(10, 20, "late-sub");
      const input: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-late",
      };

      // Start run
      runner.run({ threadId, agent, input });

      // Connect at different times during the run
      await new Promise(resolve => setTimeout(resolve, 50)); // After ~2 events
      const connect1 = runner.connect({ threadId });
      
      await new Promise(resolve => setTimeout(resolve, 60)); // After ~5 events
      const connect2 = runner.connect({ threadId });

      await new Promise(resolve => setTimeout(resolve, 80)); // After ~9 events
      const connect3 = runner.connect({ threadId });

      const [events1, events2, events3] = await Promise.all([
        firstValueFrom(connect1.pipe(toArray())),
        firstValueFrom(connect2.pipe(toArray())),
        firstValueFrom(connect3.pipe(toArray())),
      ]);

      // All subscribers should eventually receive all events plus RUN_FINISHED
      const agentEvents1 = stripTerminalEvents(events1);
      const agentEvents2 = stripTerminalEvents(events2);
      const agentEvents3 = stripTerminalEvents(events3);
      expect(agentEvents1).toHaveLength(10);
      expect(agentEvents2).toHaveLength(10);
      expect(agentEvents3).toHaveLength(10);

      // Verify they all have the same events
      expect(events1.map(e => e.id)).toEqual(events2.map(e => e.id));
      expect(events2.map(e => e.id)).toEqual(events3.map(e => e.id));
    });
  });

  describe("Error Handling", () => {
    it("should throw error when thread is already running", async () => {
      const threadId = "test-thread-error-1";
      const agent = new DelayedEventAgent(5, 50, "blocking");
      const input: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-1",
      };

      // Start first run
      runner.run({ threadId, agent, input });

      // Try to start another run on same thread immediately
      expect(() => {
        runner.run({ threadId, agent, input });
      }).toThrow("Thread already running");
    });

    it("should handle agent errors gracefully", async () => {
      const threadId = "test-thread-error-2";
      const agent = new ErrorThrowingAgent(3, "Agent crashed!");
      const input: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-error-1",
      };

      const runObservable = runner.run({ threadId, agent, input });
      const events = await firstValueFrom(runObservable.pipe(toArray()));

      // Should still receive events emitted before error
      expect(events.at(-1)?.type).toBe(EventType.RUN_ERROR);
      const preErrorEvents = events.slice(0, -1);
      expect(preErrorEvents).toHaveLength(3);
      expect(preErrorEvents.every((e) => e.id?.startsWith("error-agent"))).toBe(true);

      // Should be able to run again after error
      const agent2 = new MockAgent([
        { type: "recovery", id: "recovery-1", timestamp: new Date().toISOString(), data: {} } as BaseEvent,
      ]);

      const input2: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-error-2",
      };

      const run2 = runner.run({ threadId, agent: agent2, input: input2 });
      const events2 = await firstValueFrom(run2.pipe(toArray()));

      const recoveryEvents = stripTerminalEvents(events2);
      expect(recoveryEvents).toHaveLength(1); // Only events from current run
      expect(recoveryEvents[0].id).toBe("recovery-1");

      // Connect should have all events including from errored run
      const allEvents = await firstValueFrom(runner.connect({ threadId }).pipe(toArray()));
      expect(allEvents.filter((event) => event.type === EventType.RUN_ERROR).length).toBeGreaterThanOrEqual(1);
      const storedAgentEvents = stripTerminalEvents(allEvents);
      expect(storedAgentEvents).toHaveLength(4); // 3 from error run + 1 from recovery
    });

    it("should properly set isRunning to false after agent error", async () => {
      const threadId = "test-thread-error-3";
      const agent = new ErrorThrowingAgent(1, "Quick fail");
      const input: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-fail",
      };

      // Run and wait for completion (even with error)
      const runObservable = runner.run({ threadId, agent, input });
      await firstValueFrom(runObservable.pipe(toArray()));
      
      // Verify thread is not running
      const isRunning = await runner.isRunning({ threadId });
      expect(isRunning).toBe(false);

      // Should be able to run again
      const agent2 = new MockAgent([
        { type: "test", id: "after-error", timestamp: new Date().toISOString(), data: {} } as BaseEvent,
      ]);

      const input2: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-fail-2",
      };

      expect(() => {
        runner.run({ threadId, agent: agent2, input: input2 });
      }).not.toThrow();
    });
  });

  describe("Edge Cases", () => {
    it("should return EMPTY observable when connecting to non-existent thread", async () => {
      const connectObservable = runner.connect({ threadId: "non-existent-thread" });
      
      // EMPTY completes immediately with no values
      let completed = false;
      let eventCount = 0;
      
      await new Promise<void>((resolve) => {
        connectObservable.subscribe({
          next: () => eventCount++,
          complete: () => {
            completed = true;
            resolve();
          }
        });
      });

      expect(completed).toBe(true);
      expect(eventCount).toBe(0);
    });

    it("should handle very large number of events", async () => {
      const threadId = "test-thread-large";
      const eventCount = 1000;
      const events: BaseEvent[] = [];

      for (let i = 0; i < eventCount; i++) {
        events.push({
          type: "bulk",
          id: `bulk-${i}`,
          timestamp: new Date().toISOString(),
          data: { index: i, payload: "x".repeat(100) }
        } as BaseEvent);
      }

      const agent = new MockAgent(events);
      const input: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-large",
      };

      // Run with large event set
      const runObservable = runner.run({ threadId, agent, input });
      await firstValueFrom(runObservable.pipe(toArray()));

      // Connect and verify all events are preserved
      const connectObservable = runner.connect({ threadId });
      const collectedEvents = await firstValueFrom(connectObservable.pipe(toArray()));

      const bulkEvents = stripTerminalEvents(collectedEvents);
      expect(bulkEvents).toHaveLength(eventCount);
      expect(bulkEvents[0].id).toBe("bulk-0");
      expect(bulkEvents[eventCount - 1].id).toBe(`bulk-${eventCount - 1}`);
    });

    it("should return false for isRunning on non-existent thread", async () => {
      const isRunning = await runner.isRunning({ threadId: "non-existent" });
      expect(isRunning).toBe(false);
    });

    it("should properly track isRunning state", async () => {
      const threadId = "test-thread-running";
      const agent = new DelayedEventAgent(5, 20, "running");
      const input: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-running",
      };

      // Check before run
      expect(await runner.isRunning({ threadId })).toBe(false);

      // Start run
      const runObservable = runner.run({ threadId, agent, input });

      // Check during run
      expect(await runner.isRunning({ threadId })).toBe(true);

      // Wait for completion
      await firstValueFrom(runObservable.pipe(toArray()));

      // Check after run
      expect(await runner.isRunning({ threadId })).toBe(false);
    });

    it("should return false when stopping a non-existent thread", async () => {
      await expect(runner.stop({ threadId: "missing-thread" })).resolves.toBe(false);
    });

    it("should stop an active run and complete streams", async () => {
      const threadId = "test-thread-stop";
      const agent = new StoppableAgent(2);
      const input: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-stop",
      };

      const run$ = runner.run({ threadId, agent, input });
      const collected = firstValueFrom(run$.pipe(toArray()));

      // Allow the run loop to start and emit a couple of events
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await runner.isRunning({ threadId })).toBe(true);

      const stopped = await runner.stop({ threadId });
      expect(stopped).toBe(true);

      const events = await collected;
      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
      expect(await runner.isRunning({ threadId })).toBe(false);
    });

    it("should close open text and tool events when stopping", async () => {
      const threadId = "test-thread-open-events";
      const agent = new OpenEventsAgent();
      const input: RunAgentInput = {
        messages: [],
        state: {},
        threadId,
        runId: "run-open",
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

    it("should handle thread isolation correctly", async () => {
      const thread1 = "test-thread-iso-1";
      const thread2 = "test-thread-iso-2";

      const agent1 = new MockAgent([
        { type: "thread1", id: "t1-event", timestamp: new Date().toISOString(), data: {} } as BaseEvent,
      ]);
      const agent2 = new MockAgent([
        { type: "thread2", id: "t2-event", timestamp: new Date().toISOString(), data: {} } as BaseEvent,
      ]);

      // Run on different threads
      const run1 = runner.run({
        threadId: thread1,
        agent: agent1,
        input: { messages: [], state: {}, threadId: thread1, runId: "run-t1" }
      });
      const run2 = runner.run({
        threadId: thread2,
        agent: agent2,
        input: { messages: [], state: {}, threadId: thread2, runId: "run-t2" }
      });

      await Promise.all([
        firstValueFrom(run1.pipe(toArray())),
        firstValueFrom(run2.pipe(toArray()))
      ]);

      // Connect to each thread
      const events1 = await firstValueFrom(runner.connect({ threadId: thread1 }).pipe(toArray()));
      const events2 = await firstValueFrom(runner.connect({ threadId: thread2 }).pipe(toArray()));

      // Verify isolation
      const thread1Events = stripTerminalEvents(events1);
      const thread2Events = stripTerminalEvents(events2);
      expect(thread1Events).toHaveLength(1);
      expect(thread1Events[0].id).toBe("t1-event");

      expect(thread2Events).toHaveLength(1);
      expect(thread2Events[0].id).toBe("t2-event");
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle rapid sequential runs with mixed event patterns", async () => {
      const threadId = "test-thread-complex-1";
      const runs = [
        { agent: new MockAgent([{ type: "instant", id: "instant-1", timestamp: new Date().toISOString(), data: {} } as BaseEvent]), runId: "run-1" },
        { agent: new DelayedEventAgent(3, 5, "delayed"), runId: "run-2" },
        { agent: new MockAgent([{ type: "instant", id: "instant-2", timestamp: new Date().toISOString(), data: {} } as BaseEvent]), runId: "run-3" },
        { agent: new MultiEventAgent("multi"), runId: "run-4" },
        { agent: new DelayedEventAgent(2, 10, "slow"), runId: "run-5" },
      ];

      for (const { agent, runId } of runs) {
        const input: RunAgentInput = {
          messages: [],
          state: {},
          threadId,
          runId,
        };

        const run = runner.run({ threadId, agent, input });
        await firstValueFrom(run.pipe(toArray()));
      }

      const allEvents = await firstValueFrom(runner.connect({ threadId }).pipe(toArray()));

      const agentEvents = stripTerminalEvents(allEvents);
      expect(agentEvents).toHaveLength(12); // 1 + 3 + 1 + 5 + 2

      // Verify event ordering
      expect(agentEvents[0].id).toBe("instant-1");
      expect(agentEvents[1].id).toContain("delayed-0");
      expect(agentEvents[4].id).toBe("instant-2");
      expect(agentEvents[5].id).toContain("multi-start");
      expect(agentEvents[10].id).toContain("slow-0");
    });

    it("should handle subscriber that connects between runs", async () => {
      const threadId = "test-thread-complex-2";
      
      // First run
      const agent1 = new MultiEventAgent("first");
      const run1 = runner.run({
        threadId,
        agent: agent1,
        input: { messages: [], state: {}, threadId, runId: "run-1" }
      });
      await firstValueFrom(run1.pipe(toArray()));

      // Connect after first run - should only get first run events
      const midConnectObservable = runner.connect({ threadId });
      const midEvents = await firstValueFrom(midConnectObservable.pipe(toArray()));

      const midAgentEvents = stripTerminalEvents(midEvents);
      expect(midAgentEvents).toHaveLength(5); // Only events from first run
      const firstRunEvents = midAgentEvents.filter((e) => e.id?.includes("first"));
      expect(firstRunEvents).toHaveLength(5);
      
      // Second run
      const agent2 = new MultiEventAgent("second");
      const run2 = runner.run({
        threadId,
        agent: agent2,
        input: { messages: [], state: {}, threadId, runId: "run-2" }
      });
      await firstValueFrom(run2.pipe(toArray()));

      // Connect after both runs to verify all events
      const allEvents = await firstValueFrom(runner.connect({ threadId }).pipe(toArray()));
      const allAgentEvents = stripTerminalEvents(allEvents);
      expect(allAgentEvents).toHaveLength(10); // Events from both runs

      const allFirstRunEvents = allAgentEvents.filter((e) => e.id?.includes("first"));
      const allSecondRunEvents = allAgentEvents.filter((e) => e.id?.includes("second"));
      expect(allFirstRunEvents).toHaveLength(5);
      expect(allSecondRunEvents).toHaveLength(5);
    });
  });
});
