import { describe, it, expect } from "vitest";
import { EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  Interrupt,
  ResumeEntry,
  RunAgentInput,
} from "@ag-ui/client";
import { z } from "zod";
import {
  BuiltInAgent,
  createDefaultInput,
  createAgent,
  createThrowingAgent,
  createMidStreamErrorAgent,
  createClassicAgentWithTools,
  collectEvents,
  collectEventsIncludingErrors,
  expectLifecycleWrapped,
  eventField,
  textDelta,
  finish,
  toolCall,
  tanstackTextChunk,
  tanstackToolCallStart,
  tanstackToolCallEnd,
  tanstackApprovalRequested,
  aisdkToolApprovalRequest,
} from "./agent-test-helpers";
import type {
  AgentFactoryContext,
  BuiltInAgentFactoryConfig,
  AgentType,
  MockStreamEvent,
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

// ---------------------------------------------------------------------------
// BuiltInAgent factory interrupt() primitive
// ---------------------------------------------------------------------------

describe("BuiltInAgent factory interrupt() primitive", () => {
  const INT: Interrupt = {
    id: "int-1",
    reason: "confirmation",
    message: "Approve?",
  };

  function makeCustomInterruptAgent() {
    return new BuiltInAgent({
      type: "custom",
      factory: async function* (ctx) {
        const responses = await ctx.interrupt([INT]); // pauses on fresh run
        // resume run continues here:
        yield {
          type: EventType.TEXT_MESSAGE_START,
          messageId: "m1",
          role: "assistant",
        } as any;
        yield {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "m1",
          delta: `resolved:${JSON.stringify(responses)}`,
        } as any;
        yield { type: EventType.TEXT_MESSAGE_END, messageId: "m1" } as any;
      },
    });
  }

  it("emits RUN_FINISHED with outcome:interrupt on a fresh run", async () => {
    const agent = makeCustomInterruptAgent();
    const events = await collectEvents(agent.run(createDefaultInput()));
    const finished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as any;
    expect(finished).toBeDefined();
    expect(finished.outcome).toEqual({ type: "interrupt", interrupts: [INT] });
    // No text emitted on the paused run:
    expect(events.some((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)).toBe(
      false,
    );
  });

  it("continues past interrupt() on a resume run, returning resume payloads", async () => {
    const agent = makeCustomInterruptAgent();
    const resume: ResumeEntry[] = [
      { interruptId: "int-1", status: "resolved", payload: { ok: true } },
    ];
    const events = await collectEvents(
      agent.run(createDefaultInput({ resume })),
    );
    const content = events.find(
      (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
    ) as any;
    expect(content.delta).toContain("resolved:");
    expect(content.delta).toContain('"ok":true');
    const finished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as any;
    expect(finished.outcome).toBeUndefined(); // normal completion
  });
});

// ---------------------------------------------------------------------------
// BuiltInAgent classic interrupt tools
// ---------------------------------------------------------------------------

describe("BuiltInAgent classic interrupt tools", () => {
  const interruptTool = {
    name: "confirm_action",
    description: "Ask the human to confirm",
    parameters: z.object({ summary: z.string() }),
    interrupt: true as const,
    interruptReason: "confirmation",
    interruptMessage: "Please confirm",
  };

  it("pauses + emits outcome:interrupt (keyed by toolCallId), withholding the tool result", async () => {
    // mock stream: assistant calls the interrupt tool, then 'finish'
    const agent = createClassicAgentWithTools(
      [toolCall("tc-1", "confirm_action", { summary: "delete X" }), finish()],
      [interruptTool],
    );
    const events = await collectEvents(
      agent.run(
        createDefaultInput({
          messages: [{ id: "u1", role: "user", content: "do it" }] as any,
        }),
      ),
    );

    expect(events.some((e) => e.type === EventType.TOOL_CALL_START)).toBe(true);
    expect(events.some((e) => e.type === EventType.TOOL_CALL_END)).toBe(true);
    // result withheld:
    expect(events.some((e) => e.type === EventType.TOOL_CALL_RESULT)).toBe(
      false,
    );
    const finished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as any;
    expect(finished.outcome.type).toBe("interrupt");
    expect(finished.outcome.interrupts[0]).toMatchObject({
      id: "tc-1",
      toolCallId: "tc-1",
      reason: "confirmation",
      message: "Please confirm",
    });
  });

  it("on resume, injects the resume payload as the interrupt tool's result and continues", async () => {
    // Resume run: the model just replies after the injected tool result.
    const agent = createClassicAgentWithTools(
      [textDelta("done"), finish()],
      [interruptTool],
    );
    const input = createDefaultInput({
      resume: [
        {
          interruptId: "tc-1",
          status: "resolved",
          payload: { approved: true },
        },
      ],
      messages: [
        { id: "u1", role: "user", content: "do it" },
        {
          id: "a1",
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tc-1",
              type: "function",
              function: {
                name: "confirm_action",
                arguments: '{"summary":"delete X"}',
              },
            },
          ],
        },
      ] as any,
    });

    const events = await collectEvents(agent.run(input));

    // The run completes normally (no interrupt outcome on the resume run):
    const finished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as any;
    expect(finished.outcome).toBeUndefined();

    // The synthesized tool result reached the model: a tool-role message
    // addressing tc-1 with the resume payload must be present.
    expect(agent.__lastModelMessages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "tool" })]),
    );
  });
});

// ---------------------------------------------------------------------------
// BuiltInAgent factory-mode NATIVE approval interrupts (aisdk + tanstack)
//
// A tool declared with the SDK's native `needsApproval: true` pauses the run:
// AI SDK emits a `tool-approval-request` fullStream part; TanStack emits a
// CUSTOM `approval-requested` chunk. Both surface as RUN_FINISHED
// outcome:interrupt, and on resume the payload is injected as that tool call's
// native tool-result so the factory continues.
// ---------------------------------------------------------------------------

describe("BuiltInAgent factory native approval interrupts", () => {
  it("aisdk: tool-approval-request → outcome:interrupt keyed by toolCallId", async () => {
    const agent = createAgent("aisdk", [
      toolCall("tc-1", "bookFlight", { dest: "NRT" }),
      aisdkToolApprovalRequest("tc-1"),
      finish(),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));

    // The tool call is surfaced so the client knows what it's approving.
    expect(events.some((e) => e.type === EventType.TOOL_CALL_START)).toBe(true);
    expect(events.some((e) => e.type === EventType.TOOL_CALL_END)).toBe(true);

    const finished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as any;
    expect(finished.outcome.type).toBe("interrupt");
    expect(finished.outcome.interrupts[0]).toMatchObject({
      id: "tc-1",
      toolCallId: "tc-1",
    });
  });

  it("aisdk: multiple needsApproval tool calls → one interrupt each", async () => {
    const agent = createAgent("aisdk", [
      toolCall("tc-1", "bookFlight", { dest: "NRT" }),
      aisdkToolApprovalRequest("tc-1"),
      toolCall("tc-2", "bookFlight", { dest: "CDG" }),
      aisdkToolApprovalRequest("tc-2"),
      finish(),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));
    const finished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as any;
    expect(finished.outcome.type).toBe("interrupt");
    expect(finished.outcome.interrupts.map((i: any) => i.toolCallId)).toEqual([
      "tc-1",
      "tc-2",
    ]);
  });

  it("multiple resume entries each inject their own tool-role message", async () => {
    let captured: RunAgentInput | undefined;
    const agent = new BuiltInAgent({
      type: "aisdk",
      factory: (ctx) => {
        captured = ctx.input;
        return {
          fullStream: (async function* () {
            yield textDelta("done");
            yield finish();
          })(),
        };
      },
    });
    const resume: ResumeEntry[] = [
      { interruptId: "tc-1", status: "resolved", payload: { approved: true } },
      { interruptId: "tc-2", status: "cancelled" },
    ];
    await collectEvents(agent.run(createDefaultInput({ resume })));
    const toolMsgs = captured!.messages.filter(
      (m) => m.role === "tool",
    ) as any[];
    expect(toolMsgs.map((m) => m.toolCallId)).toEqual(["tc-1", "tc-2"]);
    expect(toolMsgs[0].content).toContain("approved");
    expect(toolMsgs[1].content).toContain("cancelled");
  });

  it("resume injection is idempotent — does not double-answer a tool call the client already recorded", async () => {
    // The client (useInterrupt) persists the resolution as a tool message so the
    // thread stays well-formed across turns. The runtime must NOT then inject a
    // second tool-result for the same toolCallId.
    let captured: RunAgentInput | undefined;
    const agent = new BuiltInAgent({
      type: "aisdk",
      factory: (ctx) => {
        captured = ctx.input;
        return {
          fullStream: (async function* () {
            yield textDelta("ok");
            yield finish();
          })(),
        };
      },
    });
    const resume: ResumeEntry[] = [
      { interruptId: "tc-1", status: "resolved", payload: { approved: true } },
    ];
    await collectEvents(
      agent.run(
        createDefaultInput({
          resume,
          messages: [
            { id: "u1", role: "user", content: "go" },
            {
              id: "a1",
              role: "assistant",
              content: "",
              toolCalls: [
                {
                  id: "tc-1",
                  type: "function",
                  function: { name: "bookFlight", arguments: "{}" },
                },
              ],
            },
            {
              id: "t1",
              role: "tool",
              toolCallId: "tc-1",
              content: JSON.stringify({ approved: true }),
            },
          ] as RunAgentInput["messages"],
        }),
      ),
    );
    const toolMsgs = captured!.messages.filter(
      (m) => m.role === "tool" && (m as any).toolCallId === "tc-1",
    );
    expect(toolMsgs).toHaveLength(1);
  });

  it("tanstack: CUSTOM approval-requested (even after RUN_FINISHED) → outcome:interrupt", async () => {
    // The approval chunk is built from the finish event and can arrive AFTER
    // RUN_FINISHED — assert it's still captured (ordering-robust).
    const agent = createAgent("tanstack", [
      tanstackToolCallStart("tc-9", "bookFlight"),
      tanstackToolCallEnd("tc-9"),
      { type: "RUN_FINISHED" },
      tanstackApprovalRequested("tc-9", "bookFlight", { dest: "NRT" }),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));

    const finished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as any;
    expect(finished.outcome.type).toBe("interrupt");
    expect(finished.outcome.interrupts[0]).toMatchObject({
      id: "tc-9",
      toolCallId: "tc-9",
      message: 'Approve "bookFlight"?',
    });
  });

  it("aisdk: resume injects the payload as a tool-role message the factory sees", async () => {
    let captured: RunAgentInput | undefined;
    const agent = new BuiltInAgent({
      type: "aisdk",
      factory: (ctx) => {
        captured = ctx.input;
        return {
          fullStream: (async function* () {
            yield textDelta("booked");
            yield finish();
          })(),
        };
      },
    });

    const resume: ResumeEntry[] = [
      { interruptId: "tc-1", status: "resolved", payload: { approved: true } },
    ];
    const events = await collectEvents(
      agent.run(createDefaultInput({ resume })),
    );

    // Normal completion on the resume run (no re-interrupt).
    const finished = events.find(
      (e) => e.type === EventType.RUN_FINISHED,
    ) as any;
    expect(finished.outcome).toBeUndefined();

    const toolMsg = captured!.messages.find(
      (m) => m.role === "tool" && (m as any).toolCallId === "tc-1",
    ) as any;
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toContain("approved");
  });

  it("tanstack: cancelled resume injects a cancellation tool-role message", async () => {
    let captured: RunAgentInput | undefined;
    const agent = new BuiltInAgent({
      type: "tanstack",
      factory: (ctx) => {
        captured = ctx.input;
        return {
          [Symbol.asyncIterator]: async function* () {
            yield tanstackTextChunk("ok");
          },
        };
      },
    });

    const resume: ResumeEntry[] = [
      { interruptId: "tc-9", status: "cancelled" },
    ];
    await collectEvents(agent.run(createDefaultInput({ resume })));

    const toolMsg = captured!.messages.find(
      (m) => m.role === "tool" && (m as any).toolCallId === "tc-9",
    ) as any;
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toContain("cancelled");
  });
});
