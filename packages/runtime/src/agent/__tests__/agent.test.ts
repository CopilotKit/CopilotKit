import { describe, it, expect } from "vitest";
import { EventType, type BaseEvent } from "@ag-ui/client";
import {
  BuiltInAgent,
  type AgentFactoryContext,
  type BuiltInAgentFactoryConfig,
  createDefaultInput,
  createAgent,
  createThrowingAgent,
  createMidStreamErrorAgent,
  collectEvents,
  collectEventsIncludingErrors,
  expectLifecycleWrapped,
  eventField,
  textDelta,
  finish,
  tanstackTextChunk,
  type AgentType,
  type MockStreamEvent,
} from "./agent-test-helpers";

// ---------------------------------------------------------------------------
// Local helpers for parameterized tests
// ---------------------------------------------------------------------------

const allTypes: AgentType[] = ["aisdk", "tanstack", "custom"];

function minimalStreamData(
  type: AgentType,
): MockStreamEvent[] | Record<string, unknown>[] | BaseEvent[] {
  switch (type) {
    case "aisdk":
      return [textDelta("hi"), finish()];
    case "tanstack":
      return [tanstackTextChunk("hi")];
    case "custom":
      return [
        {
          type: EventType.TEXT_MESSAGE_CHUNK,
          role: "assistant",
          delta: "hi",
        } as BaseEvent,
      ];
  }
}

function emptyStreamData(
  type: AgentType,
): MockStreamEvent[] | Record<string, unknown>[] | BaseEvent[] {
  switch (type) {
    case "aisdk":
      return [finish()];
    case "tanstack":
      return [];
    case "custom":
      return [];
  }
}

// ---------------------------------------------------------------------------
// Parameterized test suites
// ---------------------------------------------------------------------------

describe.each(allTypes)("Agent [%s]", (type) => {
  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  describe("lifecycle", () => {
    it("emits RUN_STARTED as the first event with correct threadId/runId", async () => {
      const agent = createAgent(type, minimalStreamData(type));
      const input = createDefaultInput({ threadId: "t1", runId: "r1" });
      const events = await collectEvents(agent.run(input));

      expect(events.length).toBeGreaterThanOrEqual(2);
      const first = events[0];
      expect(first.type).toBe(EventType.RUN_STARTED);
      expect(eventField<string>(first, "threadId")).toBe("t1");
      expect(eventField<string>(first, "runId")).toBe("r1");
    });

    it("emits RUN_FINISHED as the last event with correct threadId/runId", async () => {
      const agent = createAgent(type, minimalStreamData(type));
      const input = createDefaultInput({ threadId: "t2", runId: "r2" });
      const events = await collectEvents(agent.run(input));

      const last = events[events.length - 1];
      expect(last.type).toBe(EventType.RUN_FINISHED);
      expect(eventField<string>(last, "threadId")).toBe("t2");
      expect(eventField<string>(last, "runId")).toBe("r2");
    });

    it("emits RUN_FINISHED for an empty stream", async () => {
      const agent = createAgent(type, emptyStreamData(type));
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0].type).toBe(EventType.RUN_STARTED);
      expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);
    });

    it("wraps content with lifecycle events", async () => {
      const agent = createAgent(type, minimalStreamData(type));
      const input = createDefaultInput({ threadId: "wrap-t", runId: "wrap-r" });
      const events = await collectEvents(agent.run(input));

      expectLifecycleWrapped(events, "wrap-t", "wrap-r");

      // There should be content events between the lifecycle bookends
      const contentEvents = events.slice(1, -1);
      expect(contentEvents.length).toBeGreaterThan(0);
      for (const e of contentEvents) {
        expect(e.type).not.toBe(EventType.RUN_STARTED);
        expect(e.type).not.toBe(EventType.RUN_FINISHED);
      }
    });
  });

  // -------------------------------------------------------------------------
  // RUN_ERROR
  // -------------------------------------------------------------------------
  describe("RUN_ERROR", () => {
    it("emits RUN_ERROR when factory throws", async () => {
      const agent = createThrowingAgent(type, "factory-boom");
      const input = createDefaultInput();
      const { events, errored } = await collectEventsIncludingErrors(
        agent.run(input),
      );

      expect(errored).toBe(true);
      const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
      expect(errorEvents.length).toBe(1);
      expect(eventField<string>(errorEvents[0], "message")).toBe(
        "factory-boom",
      );
    });

    it("emits RUN_ERROR when stream throws mid-iteration", async () => {
      const agent = createMidStreamErrorAgent(type, "mid-stream-boom");
      const input = createDefaultInput();
      const { events, errored } = await collectEventsIncludingErrors(
        agent.run(input),
      );

      expect(errored).toBe(true);
      const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
      expect(errorEvents.length).toBe(1);
      expect(eventField<string>(errorEvents[0], "message")).toBe(
        "mid-stream-boom",
      );
    });

    it("does not emit RUN_FINISHED after RUN_ERROR", async () => {
      const agent = createThrowingAgent(type, "no-finish");
      const input = createDefaultInput();
      const { events } = await collectEventsIncludingErrors(agent.run(input));

      const errorIdx = events.findIndex((e) => e.type === EventType.RUN_ERROR);
      expect(errorIdx).toBeGreaterThanOrEqual(0);

      const eventsAfterError = events.slice(errorIdx + 1);
      const finishAfterError = eventsAfterError.filter(
        (e) => e.type === EventType.RUN_FINISHED,
      );
      expect(finishAfterError.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Abort
  // -------------------------------------------------------------------------
  describe("abort", () => {
    it("completes without error after abortRun()", async () => {
      // Use a signal to synchronize: abort after the first chunk is emitted
      let emittedFirstChunk: () => void;
      const firstChunkEmitted = new Promise<void>(
        (r) => (emittedFirstChunk = r),
      );

      let config: BuiltInAgentFactoryConfig;
      switch (type) {
        case "aisdk":
          config = {
            type: "aisdk",
            factory: ({ abortSignal }: AgentFactoryContext) => ({
              fullStream: (async function* () {
                yield { type: "text-delta", text: "tick" };
                emittedFirstChunk();
                // Wait for abort — use a promise that resolves on abort
                await new Promise<void>((r) => {
                  if (abortSignal.aborted) return r();
                  abortSignal.addEventListener("abort", () => r(), {
                    once: true,
                  });
                });
              })(),
            }),
          };
          break;
        case "tanstack":
          config = {
            type: "tanstack",
            factory: ({ abortSignal }: AgentFactoryContext) => ({
              [Symbol.asyncIterator]: async function* () {
                yield { type: "TEXT_MESSAGE_CONTENT", delta: "tick" };
                emittedFirstChunk();
                await new Promise<void>((r) => {
                  if (abortSignal.aborted) return r();
                  abortSignal.addEventListener("abort", () => r(), {
                    once: true,
                  });
                });
              },
            }),
          };
          break;
        case "custom":
          config = {
            type: "custom",
            factory: ({ abortSignal }: AgentFactoryContext) => ({
              [Symbol.asyncIterator]: async function* () {
                yield {
                  type: EventType.TEXT_MESSAGE_CHUNK,
                  role: "assistant",
                  delta: "tick",
                } as BaseEvent;
                emittedFirstChunk();
                await new Promise<void>((r) => {
                  if (abortSignal.aborted) return r();
                  abortSignal.addEventListener("abort", () => r(), {
                    once: true,
                  });
                });
              },
            }),
          };
          break;
      }

      const agent = new BuiltInAgent(config);
      const input = createDefaultInput();

      const completed = await new Promise<boolean>((resolve) => {
        agent.run(input).subscribe({
          next: () => {},
          error: () => resolve(false),
          complete: () => resolve(true),
        });

        // Wait for the first chunk to be emitted, then abort
        firstChunkEmitted.then(() => agent.abortRun());
      });

      expect(completed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Factory Context
  // -------------------------------------------------------------------------
  describe("factory context", () => {
    it("receives correct input with threadId, runId, and forwardedProps", async () => {
      let capturedCtx: AgentFactoryContext | null = null;

      let config: BuiltInAgentFactoryConfig;
      switch (type) {
        case "aisdk":
          config = {
            type: "aisdk",
            factory: (ctx: AgentFactoryContext) => {
              capturedCtx = ctx;
              return {
                fullStream: (async function* () {
                  yield { type: "finish", finishReason: "stop" };
                })(),
              };
            },
          };
          break;
        case "tanstack":
          config = {
            type: "tanstack",
            factory: (ctx: AgentFactoryContext) => {
              capturedCtx = ctx;
              return (async function* () {
                // empty stream
              })();
            },
          };
          break;
        case "custom":
          config = {
            type: "custom",
            factory: (ctx: AgentFactoryContext) => {
              capturedCtx = ctx;
              return (async function* () {
                // empty stream
              })();
            },
          };
          break;
      }

      const agent = new BuiltInAgent(config);
      const input = createDefaultInput({
        threadId: "ctx-thread",
        runId: "ctx-run",
        forwardedProps: { model: "gpt-4" },
      });

      await collectEvents(agent.run(input));

      expect(capturedCtx).not.toBeNull();
      expect(capturedCtx!.input.threadId).toBe("ctx-thread");
      expect(capturedCtx!.input.runId).toBe("ctx-run");
      expect(capturedCtx!.input.forwardedProps).toEqual({ model: "gpt-4" });
    });

    it("receives abortController and abortSignal", async () => {
      let capturedCtx: AgentFactoryContext | null = null;

      let config: BuiltInAgentFactoryConfig;
      switch (type) {
        case "aisdk":
          config = {
            type: "aisdk",
            factory: (ctx: AgentFactoryContext) => {
              capturedCtx = ctx;
              return {
                fullStream: (async function* () {
                  yield { type: "finish", finishReason: "stop" };
                })(),
              };
            },
          };
          break;
        case "tanstack":
          config = {
            type: "tanstack",
            factory: (ctx: AgentFactoryContext) => {
              capturedCtx = ctx;
              return (async function* () {
                // empty
              })();
            },
          };
          break;
        case "custom":
          config = {
            type: "custom",
            factory: (ctx: AgentFactoryContext) => {
              capturedCtx = ctx;
              return (async function* () {
                // empty
              })();
            },
          };
          break;
      }

      const agent = new BuiltInAgent(config);
      const input = createDefaultInput();
      await collectEvents(agent.run(input));

      expect(capturedCtx!.abortController).toBeInstanceOf(AbortController);
      expect(capturedCtx!.abortSignal).toBe(
        capturedCtx!.abortController.signal,
      );
    });
  });

  // -------------------------------------------------------------------------
  // clone()
  // -------------------------------------------------------------------------
  describe("clone()", () => {
    it("returns a new Agent instance (not the same reference)", () => {
      const agent = createAgent(type, minimalStreamData(type));
      const cloned = agent.clone();

      expect(cloned).toBeInstanceOf(BuiltInAgent);
      expect(cloned).not.toBe(agent);
    });

    it("produces correct lifecycle events from a cloned agent", async () => {
      const agent = createAgent(type, minimalStreamData(type));
      const cloned = agent.clone();
      const input = createDefaultInput({
        threadId: "clone-t",
        runId: "clone-r",
      });

      const events = await collectEvents(cloned.run(input));

      expectLifecycleWrapped(events, "clone-t", "clone-r");
    });
  });
});

// ---------------------------------------------------------------------------
// Type Discrimination (NOT parameterized)
// ---------------------------------------------------------------------------

describe("Agent type discrimination", () => {
  it('"aisdk" routes to AI SDK converter and produces text content', async () => {
    const agent = createAgent("aisdk", [
      textDelta("hello from aisdk"),
      finish(),
    ]);
    const input = createDefaultInput();
    const events = await collectEvents(agent.run(input));

    const textEvents = events.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textEvents.length).toBe(1);
    expect(eventField<string>(textEvents[0], "delta")).toBe("hello from aisdk");
  });

  it('"tanstack" routes to TanStack converter and produces text content', async () => {
    const agent = createAgent("tanstack", [
      tanstackTextChunk("hello from tanstack"),
    ]);
    const input = createDefaultInput();
    const events = await collectEvents(agent.run(input));

    const textEvents = events.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textEvents.length).toBe(1);
    expect(eventField<string>(textEvents[0], "delta")).toBe(
      "hello from tanstack",
    );
  });

  it('"custom" forwards events directly without conversion', async () => {
    const customEvent: BaseEvent = {
      type: EventType.TEXT_MESSAGE_CHUNK,
      role: "assistant",
      delta: "hello from custom",
    } as BaseEvent;

    const agent = createAgent("custom", [customEvent]);
    const input = createDefaultInput();
    const events = await collectEvents(agent.run(input));

    const textEvents = events.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textEvents.length).toBe(1);
    expect(eventField<string>(textEvents[0], "delta")).toBe(
      "hello from custom",
    );
  });
});

// ---------------------------------------------------------------------------
// Async Factory (Promise-returning)
// ---------------------------------------------------------------------------

describe("Async factory (Promise-returning)", () => {
  it("aisdk: async factory resolves and streams correctly", async () => {
    const agent = new BuiltInAgent({
      type: "aisdk",
      factory: async () => {
        // Simulate async setup (e.g., fetching API key)
        await new Promise((r) => setTimeout(r, 5));
        return {
          fullStream: (async function* () {
            yield { type: "text-delta", text: "async-aisdk" };
            yield { type: "finish", finishReason: "stop" };
          })(),
        };
      },
    });
    const input = createDefaultInput();
    const events = await collectEvents(agent.run(input));

    expectLifecycleWrapped(events);
    const textEvents = events.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textEvents).toHaveLength(1);
    expect(eventField<string>(textEvents[0], "delta")).toBe("async-aisdk");
  });

  it("tanstack: async factory resolves and streams correctly", async () => {
    const agent = new BuiltInAgent({
      type: "tanstack",
      factory: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return (async function* () {
          yield { type: "TEXT_MESSAGE_CONTENT", delta: "async-tanstack" };
        })();
      },
    });
    const input = createDefaultInput();
    const events = await collectEvents(agent.run(input));

    expectLifecycleWrapped(events);
    const textEvents = events.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textEvents).toHaveLength(1);
    expect(eventField<string>(textEvents[0], "delta")).toBe("async-tanstack");
  });

  it("custom: async factory resolves and streams correctly", async () => {
    const agent = new BuiltInAgent({
      type: "custom",
      factory: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return (async function* () {
          yield {
            type: EventType.TEXT_MESSAGE_CHUNK,
            role: "assistant",
            delta: "async-custom",
          } as BaseEvent;
        })();
      },
    });
    const input = createDefaultInput();
    const events = await collectEvents(agent.run(input));

    expectLifecycleWrapped(events);
    const textEvents = events.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textEvents).toHaveLength(1);
    expect(eventField<string>(textEvents[0], "delta")).toBe("async-custom");
  });
});

// ---------------------------------------------------------------------------
// RUN_ERROR includes threadId and runId
// ---------------------------------------------------------------------------

describe("RUN_ERROR correlation fields", () => {
  it("RUN_ERROR includes threadId and runId for run correlation", async () => {
    const agent = new BuiltInAgent({
      type: "aisdk",
      factory: () => {
        throw new Error("test-error");
      },
    });
    const input = createDefaultInput({
      threadId: "err-thread",
      runId: "err-run",
    });
    const { events, errored } = await collectEventsIncludingErrors(
      agent.run(input),
    );

    expect(errored).toBe(true);
    const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
    expect(errorEvents).toHaveLength(1);
    expect(eventField<string>(errorEvents[0], "threadId")).toBe("err-thread");
    expect(eventField<string>(errorEvents[0], "runId")).toBe("err-run");
  });
});

// ---------------------------------------------------------------------------
// Concurrent run guard
// ---------------------------------------------------------------------------

describe("Concurrent run guard", () => {
  it("throws when run() is called while another run is in progress", async () => {
    let resolveFactory: () => void;
    const factoryBlocked = new Promise<void>((r) => (resolveFactory = r));

    const agent = new BuiltInAgent({
      type: "custom",
      factory: async function* ({ abortSignal }) {
        // Block until resolved externally
        await new Promise<void>((r) => {
          if (abortSignal.aborted) return r();
          abortSignal.addEventListener("abort", () => r(), { once: true });
          factoryBlocked.then(() => r());
        });
      },
    });
    const input = createDefaultInput();

    // Start first run — abortController is now set synchronously in run()
    const sub = agent.run(input).subscribe({ next: () => {} });

    // Second run should throw immediately (no timing dependency)
    expect(() => agent.run(input)).toThrow("Agent is already running");

    // Cleanup
    resolveFactory!();
    sub.unsubscribe();
  });
});
