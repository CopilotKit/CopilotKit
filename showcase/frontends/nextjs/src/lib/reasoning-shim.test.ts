/**
 * The reasoning shim, driven directly.
 *
 * `next` is SCRIPTED rather than live: the whole point of the shim is the exact
 * event sequence it interleaves into a backend's stream and the exact input it
 * hands that backend, and both are only observable with a fake on the other
 * side. The composed middleware chain passes a structural `{ run, messages,
 * state }` object as `next` (not a real agent), so a scripted object is also
 * the shape the production path actually supplies.
 *
 * The expected sequence is asserted against LITERAL strings, not against
 * `EventType` members. This shim exists because a backend does not speak this
 * vocabulary; a test written in the same enum the implementation uses would
 * still pass if the enum were renamed out from under the wire format the client
 * parses.
 */

import { describe, expect, it, vi } from "vitest";

import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { EventType, FunctionMiddleware, HttpAgent } from "@ag-ui/client";
import type { Message, RunAgentInput } from "@ag-ui/core";
import { Observable, lastValueFrom, toArray } from "rxjs";

import {
  applySyntheticReasoning,
  hasSyntheticReasoning,
  stripReasoningMessages,
  SYNTHETIC_REASONING_DELTA,
  syntheticReasoningEvents,
  syntheticReasoningMiddleware,
} from "./reasoning-shim";

/** The five injected types, in order, as they appear on the wire. */
const INJECTED = [
  "REASONING_START",
  "REASONING_MESSAGE_START",
  "REASONING_MESSAGE_CONTENT",
  "REASONING_MESSAGE_END",
  "REASONING_END",
];

function input(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: {},
    ...overrides,
  } as RunAgentInput;
}

/**
 * A `next` that emits `events` and completes, recording what it was asked to
 * run. `error` instead makes it fail after emitting nothing.
 */
function scriptedNext(events: BaseEvent[], error?: Error) {
  const seen: RunAgentInput[] = [];
  const next = {
    run(received: RunAgentInput) {
      seen.push(received);
      return new Observable<BaseEvent>((subscriber) => {
        for (const event of events) subscriber.next(event);
        if (error) subscriber.error(error);
        else subscriber.complete();
      });
    },
  } as unknown as AbstractAgent;
  return { next, seen };
}

async function collect(stream: Observable<BaseEvent>): Promise<BaseEvent[]> {
  return lastValueFrom(stream.pipe(toArray()));
}

function types(events: BaseEvent[]): string[] {
  return events.map((event) => String(event.type));
}

const RUN_STARTED = { type: EventType.RUN_STARTED } as BaseEvent;
const TEXT = { type: EventType.TEXT_MESSAGE_CONTENT, delta: "hi" } as BaseEvent;
const RUN_FINISHED = { type: EventType.RUN_FINISHED } as BaseEvent;

describe("syntheticReasoningEvents", () => {
  it("is the exact five-event sequence the source route emits", () => {
    const events = syntheticReasoningEvents("m-1");
    expect(types(events)).toEqual(INJECTED);
    // Every event carries the SAME messageId, or the client treats them as
    // fragments of different reasoning messages and renders nothing whole.
    for (const event of events) {
      expect((event as { messageId?: string }).messageId).toBe("m-1");
    }
  });

  it("declares role: reasoning on REASONING_MESSAGE_START", () => {
    // Not decoration: this is what makes the client materialise a
    // reasoning-role message rather than an assistant one.
    const [, start] = syntheticReasoningEvents("m-1");
    expect(start).toMatchObject({ role: "reasoning" });
  });

  it("streams the reasoning text as the CONTENT delta", () => {
    const [, , content] = syntheticReasoningEvents("m-1");
    expect(content).toMatchObject({ delta: SYNTHETIC_REASONING_DELTA });
    expect(SYNTHETIC_REASONING_DELTA).toContain("checking the request");
  });
});

describe("stripReasoningMessages", () => {
  it("drops reasoning-role messages and keeps every other role", () => {
    // The .NET AG-UI host's input mapper accepts only these four roles, and the
    // client replays the reasoning message the shim itself caused on turn 2.
    const messages = [
      { id: "1", role: "user", content: "hi" },
      { id: "2", role: "reasoning", content: "thinking" },
      { id: "3", role: "assistant", content: "hello" },
      { id: "4", role: "system", content: "be nice" },
      { id: "5", role: "tool", toolCallId: "t1", content: "{}" },
    ] as unknown as Message[];

    const stripped = stripReasoningMessages(input({ messages }));

    expect(stripped.messages?.map((message) => message.id)).toEqual([
      "1",
      "3",
      "4",
      "5",
    ]);
  });

  it("leaves an absent messages field absent rather than making it empty", () => {
    // "The caller sent no history" and "the caller sent an empty history" are
    // different requests to the .NET host; this must not convert one to the
    // other.
    const stripped = stripReasoningMessages(
      input({ messages: undefined as unknown as Message[] }),
    );
    expect(stripped.messages).toBeUndefined();
  });

  it("does not mutate the input it was given", () => {
    const messages = [
      { id: "2", role: "reasoning", content: "thinking" },
    ] as unknown as Message[];
    const original = input({ messages });
    stripReasoningMessages(original);
    expect(original.messages).toHaveLength(1);
  });
});

describe("syntheticReasoningMiddleware", () => {
  it("injects the sequence immediately AFTER RUN_STARTED", async () => {
    const { next } = scriptedNext([RUN_STARTED, TEXT, RUN_FINISHED]);

    const events = await collect(syntheticReasoningMiddleware(input(), next));

    expect(types(events)).toEqual([
      "RUN_STARTED",
      ...INJECTED,
      "TEXT_MESSAGE_CONTENT",
      "RUN_FINISHED",
    ]);
  });

  it("keys the message id off the runId", async () => {
    const { next } = scriptedNext([RUN_STARTED, RUN_FINISHED]);

    const events = await collect(
      syntheticReasoningMiddleware(input({ runId: "run-42" }), next),
    );

    const ids = new Set(
      events
        .filter((event) => String(event.type).startsWith("REASONING"))
        .map((event) => (event as { messageId?: string }).messageId),
    );
    expect([...ids]).toEqual(["run-42-reasoning"]);
  });

  it("strips reasoning-role messages from what the backend is asked to run", async () => {
    const { next, seen } = scriptedNext([RUN_STARTED, RUN_FINISHED]);
    const messages = [
      { id: "1", role: "user", content: "hi" },
      { id: "2", role: "reasoning", content: "thinking" },
    ] as unknown as Message[];

    await collect(syntheticReasoningMiddleware(input({ messages }), next));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.messages?.map((message) => message.role)).toEqual(["user"]);
  });

  it("injects exactly once when the stream carries two RUN_STARTED events", async () => {
    // Two reasoning messages sharing one id render as a duplicated bubble.
    const { next } = scriptedNext([RUN_STARTED, RUN_STARTED, RUN_FINISHED]);

    const events = await collect(syntheticReasoningMiddleware(input(), next));

    expect(types(events).filter((type) => type === "REASONING_START")).toEqual([
      "REASONING_START",
    ]);
  });

  it("injects on completion when the backend emitted no RUN_STARTED", async () => {
    // The fallback arm: the cell still renders a reasoning bubble instead of
    // staying blank because a backend answered oddly.
    const { next } = scriptedNext([TEXT]);

    const events = await collect(syntheticReasoningMiddleware(input(), next));

    expect(types(events)).toEqual(["TEXT_MESSAGE_CONTENT", ...INJECTED]);
  });

  it("forwards an error instead of swallowing it or injecting", async () => {
    const { next } = scriptedNext([], new Error("backend exploded"));

    await expect(
      collect(syntheticReasoningMiddleware(input(), next)),
    ).rejects.toThrow("backend exploded");
  });

  it("unsubscribes from the backend when the consumer unsubscribes", async () => {
    // The shim owns a subscription to `next`; leaking it leaves the upstream
    // SSE request open for the life of the process.
    const unsubscribed = vi.fn();
    const next = {
      run: () => new Observable<BaseEvent>(() => unsubscribed),
    } as unknown as AbstractAgent;

    syntheticReasoningMiddleware(input(), next)
      .subscribe({ next: () => {} })
      .unsubscribe();

    expect(unsubscribed).toHaveBeenCalled();
  });
});

describe("applySyntheticReasoning", () => {
  /**
   * The private middleware array, read for the clone assertion below. A COUNT
   * relative to an untouched agent, never an absolute number: `AbstractAgent`'s
   * constructor `unshift`s up to three `BackwardCompatibility_*` middlewares of
   * its own, and that baseline is the SDK's business, not this test's.
   */
  function middlewareCount(agent: AbstractAgent): number {
    return (agent as unknown as { middlewares: unknown[] }).middlewares.length;
  }

  const url = "http://ms-agent-dotnet:8000/reasoning";

  it("marks the agent, and an untouched agent is unmarked", () => {
    const agent = new HttpAgent({ url });
    expect(hasSyntheticReasoning(agent)).toBe(false);
    expect(applySyntheticReasoning(agent)).toBe(agent);
    expect(hasSyntheticReasoning(agent)).toBe(true);
  });

  it("adds exactly one middleware, and clone() carries it", () => {
    // The runtime clones an agent per request, so a shim that did not survive
    // `clone()` would be applied at build time and gone by the time a run
    // happens — the exact failure this port exists to fix, one layer down.
    const baseline = middlewareCount(new HttpAgent({ url }));
    const agent = applySyntheticReasoning(new HttpAgent({ url }));

    expect(middlewareCount(agent)).toBe(baseline + 1);
    expect(middlewareCount(agent.clone())).toBe(baseline + 1);
  });

  it("registers the middleware through use(), so a clone keeps it", () => {
    // `AbstractAgent.clone()` copies `middlewares`, and the runtime clones an
    // agent per request — that is what makes attaching once at build time
    // enough. Asserted through `use` rather than by reading the private array.
    const used: unknown[] = [];
    const agent = {
      use(...middlewares: unknown[]) {
        used.push(...middlewares);
        return this;
      },
    } as unknown as AbstractAgent;

    applySyntheticReasoning(agent);

    expect(used).toHaveLength(1);
    expect(used[0]).toBeInstanceOf(FunctionMiddleware);
  });
});
