import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  InMemoryAgentRunner,
  ɵINMEMORY_DEFAULTS,
  ɵGLOBAL_STORE,
} from "../in-memory";
import type { InMemoryThread } from "../in-memory";
import type {
  BaseEvent,
  Message,
  RunAgentInput,
  RunAgentResult,
  RunErrorEvent,
  RunStartedEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageStartEvent,
  ToolCallResultEvent,
} from "@ag-ui/client";
import { AbstractAgent, EventType, verifyEvents } from "@ag-ui/client";
import { EMPTY, Observable, firstValueFrom } from "rxjs";
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
  ): Promise<RunAgentResult> {
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
    return { result: undefined, newMessages: [] };
  }

  clone(): AbstractAgent {
    return new TestAgent(this.events, this.emitDefaultRunStarted);
  }

  run(): ReturnType<AbstractAgent["run"]> {
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

  async runAgent(): Promise<RunAgentResult> {
    throw this.error;
  }

  clone(): AbstractAgent {
    return new ThrowingAgent(this.error);
  }

  run(): ReturnType<AbstractAgent["run"]> {
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
            input: {
              threadId,
              runId: "run-1",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
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
              tools: [],
              context: [],
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
              tools: [],
              context: [],
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
        tools: [],
        context: [],
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
              tools: [],
              context: [],
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
            input: {
              threadId,
              runId: "run-1",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
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
            input: {
              threadId,
              runId: "run-1",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
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
            input: {
              threadId,
              runId: "run-err",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
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
            input: {
              threadId,
              runId: "run-err-2",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const errorEvent = events.find(
        (event): event is RunErrorEvent => event.type === EventType.RUN_ERROR,
      );

      expect(errorEvent).toBeDefined();
      expect(errorEvent!.message).toBe("Connection refused");
    });

    it("does not persist a phantom historic run when the agent throws before emitting any event", async () => {
      // Regression: `finalizeRunEvents` mutates `currentRunEvents` in place and
      // always appends a synthetic terminal (RUN_ERROR) when the stream ended
      // without one. The persistence guard therefore MUST gate on the count of
      // real events captured BEFORE finalization — otherwise an immediate throw
      // that emitted nothing is still persisted as a run holding only the
      // synthetic terminal (issue: phantom historic run).
      const threadId = "in-memory-phantom-run";
      const agent = new ThrowingAgent(new Error("boom before any event"));

      // The stream itself still terminates with a RUN_ERROR (finalization is
      // about the streamed contract, independent of persistence).
      const streamed = await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: {
              threadId,
              runId: "run-phantom",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );
      expect(streamed.some((e) => e.type === EventType.RUN_ERROR)).toBe(true);

      // No phantom run: the thread must not surface anywhere.
      expect(
        runner.listThreads().some((t: InMemoryThread) => t.id === threadId),
      ).toBe(false);
      expect(runner.getThreadEvents(threadId)).toEqual([]);

      // A subsequent successful run on the same thread must chain to null, not
      // to the phantom run's id.
      const followUp = new TestAgent([
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: "m-after",
          role: "assistant",
        } as TextMessageStartEvent,
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: "m-after",
        } as TextMessageEndEvent,
      ]);
      await firstValueFrom(
        runner
          .run({
            threadId,
            agent: followUp,
            input: {
              threadId,
              runId: "run-after-phantom",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const store = ɵGLOBAL_STORE.peek(threadId)!;
      expect(store.historicRuns).toHaveLength(1);
      expect(store.historicRuns[0]!.runId).toBe("run-after-phantom");
      expect(store.historicRuns[0]!.parentRunId).toBeNull();
    });
  });

  describe("Subject buffer release", () => {
    it("releases the ReplaySubject buffers after a run completes but keeps history", async () => {
      const threadId = "release-1";
      const agent = new TestAgent([
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: "m1",
          role: "assistant",
        } as TextMessageStartEvent,
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: "m1",
        } as TextMessageEndEvent,
      ]);

      await firstValueFrom(
        runner
          .run({
            threadId,
            agent,
            input: {
              threadId,
              runId: "r1",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      // After completion the runner must not lose history: getThreadEvents
      // rebuilds from historicRuns even though the live subject was released.
      const events = runner.getThreadEvents(threadId);
      expect(events.length).toBeGreaterThan(0);
      const messageIds = events
        .filter((e) => "messageId" in e)
        .map((e) => (e as { messageId?: string }).messageId);
      expect(messageIds).toContain("m1");
    });

    it("replays full history across a run boundary via historicRuns, not the live subject", async () => {
      const threadId = "boundary-1";

      const run1 = new TestAgent([
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: "a",
          role: "assistant",
        } as TextMessageStartEvent,
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: "a",
        } as TextMessageEndEvent,
      ]);
      await firstValueFrom(
        runner
          .run({
            threadId,
            agent: run1,
            input: {
              threadId,
              runId: "r1",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const run2 = new TestAgent([
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: "b",
          role: "assistant",
        } as TextMessageStartEvent,
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: "b",
        } as TextMessageEndEvent,
      ]);
      await firstValueFrom(
        runner
          .run({
            threadId,
            agent: run2,
            input: {
              threadId,
              runId: "r2",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      // A fresh connect after both runs must see BOTH runs' events. Since the
      // live subject is released on completion, this replay proves the events
      // come from historicRuns rather than a retained subject buffer.
      const connected = await firstValueFrom(
        runner.connect({ threadId }).pipe(toArray()),
      );
      const messageIds = connected
        .filter((e) => "messageId" in e)
        .map((e) => (e as { messageId?: string }).messageId);
      expect(messageIds).toContain("a");
      expect(messageIds).toContain("b");
    });
  });

  describe("Bounding (integration + regression)", () => {
    // Each test in this block sets tighter limits on the process-global store.
    // A no-arg `new InMemoryAgentRunner()` is inert (the constructor only calls
    // setLimits when limits are passed), so restoring defaults requires passing
    // ɵINMEMORY_DEFAULTS explicitly. Do it after every test so no leaked limit
    // can poison a later/reordered sibling that assumes defaults.
    afterEach(() => {
      new InMemoryAgentRunner(ɵINMEMORY_DEFAULTS);
    });

    it("warns once when a second runner clobbers a customized shared-store config, but not on first customization or identical re-set", () => {
      // The clobber warn-once latch lives on the process-global store and is
      // never reset by clear(). Reset the private config latches here so this
      // test is deterministic regardless of sibling ordering.
      const store = ɵGLOBAL_STORE as unknown as {
        limitsExplicitlySet: boolean;
        clobberWarned: boolean;
      };
      store.limitsExplicitlySet = false;
      store.clobberWarned = false;

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        // First runner with custom limits (over defaults) → intended override, NO clobber warn.
        new InMemoryAgentRunner({ maxThreads: 5 });
        expect(warn).not.toHaveBeenCalled();

        // Second runner with IDENTICAL limits → NO warn.
        new InMemoryAgentRunner({ maxThreads: 5 });
        expect(warn).not.toHaveBeenCalled();

        // Second (different) runner → clobber warn exactly ONCE.
        new InMemoryAgentRunner({ maxThreads: 10 });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain("last-constructed");

        // Third differing runner → still warn-once.
        new InMemoryAgentRunner({ maxThreads: 20 });
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
        // Restore config latches so the afterEach default-restore and later
        // suites are not perturbed by this test's manipulation.
        store.limitsExplicitlySet = false;
        store.clobberWarned = false;
      }
    });

    it("partial construction preserves previously-customized sibling bounds (no silent reset to defaults)", () => {
      // Establish a known all-defaults baseline, then clear the config latches so
      // the clobber warn-once path is deterministic regardless of sibling order.
      new InMemoryAgentRunner(ɵINMEMORY_DEFAULTS);
      const latches = ɵGLOBAL_STORE as unknown as {
        limitsExplicitlySet: boolean;
        clobberWarned: boolean;
      };
      latches.limitsExplicitlySet = false;
      latches.clobberWarned = false;
      try {
        new InMemoryAgentRunner({ maxThreads: 5 });
        expect(ɵGLOBAL_STORE.ɵlimits.maxThreads).toBe(5);

        // Tuning ONLY maxBytes must leave the previously-customized maxThreads
        // intact — a partial update is a partial update, not a reset of every
        // field the caller did not mention.
        new InMemoryAgentRunner({ maxBytes: 1_000 });
        expect(ɵGLOBAL_STORE.ɵlimits.maxThreads).toBe(5); // preserved, NOT reset to 1000
        expect(ɵGLOBAL_STORE.ɵlimits.maxBytes).toBe(1_000);
        // The field nobody ever customized stays at its default.
        expect(ɵGLOBAL_STORE.ɵlimits.maxRunsPerThread).toBe(
          ɵINMEMORY_DEFAULTS.maxRunsPerThread,
        );
      } finally {
        latches.limitsExplicitlySet = false;
        latches.clobberWarned = false;
      }
    });

    it("full construction with ɵINMEMORY_DEFAULTS restores every bound to its default", () => {
      // Customize all three bounds, then confirm a full-defaults construction
      // (the afterEach reset path) fully restores them.
      new InMemoryAgentRunner({
        maxThreads: 3,
        maxRunsPerThread: 7,
        maxBytes: 42,
      });
      expect(ɵGLOBAL_STORE.ɵlimits).toEqual({
        maxThreads: 3,
        maxRunsPerThread: 7,
        maxBytes: 42,
      });
      new InMemoryAgentRunner(ɵINMEMORY_DEFAULTS);
      expect(ɵGLOBAL_STORE.ɵlimits).toEqual(ɵINMEMORY_DEFAULTS);
    });

    it("warn-once holds under partial updates: a partial update that changes nothing never warns", () => {
      new InMemoryAgentRunner(ɵINMEMORY_DEFAULTS); // known baseline
      const latches = ɵGLOBAL_STORE as unknown as {
        limitsExplicitlySet: boolean;
        clobberWarned: boolean;
      };
      latches.limitsExplicitlySet = false;
      latches.clobberWarned = false;

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        new InMemoryAgentRunner({ maxThreads: 5 }); // first explicit → no warn
        expect(warn).not.toHaveBeenCalled();

        // Partial update naming a DIFFERENT field at its current (default) value:
        // coalesced against the live config it resolves to the identical config,
        // so it must NOT warn (and would spuriously warn if coalesced against
        // ɵINMEMORY_DEFAULTS, which would resurrect maxThreads=default).
        new InMemoryAgentRunner({
          maxRunsPerThread: ɵINMEMORY_DEFAULTS.maxRunsPerThread,
        });
        expect(warn).not.toHaveBeenCalled();

        // Re-set maxThreads to its current value via a partial update → identical
        // → still no warn.
        new InMemoryAgentRunner({ maxThreads: 5 });
        expect(warn).not.toHaveBeenCalled();

        // A partial update that GENUINELY changes a field warns exactly once…
        new InMemoryAgentRunner({ maxBytes: 2_000 });
        expect(warn).toHaveBeenCalledTimes(1);

        // …and the sibling bound customized earlier is still intact.
        expect(ɵGLOBAL_STORE.ɵlimits.maxThreads).toBe(5);

        // A later differing partial update stays warn-once.
        new InMemoryAgentRunner({ maxBytes: 3_000 });
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
        latches.limitsExplicitlySet = false;
        latches.clobberWarned = false;
      }
    });

    it("stays bounded in thread count under a small maxThreads", async () => {
      const boundedRunner = new InMemoryAgentRunner({ maxThreads: 5 });
      boundedRunner.clearThreads();
      for (let i = 0; i < 50; i++) {
        const agent = new TestAgent([
          {
            type: EventType.TEXT_MESSAGE_START,
            messageId: `m${i}`,
            role: "assistant",
          } as TextMessageStartEvent,
          {
            type: EventType.TEXT_MESSAGE_END,
            messageId: `m${i}`,
          } as TextMessageEndEvent,
        ]);
        await firstValueFrom(
          boundedRunner
            .run({
              threadId: `t${i}`,
              agent,
              input: {
                threadId: `t${i}`,
                runId: `r${i}`,
                messages: [],
                state: {},
                tools: [],
                context: [],
              },
            })
            .pipe(toArray()),
        );
      }
      expect(boundedRunner.listThreads().length).toBeLessThanOrEqual(5);
    });

    it("stays bounded in runs-per-thread under a small maxRunsPerThread", async () => {
      const boundedRunner = new InMemoryAgentRunner({ maxRunsPerThread: 3 });
      boundedRunner.clearThreads();
      for (let i = 0; i < 20; i++) {
        const agent = new TestAgent([
          {
            type: EventType.TEXT_MESSAGE_START,
            messageId: `m${i}`,
            role: "assistant",
          } as TextMessageStartEvent,
          {
            type: EventType.TEXT_MESSAGE_END,
            messageId: `m${i}`,
          } as TextMessageEndEvent,
        ]);
        await firstValueFrom(
          boundedRunner
            .run({
              threadId: "single",
              agent,
              input: {
                threadId: "single",
                runId: `r${i}`,
                messages: [],
                state: {},
                tools: [],
                context: [],
              },
            })
            .pipe(toArray()),
        );
      }
      // getThreadEvents replays only retained runs — bounded, not 20 runs'
      // worth. Each run contributes one TEXT_MESSAGE_START, so counting starts
      // proves the thread did not accumulate all 20 runs.
      const events = boundedRunner.getThreadEvents("single");
      const starts = events.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_START,
      ).length;
      expect(starts).toBeLessThanOrEqual(3);
    });

    // This is THE end-to-end OOM regression guard. It deliberately does NOT
    // gate on `--expose-gc` and does NOT rest its value on a raw-heap
    // measurement: without a forced GC, `process.memoryUsage().heapUsed` is
    // dominated by V8 allocation noise, so a heap-delta assertion passes even
    // with bounding removed (the original defect). Instead this drives workloads
    // that DEMONSTRABLY cross each real bound and asserts, through the runner's
    // own public surface, that eviction fired. Neutering any single eviction
    // path (enforceRunCap / evictThreadsIfNeeded / evictByBytesIfNeeded) turns a
    // corresponding assertion below RED — which is what makes this a real guard
    // rather than a green light that proves nothing.
    it("evicts to keep thread count, runs-per-thread, and byte total bounded under a sustained workload (real OOM guard)", async () => {
      const driveRun = async (
        r: InMemoryAgentRunner,
        threadId: string,
        runId: string,
        delta: string,
      ) => {
        const agent = new TestAgent([
          {
            type: EventType.TEXT_MESSAGE_START,
            messageId: runId,
            role: "assistant",
          } as TextMessageStartEvent,
          {
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: runId,
            delta,
          } as TextMessageContentEvent,
          {
            type: EventType.TEXT_MESSAGE_END,
            messageId: runId,
          } as TextMessageEndEvent,
        ]);
        await firstValueFrom(
          r
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

      // ── Phase 1: thread-count + runs-per-thread eviction ──────────────────
      // maxBytes is deliberately non-binding here so thread eviction and run-cap
      // eviction are the ONLY forces trimming history — each assertion below is
      // then cleanly attributable to a single eviction path (neutering
      // evictThreadsIfNeeded flips the size assertion; neutering enforceRunCap
      // flips the per-thread starts assertion).
      const maxThreads = 20;
      const maxRunsPerThread = 4;
      const threadCount = 80; // > maxThreads → thread eviction MUST fire
      const runsPerThread = 6; // > maxRunsPerThread → run-cap MUST fire
      expect(threadCount).toBeGreaterThan(maxThreads);
      expect(runsPerThread).toBeGreaterThan(maxRunsPerThread);

      const countRunner = new InMemoryAgentRunner({
        maxThreads,
        maxRunsPerThread,
        maxBytes: ɵINMEMORY_DEFAULTS.maxBytes, // non-binding
      });
      countRunner.clearThreads();

      for (let t = 0; t < threadCount; t++) {
        for (let run = 0; run < runsPerThread; run++) {
          await driveRun(countRunner, `t${t}`, `t${t}-r${run}`, "x".repeat(64));
        }
      }

      // Thread eviction fired: the live thread count is pinned at/under
      // maxThreads even though 80 distinct threads were driven.
      expect(ɵGLOBAL_STORE.size).toBeLessThanOrEqual(maxThreads);
      const retained = countRunner.listThreads();
      expect(retained.length).toBeLessThanOrEqual(maxThreads);
      expect(retained.length).toBeGreaterThan(0);

      // Run-cap eviction fired: every retained thread replays at most
      // maxRunsPerThread runs' worth of history, though 6 runs were driven on
      // each. Each run contributes exactly one TEXT_MESSAGE_START with a unique
      // messageId, so counting starts across the compacted history is a faithful
      // count of retained runs.
      for (const thread of retained) {
        const starts = countRunner
          .getThreadEvents(thread.id)
          .filter((e) => e.type === EventType.TEXT_MESSAGE_START).length;
        expect(starts).toBeGreaterThan(0);
        expect(starts).toBeLessThanOrEqual(maxRunsPerThread);
      }

      // ── Phase 2: byte-total eviction ──────────────────────────────────────
      // Thread/run caps are non-binding here so the ONLY force keeping the store
      // bounded is byte eviction. One run per thread — each well under maxBytes
      // on its own — means the byte ceiling is always satisfiable by dropping
      // OTHER LRU threads, so the post-run total must never exceed the ceiling.
      const maxBytes = 20_000;
      const byteThreadCount = 100;
      const bigDelta = "x".repeat(1000);
      const byteRunner = new InMemoryAgentRunner({
        maxThreads: 1_000_000, // non-binding
        maxRunsPerThread: 1_000_000, // non-binding
        maxBytes,
      });
      byteRunner.clearThreads();

      for (let t = 0; t < byteThreadCount; t++) {
        await driveRun(byteRunner, `b${t}`, `b${t}-r0`, bigDelta);
      }

      // The unbounded total would be ~byteThreadCount × per-run bytes, which far
      // exceeds maxBytes — so the byte bound is genuinely crossed.
      expect(byteThreadCount * bigDelta.length).toBeGreaterThan(maxBytes);
      // Byte eviction held the ceiling...
      expect(ɵGLOBAL_STORE.byteTotal).toBeLessThanOrEqual(maxBytes);
      // ...by dropping whole LRU threads, so far fewer than the 100 driven
      // remain resident.
      expect(ɵGLOBAL_STORE.size).toBeLessThan(byteThreadCount);
      expect(ɵGLOBAL_STORE.size).toBeGreaterThan(0);
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

  run(): ReturnType<AbstractAgent["run"]> {
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
    // Reset the module-level sharedStore singleton so tests don't leak into each other
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

    it("returns a defensive copy so callers cannot mutate stored state", () => {
      // A3: getThreadMessages must not hand out the thread-level
      // `messagesSnapshot` array by reference, or a caller mutating it would
      // corrupt the stored snapshot and desync its byte accounting: the
      // snapshot's size is captured once (into `approxMessagesSnapshotBytes`,
      // folded into the store's `totalBytes`) when the run is appended, so a
      // caller-driven push/clear would leave `totalBytes` describing contents
      // that no longer exist.
      const first = runner.getThreadMessages("list-threads-thread-1");
      expect(first).toHaveLength(2);
      first.push({ id: "injected", role: "user", content: "tamper" });
      first.length = 0; // clear the returned array entirely
      const second = runner.getThreadMessages("list-threads-thread-1");
      expect(second).toHaveLength(2); // stored state unaffected
    });

    it("returns a shallow (array-level) copy: a distinct array that shares element identity", () => {
      // R6-1: getThreadMessages returns a SHALLOW copy — a fresh array (so array
      // structure is isolated, covered above) whose elements are the SAME Message
      // object references as the stored snapshot. It deliberately does NOT deep-copy:
      // `structuredClone` throws DataCloneError on a non-cloneable message field,
      // wedging the thread. The known limitation — tracked as follow-up — is that
      // mutating a returned message's FIELD is NOT isolated; callers must treat
      // returned messages as read-only.
      const first = runner.getThreadMessages("list-threads-thread-1");
      const second = runner.getThreadMessages("list-threads-thread-1");
      // Distinct array instances (array-level isolation).
      expect(first).not.toBe(second);
      // ...but element identity is shared (shallow copy, not deep).
      expect(first[0]).toBe(second[0]);
    });

    it("keeps the thread snapshot when a later empty-snapshot run is appended", () => {
      // R3-1: the message snapshot is held at the thread level, decoupled from
      // historicRuns. An error-path / non-array-messages run stores an empty
      // per-run snapshot, but must NOT disturb the thread-level snapshot.
      // Appending an empty run directly leaves getThreadMessages intact.
      const store = ɵGLOBAL_STORE.peek("list-threads-thread-1")!;
      store.historicRuns.push({
        threadId: "list-threads-thread-1",
        runId: "run-empty",
        agentId: "test-agent",
        parentRunId: null,
        events: [],
        messages: [],
        createdAt: Date.now(),
      });
      const messages = runner.getThreadMessages("list-threads-thread-1");
      expect(messages).toHaveLength(2); // thread snapshot untouched
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

    it("returns a defensive copy so mutating the result can't corrupt stored state", async () => {
      const snapshot = { counter: 7, name: "alpha" };
      const stateAgent = new TestAgent(
        [{ type: EventType.STATE_SNAPSHOT, snapshot } as BaseEvent],
        true,
      );
      await firstValueFrom(
        runner
          .run({
            threadId: "thread-defensive-state",
            agent: stateAgent,
            input: {
              threadId: "thread-defensive-state",
              runId: "run-defensive-1",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      const returned = runner.getThreadState("thread-defensive-state");
      expect(returned).toEqual({ counter: 7, name: "alpha" });

      // Mutating the returned object must not affect stored thread state.
      // Guards the defensive shallow-copy return in getThreadState so the
      // contract holds regardless of whether the upstream compactEvents
      // helper happens to clone events on its own.
      (returned as Record<string, unknown>).counter = 999;
      (returned as Record<string, unknown>).injected = true;

      expect(runner.getThreadState("thread-defensive-state")).toEqual({
        counter: 7,
        name: "alpha",
      });
    });

    it("returns null when the last STATE_SNAPSHOT snapshot is an array", async () => {
      // `typeof [] === "object"` is true; an array snapshot violates the
      // Record<string, unknown> | null contract and must yield null.
      const stateAgent = new TestAgent(
        [
          {
            type: EventType.STATE_SNAPSHOT,
            snapshot: [1, 2, 3],
          } as BaseEvent,
        ],
        true,
      );
      await firstValueFrom(
        runner
          .run({
            threadId: "thread-array-state",
            agent: stateAgent,
            input: {
              threadId: "thread-array-state",
              runId: "run-array-1",
              messages: [],
              state: {},
              tools: [],
              context: [],
            },
          })
          .pipe(toArray()),
      );

      expect(runner.getThreadState("thread-array-state")).toBeNull();
    });
  });
});

describe("InMemoryAgentRunner onConcurrentRun", () => {
  class HangingAgent extends AbstractAgent {
    async runAgent(): Promise<RunAgentResult> {
      // Never resolves — models a wedged / suspended (e.g. HITL) run.
      return new Promise<RunAgentResult>(() => {});
    }
    clone(): AbstractAgent {
      return new HangingAgent();
    }
    run(): ReturnType<AbstractAgent["run"]> {
      return EMPTY;
    }
  }

  // Emits its own RUN_STARTED then hangs until aborted, at which point its run
  // rejects — modeling a real agent wired to an AbortController (unlike
  // HangingAgent, this exercises the abort→teardown path).
  class AbortableAgent extends AbstractAgent {
    private rejectRun?: (err: Error) => void;
    async runAgent(
      input: RunAgentInput,
      options: {
        onEvent: (e: { event: BaseEvent }) => void;
        onRunStartedEvent?: () => void;
      },
    ): Promise<RunAgentResult> {
      options.onEvent({
        event: {
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        } as RunStartedEvent,
      });
      options.onRunStartedEvent?.();
      return new Promise<RunAgentResult>((_resolve, reject) => {
        this.rejectRun = reject;
      });
    }
    abortRun(): void {
      this.rejectRun?.(new Error("aborted by supersede"));
    }
    clone(): AbstractAgent {
      return new AbortableAgent();
    }
    run(): ReturnType<AbstractAgent["run"]> {
      return EMPTY;
    }
  }

  // Emits RUN_STARTED and then stays in flight until the test pushes further
  // events and finishes it — lets a test observe a LIVE stream through connect().
  class ControllableAgent extends AbstractAgent {
    private emit?: (event: BaseEvent) => void;
    private finish?: () => void;
    async runAgent(
      input: RunAgentInput,
      options: {
        onEvent: (e: { event: BaseEvent }) => void;
        onRunStartedEvent?: () => void;
      },
    ): Promise<RunAgentResult> {
      this.emit = (event) => options.onEvent({ event });
      this.emit({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as RunStartedEvent);
      options.onRunStartedEvent?.();
      return new Promise<RunAgentResult>((resolve) => {
        this.finish = () => resolve({ result: undefined, newMessages: [] });
      });
    }
    emitEvent(event: BaseEvent): void {
      this.emit?.(event);
    }
    finishRun(): void {
      this.finish?.();
    }
    clone(): AbstractAgent {
      return new ControllableAgent();
    }
    run(): ReturnType<AbstractAgent["run"]> {
      return EMPTY;
    }
  }

  const makeInput = (threadId: string, runId: string): RunAgentInput => ({
    threadId,
    runId,
    messages: [],
    state: {},
    tools: [],
    context: [],
  });

  it("throws 'Thread already running' by default when a run is in flight", () => {
    const runner = new InMemoryAgentRunner();
    const threadId = "concurrent-throw";
    runner.run({
      threadId,
      agent: new HangingAgent(),
      input: makeInput(threadId, "run-1"),
    });
    expect(() =>
      runner.run({
        threadId,
        agent: new HangingAgent(),
        input: makeInput(threadId, "run-2"),
      }),
    ).toThrow("Thread already running");
  });

  it("supersedes an in-flight run when configured, and the new run streams", async () => {
    const runner = new InMemoryAgentRunner({ onConcurrentRun: "supersede" });
    const threadId = "concurrent-supersede";
    // Wedge the thread with a run that never resolves (isRunning stays true).
    runner.run({
      threadId,
      agent: new HangingAgent(),
      input: makeInput(threadId, "run-1"),
    });
    // A new turn on the same thread must NOT throw — it supersedes and streams.
    const events = await firstValueFrom(
      runner
        .run({
          threadId,
          agent: new TestAgent(),
          input: makeInput(threadId, "run-2"),
        })
        .pipe(toArray()),
    );
    expect(events.some((e) => e.type === EventType.RUN_STARTED)).toBe(true);
  });

  it("a superseded run does not persist history under the new run's id", async () => {
    const runner = new InMemoryAgentRunner({ onConcurrentRun: "supersede" });
    const threadId = "concurrent-supersede-history";
    // run-1 emits its own RUN_STARTED (runId "run-1"), then hangs until aborted.
    runner.run({
      threadId,
      agent: new AbortableAgent(),
      input: makeInput(threadId, "run-1"),
    });
    // run-2 supersedes → run-1 is aborted → its async teardown runs.
    await firstValueFrom(
      runner
        .run({
          threadId,
          agent: new TestAgent(),
          input: makeInput(threadId, "run-2"),
        })
        .pipe(toArray()),
    );
    await new Promise((r) => setTimeout(r, 20)); // let run-1's abort teardown settle

    const events = runner.getThreadEvents(threadId);
    // The superseded run must NOT persist its events — and never under run-2's id.
    expect(
      events.some((e) => (e as { runId?: string }).runId === "run-1"),
    ).toBe(false);
    expect(
      events.some(
        (e) =>
          e.type === EventType.RUN_STARTED &&
          (e as { runId?: string }).runId === "run-2",
      ),
    ).toBe(true);
  });

  it("a superseded run's teardown does not release the superseding run's live subject", async () => {
    // Bounding releases `store.subject` on run completion so the infinite
    // ReplaySubject buffer can be collected. Under supersede, the OLD run
    // finalizes AFTER the new run has already installed its own subject, so the
    // release must be identity-guarded — otherwise it nulls the live subject and
    // connect() silently stops bridging the in-flight run.
    const runner = new InMemoryAgentRunner({ onConcurrentRun: "supersede" });
    const threadId = "concurrent-supersede-live-connect";

    runner.run({
      threadId,
      agent: new AbortableAgent(),
      input: makeInput(threadId, "run-1"),
    });

    const live = new ControllableAgent();
    runner.run({ threadId, agent: live, input: makeInput(threadId, "run-2") });
    await new Promise((r) => setTimeout(r, 20)); // let run-1's abort teardown settle

    const received: BaseEvent[] = [];
    runner.connect({ threadId }).subscribe((event) => received.push(event));

    live.emitEvent({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "live-1",
      role: "assistant",
    } as TextMessageStartEvent);
    live.emitEvent({
      type: EventType.TEXT_MESSAGE_END,
      messageId: "live-1",
    } as TextMessageEndEvent);
    live.finishRun();
    await new Promise((r) => setTimeout(r, 20));

    expect(
      received.some(
        (e) => (e as { messageId?: string }).messageId === "live-1",
      ),
    ).toBe(true);
  });

  it("a superseded run's terminal events never leak into the superseding run's stream", async () => {
    // Symptom 3: the dying run's teardown emits a terminal event and its
    // buffered RUN_STARTED must NOT reach the live run's subject. A connect()
    // subscriber on the thread must therefore see exactly ONE RUN_STARTED (the
    // live run's) and NO RUN_ERROR from the superseded run. This is a NEGATIVE
    // assertion the pre-existing presence test cannot make.
    const runner = new InMemoryAgentRunner({ onConcurrentRun: "supersede" });
    const threadId = "concurrent-supersede-no-leak";

    // run-1 emits its own RUN_STARTED (runId "run-1"), then hangs until aborted.
    runner.run({
      threadId,
      agent: new AbortableAgent(),
      input: makeInput(threadId, "run-1"),
    });

    const live = new ControllableAgent();
    runner.run({ threadId, agent: live, input: makeInput(threadId, "run-2") });
    await new Promise((r) => setTimeout(r, 20)); // let run-1's abort teardown settle

    const received: BaseEvent[] = [];
    runner.connect({ threadId }).subscribe((event) => received.push(event));

    // Keep run-2 LIVE (do not finish it): a live run emits no terminal of its
    // own, so any RUN_ERROR in `received` could only be the dead run's leaked
    // terminal. run-1's buffered RUN_STARTED would likewise surface as a second
    // RUN_STARTED.
    live.emitEvent({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "live-1",
      role: "assistant",
    } as TextMessageStartEvent);
    live.emitEvent({
      type: EventType.TEXT_MESSAGE_END,
      messageId: "live-1",
    } as TextMessageEndEvent);
    await new Promise((r) => setTimeout(r, 20));

    // Sanity: the live run's own events must flow through connect().
    expect(
      received.some(
        (e) => (e as { messageId?: string }).messageId === "live-1",
      ),
    ).toBe(true);

    const runStarted = received.filter((e) => e.type === EventType.RUN_STARTED);
    expect(runStarted.length).toBe(1);
    expect(
      runStarted.every((e) => (e as { runId?: string }).runId === "run-2"),
    ).toBe(true);
    // The superseded run must NEVER surface a RUN_ERROR on the healthy stream.
    expect(received.some((e) => e.type === EventType.RUN_ERROR)).toBe(false);
  });

  it("a superseded run finalizes against its OWN stop-intent (clean stop, not error)", async () => {
    // Symptom 2: the superseded run's teardown must read its own captured
    // stop-intent, not the shared store flag the new run reset. Observe run-1's
    // OWN return stream: it must end with a clean RUN_FINISHED, never a
    // synthetic RUN_ERROR.
    const runner = new InMemoryAgentRunner({ onConcurrentRun: "supersede" });
    const threadId = "concurrent-supersede-clean-finalize";

    const run1Events: BaseEvent[] = [];
    runner
      .run({
        threadId,
        agent: new AbortableAgent(),
        input: makeInput(threadId, "run-1"),
      })
      .subscribe((event) => run1Events.push(event));

    // run-2 supersedes → run-1 is aborted → its async teardown finalizes.
    await firstValueFrom(
      runner
        .run({
          threadId,
          agent: new TestAgent(),
          input: makeInput(threadId, "run-2"),
        })
        .pipe(toArray()),
    );
    await new Promise((r) => setTimeout(r, 20)); // let run-1's abort teardown settle

    expect(run1Events.some((e) => e.type === EventType.RUN_FINISHED)).toBe(
      true,
    );
    expect(run1Events.some((e) => e.type === EventType.RUN_ERROR)).toBe(false);
  });

  it("throws while a prior run is still finalizing after stop() (mid-finalization window)", () => {
    // Symptom 1: stop() flips isRunning=false immediately, but the prior run is
    // still finalizing (stopRequested stays true). A HangingAgent never resolves
    // so that window is permanent. In "throw" mode a new run() in that window
    // must be rejected, not silently proceed unhandled past the concurrency gate.
    const runner = new InMemoryAgentRunner(); // default "throw"
    const threadId = "stop-then-run-throw-window";

    runner.run({
      threadId,
      agent: new HangingAgent(),
      input: makeInput(threadId, "run-1"),
    });
    // Synchronous: stop() runs its body now (returns a resolved Promise); the
    // run's teardown never fires because HangingAgent never resolves.
    void runner.stop({ threadId });

    expect(() =>
      runner.run({
        threadId,
        agent: new TestAgent(),
        input: makeInput(threadId, "run-2"),
      }),
    ).toThrow("Thread already running");
  });

  it("supersedes a prior run still finalizing after stop() (mid-finalization window)", async () => {
    // Same window as above, but in "supersede" mode the new run must cleanly
    // take over instead of slipping through unhandled.
    const runner = new InMemoryAgentRunner({ onConcurrentRun: "supersede" });
    const threadId = "stop-then-run-supersede-window";

    runner.run({
      threadId,
      agent: new HangingAgent(),
      input: makeInput(threadId, "run-1"),
    });
    void runner.stop({ threadId });

    const events = await firstValueFrom(
      runner
        .run({
          threadId,
          agent: new TestAgent(),
          input: makeInput(threadId, "run-2"),
        })
        .pipe(toArray()),
    );
    expect(
      events.some(
        (e) =>
          e.type === EventType.RUN_STARTED &&
          (e as { runId?: string }).runId === "run-2",
      ),
    ).toBe(true);
  });
});

describe("InMemoryAgentRunner stop mid-stream (#5812)", () => {
  // Models an HttpAgent proxy (e.g. pydantic-ai's AGUIAdapter): it opens a text
  // message and streams a chunk, then on abort emits a live RUN_ERROR WITHOUT
  // closing the message and lets runAgent resolve. Before the fix, finalize
  // appended a trailing TEXT_MESSAGE_END after that RUN_ERROR, which the AG-UI
  // verifier the browser runs rejected with "the run has already errored".
  class MidStreamAbortAgent extends AbstractAgent {
    readonly messageId = "225f30a2-c662-4d0d-a05e-789cb51e17cc";
    private emit?: (event: BaseEvent) => void;
    private finishRun?: () => void;

    async runAgent(
      input: RunAgentInput,
      options: {
        onEvent: (e: { event: BaseEvent }) => void;
        onRunStartedEvent?: () => void;
      },
    ): Promise<RunAgentResult> {
      const emit = (event: BaseEvent) => options.onEvent({ event });
      this.emit = emit;
      emit({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as RunStartedEvent);
      options.onRunStartedEvent?.();
      emit({
        type: EventType.TEXT_MESSAGE_START,
        messageId: this.messageId,
        role: "assistant",
      } as TextMessageStartEvent);
      emit({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: this.messageId,
        delta: " frames",
      } as TextMessageContentEvent);
      return new Promise<RunAgentResult>((resolve) => {
        this.finishRun = () => resolve({ result: undefined, newMessages: [] });
      });
    }

    abortRun(): void {
      this.emit?.({
        type: EventType.RUN_ERROR,
        message: "This operation was aborted",
        code: "abort",
      } as RunErrorEvent);
      this.finishRun?.();
    }

    clone(): AbstractAgent {
      return new MidStreamAbortAgent();
    }

    run(): ReturnType<AbstractAgent["run"]> {
      return EMPTY;
    }

    protected connect(): ReturnType<AbstractAgent["connect"]> {
      return EMPTY;
    }
  }

  it("does not stop a different run on the same thread", async () => {
    const runner = new InMemoryAgentRunner();
    runner.clearThreads();
    const threadId = "in-memory-stop-exact-run";
    const agent = new MidStreamAbortAgent();
    const input: RunAgentInput = {
      threadId,
      runId: "run-current",
      messages: [],
      state: {},
      tools: [],
      context: [],
    };
    const sub = runner.run({ threadId, agent, input }).subscribe();

    expect(await runner.stop({ threadId, runId: "run-superseded" })).toBe(
      false,
    );
    expect(await runner.isRunning({ threadId })).toBe(true);
    expect(await runner.stop({ threadId, runId: "run-current" })).toBe(true);
    sub.unsubscribe();
  });

  it("emits no events after RUN_ERROR and the stream passes the AG-UI verifier", async () => {
    const runner = new InMemoryAgentRunner();
    runner.clearThreads();
    const threadId = "in-memory-stop-mid-stream";
    const agent = new MidStreamAbortAgent();
    const input: RunAgentInput = {
      threadId,
      runId: "run-1",
      messages: [],
      state: {},
      tools: [],
      context: [],
    };

    const collected: BaseEvent[] = [];
    const done = new Promise<void>((resolve) => {
      runner.run({ threadId, agent, input }).subscribe({
        next: (event) => collected.push(event),
        complete: () => resolve(),
      });
    });

    // START + CONTENT are emitted synchronously; press Stop mid-stream (between
    // TEXT_MESSAGE_START and TEXT_MESSAGE_END).
    await runner.stop({ threadId });
    await done;

    const types = collected.map((event) => event.type);
    const runErrorIdx = types.indexOf(EventType.RUN_ERROR);
    expect(runErrorIdx).toBeGreaterThanOrEqual(0);
    // Nothing may follow the terminal RUN_ERROR — no trailing TEXT_MESSAGE_END.
    expect(types.slice(runErrorIdx + 1)).toEqual([]);

    // The stream the client receives must pass the SAME verifier the browser
    // runs (verifyEvents). Before the fix this rejected the trailing
    // TEXT_MESSAGE_END with "the run has already errored with 'RUN_ERROR'".
    const verified = await firstValueFrom(
      new Observable<BaseEvent>((subscriber) => {
        for (const event of collected) subscriber.next(event);
        subscriber.complete();
      }).pipe(verifyEvents(false), toArray()),
    );
    expect(verified.at(-1)?.type).toBe(EventType.RUN_ERROR);
  });
});

describe("InMemoryAgentRunner stop() guards and rollback", () => {
  // Emits RUN_STARTED then hangs in runAgent, so the thread stays running with a
  // live agent on the store. Its abortRun THROWS, modeling an agent whose
  // transport rejects the abort call — the case stop()'s catch must roll back.
  class AbortThrowsAgent extends AbstractAgent {
    async runAgent(
      input: RunAgentInput,
      options: {
        onEvent: (e: { event: BaseEvent }) => void;
        onRunStartedEvent?: () => void;
      },
    ): Promise<RunAgentResult> {
      options.onEvent({
        event: {
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        } as RunStartedEvent,
      });
      options.onRunStartedEvent?.();
      // Never resolves: the run stays in flight so stop() reaches abortRun().
      return new Promise<RunAgentResult>(() => {});
    }
    abortRun(): void {
      throw new Error("abort transport failed");
    }
    clone(): AbstractAgent {
      return new AbortThrowsAgent();
    }
    run(): ReturnType<AbstractAgent["run"]> {
      return EMPTY;
    }
    protected connect(): ReturnType<AbstractAgent["connect"]> {
      return EMPTY;
    }
  }

  const makeInput = (threadId: string, runId: string): RunAgentInput => ({
    threadId,
    runId,
    messages: [],
    state: {},
    tools: [],
    context: [],
  });

  let runner: InMemoryAgentRunner;

  beforeEach(() => {
    runner = new InMemoryAgentRunner();
    // Reset the module-level singleton so a hung run from one test cannot leak
    // into the next.
    runner.clearThreads();
  });

  // Branch 1a: `!store` — the thread has no store at all.
  it("returns false when the thread has never run (no store)", async () => {
    const threadId = "stop-guard-no-store";
    expect(ɵGLOBAL_STORE.peek(threadId)).toBeUndefined();
    expect(await runner.stop({ threadId })).toBe(false);
  });

  // Branch 1b: `!store.isRunning` — a store exists (a prior run completed) but
  // nothing is in flight.
  it("returns false when the store exists but no run is active", async () => {
    const threadId = "stop-guard-idle";
    await firstValueFrom(
      runner
        .run({
          threadId,
          agent: new TestAgent(),
          input: makeInput(threadId, "run-idle"),
        })
        .pipe(toArray()),
    );
    const store = ɵGLOBAL_STORE.peek(threadId);
    expect(store).toBeDefined();
    expect(store!.isRunning).toBe(false);
    expect(await runner.stop({ threadId })).toBe(false);
  });

  // Branch 3: `agent.abortRun()` throws. stop() must roll BOTH the shared store
  // flags AND this run's captured finalize intent back, then report failure —
  // leaving the store describing a still-live run (not a half-stopped one).
  it("rolls back store flags and per-run finalize intent when abortRun throws", async () => {
    const threadId = "stop-guard-abort-throws";
    runner.run({
      threadId,
      agent: new AbortThrowsAgent(),
      input: makeInput(threadId, "run-1"),
    });

    const store = ɵGLOBAL_STORE.peek(threadId)!;
    // Pre-conditions: a live run owns the thread and its finalize control is the
    // holder stop() will flip and then must restore.
    expect(store.isRunning).toBe(true);
    expect(store.stopRequested).toBe(false);
    const finalize = store.activeFinalize;
    expect(finalize).not.toBeNull();
    expect(finalize!.stopRequested).toBe(false);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runner.stop({ threadId })).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();

    // Shared store flags rolled back to "still running".
    expect(store.isRunning).toBe(true);
    expect(store.stopRequested).toBe(false);
    // The SAME per-run finalize control is still owned and its stop-intent was
    // rolled back to false — so the run's eventual teardown will not mislabel
    // itself as an intentional stop. This asserts the new bookkeeping line.
    expect(store.activeFinalize).toBe(finalize);
    expect(finalize!.stopRequested).toBe(false);

    // A subsequent run() sees a genuinely-running thread (default "throw" mode),
    // proving the rollback left ownership intact rather than half-stopped.
    expect(await runner.isRunning({ threadId })).toBe(true);
    expect(() =>
      runner.run({
        threadId,
        agent: new AbortThrowsAgent(),
        input: makeInput(threadId, "run-2"),
      }),
    ).toThrow("Thread already running");

    // A subsequent stop() is not wedged by a stale stopRequested: it re-enters
    // the abort path (throws again) and rolls back again.
    const errorSpy2 = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runner.stop({ threadId })).toBe(false);
    errorSpy2.mockRestore();
    expect(store.isRunning).toBe(true);
    expect(store.stopRequested).toBe(false);
    expect(store.activeFinalize!.stopRequested).toBe(false);
  });
});
