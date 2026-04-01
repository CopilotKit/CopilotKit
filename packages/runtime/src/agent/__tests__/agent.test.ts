import { describe, it, expect } from "vitest";
import { EventType, type BaseEvent } from "@ag-ui/client";
import type { AgentConfig } from "../agent";
import {
  Agent,
  type AgentFactoryContext,
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

function minimalStreamData(type: AgentType): MockStreamEvent[] | Record<string, unknown>[] | BaseEvent[] {
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

function emptyStreamData(type: AgentType): MockStreamEvent[] | Record<string, unknown>[] | BaseEvent[] {
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
      const events = await collectEventsIncludingErrors(agent.run(input));

      const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
      expect(errorEvents.length).toBe(1);
      expect(eventField<string>(errorEvents[0], "message")).toBe("factory-boom");
    });

    it("emits RUN_ERROR when stream throws mid-iteration", async () => {
      const agent = createMidStreamErrorAgent(type, "mid-stream-boom");
      const input = createDefaultInput();
      const events = await collectEventsIncludingErrors(agent.run(input));

      const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
      expect(errorEvents.length).toBe(1);
      expect(eventField<string>(errorEvents[0], "message")).toBe("mid-stream-boom");
    });

    it("does not emit RUN_FINISHED after RUN_ERROR", async () => {
      const agent = createThrowingAgent(type, "no-finish");
      const input = createDefaultInput();
      const events = await collectEventsIncludingErrors(agent.run(input));

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
      // Create a slow agent with an infinite loop (50ms per chunk)
      let config: AgentConfig;
      switch (type) {
        case "aisdk":
          config = {
            type: "aisdk",
            factory: ({ abortSignal }: AgentFactoryContext) => ({
              fullStream: (async function* () {
                while (!abortSignal.aborted) {
                  yield { type: "text-delta", text: "tick" };
                  await new Promise((r) => setTimeout(r, 50));
                }
              })(),
            }),
          };
          break;
        case "tanstack":
          config = {
            type: "tanstack",
            factory: ({ abortSignal }: AgentFactoryContext) => ({
              [Symbol.asyncIterator]: async function* () {
                while (!abortSignal.aborted) {
                  yield { type: "TEXT_MESSAGE_CONTENT", delta: "tick" };
                  await new Promise((r) => setTimeout(r, 50));
                }
              },
            }),
          };
          break;
        case "custom":
          config = {
            type: "custom",
            factory: ({ abortSignal }: AgentFactoryContext) => ({
              [Symbol.asyncIterator]: async function* () {
                while (!abortSignal.aborted) {
                  yield {
                    type: EventType.TEXT_MESSAGE_CHUNK,
                    role: "assistant",
                    delta: "tick",
                  } as BaseEvent;
                  await new Promise((r) => setTimeout(r, 50));
                }
              },
            }),
          };
          break;
      }

      const agent = new Agent(config);
      const input = createDefaultInput();

      const completed = await new Promise<boolean>((resolve) => {
        agent.run(input).subscribe({
          next: () => {},
          error: () => resolve(false),
          complete: () => resolve(true),
        });

        // Wait a tick so at least one chunk is emitted, then abort
        setTimeout(() => agent.abortRun(), 30);
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

      let config: AgentConfig;
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

      const agent = new Agent(config);
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

      let config: AgentConfig;
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

      const agent = new Agent(config);
      const input = createDefaultInput();
      await collectEvents(agent.run(input));

      expect(capturedCtx!.abortController).toBeInstanceOf(AbortController);
      expect(capturedCtx!.abortSignal).toBe(capturedCtx!.abortController.signal);
    });
  });

  // -------------------------------------------------------------------------
  // clone()
  // -------------------------------------------------------------------------
  describe("clone()", () => {
    it("returns a new Agent instance (not the same reference)", () => {
      const agent = createAgent(type, minimalStreamData(type));
      const cloned = agent.clone();

      expect(cloned).toBeInstanceOf(Agent);
      expect(cloned).not.toBe(agent);
    });

    it("produces correct lifecycle events from a cloned agent", async () => {
      const agent = createAgent(type, minimalStreamData(type));
      const cloned = agent.clone();
      const input = createDefaultInput({ threadId: "clone-t", runId: "clone-r" });

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
    const agent = createAgent("aisdk", [textDelta("hello from aisdk"), finish()]);
    const input = createDefaultInput();
    const events = await collectEvents(agent.run(input));

    const textEvents = events.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textEvents.length).toBe(1);
    expect(eventField<string>(textEvents[0], "delta")).toBe("hello from aisdk");
  });

  it('"tanstack" routes to TanStack converter and produces text content', async () => {
    const agent = createAgent("tanstack", [tanstackTextChunk("hello from tanstack")]);
    const input = createDefaultInput();
    const events = await collectEvents(agent.run(input));

    const textEvents = events.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textEvents.length).toBe(1);
    expect(eventField<string>(textEvents[0], "delta")).toBe("hello from tanstack");
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
    expect(eventField<string>(textEvents[0], "delta")).toBe("hello from custom");
  });
});
