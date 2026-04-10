/**
 * Shared test utilities for BuiltInAgent factory-mode tests.
 *
 * Re-exports everything from the existing test-helpers module and adds
 * BuiltInAgent-specific factories, mock stream builders, and assertion helpers.
 */

import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { BuiltInAgent } from "../index";
import type { AgentFactoryContext, BuiltInAgentFactoryConfig } from "../index";
import type { MockStreamEvent } from "./test-helpers";

// Re-export everything from existing test helpers
export {
  type MockStreamEvent,
  mockStreamTextResponse,
  textStart,
  textDelta,
  toolCallStreamingStart,
  toolCallDelta,
  toolCall,
  toolResult,
  reasoningStart,
  reasoningDelta,
  reasoningEnd,
  finish,
  abort,
  error,
  collectEvents,
} from "./test-helpers";

// Re-export for test files that need to construct agents directly
export {
  BuiltInAgent,
  type AgentFactoryContext,
  type BuiltInAgentFactoryConfig,
};

// ---------------------------------------------------------------------------
// Default input factory
// ---------------------------------------------------------------------------

/**
 * Returns a valid `RunAgentInput` with sensible defaults.
 * Any field can be overridden via the `overrides` parameter.
 */
export function createDefaultInput(overrides?: Partial<RunAgentInput>) {
  return {
    threadId: "test-thread",
    runId: "test-run",
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
    ...overrides,
  } as RunAgentInput;
}

// ---------------------------------------------------------------------------
// TanStack mock stream chunk builders
// ---------------------------------------------------------------------------

/** TanStack text content chunk */
export function tanstackTextChunk(delta: string) {
  return { type: "TEXT_MESSAGE_CONTENT", delta } as const;
}

/** TanStack tool call start chunk */
export function tanstackToolCallStart(
  toolCallId: string,
  toolCallName: string,
) {
  return { type: "TOOL_CALL_START", toolCallId, toolCallName } as const;
}

/** TanStack tool call args chunk */
export function tanstackToolCallArgs(toolCallId: string, delta: string) {
  return { type: "TOOL_CALL_ARGS", toolCallId, delta } as const;
}

/** TanStack tool call end chunk */
export function tanstackToolCallEnd(toolCallId: string) {
  return { type: "TOOL_CALL_END", toolCallId } as const;
}

// ---------------------------------------------------------------------------
// Mock async iterable builders
// ---------------------------------------------------------------------------

/**
 * Creates an `AsyncIterable<unknown>` from an array of TanStack-style chunks.
 */
export function mockTanStackStream(chunks: Record<string, unknown>[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

/**
 * Creates an `AsyncIterable<BaseEvent>` from an array of AG-UI events.
 */
export function mockCustomStream(
  events: BaseEvent[],
): AsyncIterable<BaseEvent> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// BuiltInAgent factories
// ---------------------------------------------------------------------------

export type AgentType = "aisdk" | "tanstack" | "custom";

/**
 * Creates a BuiltInAgent backed by a mock factory that yields the given stream data.
 *
 * Overloaded for each supported agent type:
 * - `"aisdk"` expects `MockStreamEvent[]` (AI SDK fullStream events)
 * - `"tanstack"` expects `Record<string, unknown>[]` (TanStack chunks)
 * - `"custom"` expects `BaseEvent[]` (AG-UI events directly)
 */
export function createAgent(
  type: "aisdk",
  streamData: MockStreamEvent[],
): BuiltInAgent;
export function createAgent(
  type: "tanstack",
  streamData: Record<string, unknown>[],
): BuiltInAgent;
export function createAgent(
  type: "custom",
  streamData: BaseEvent[],
): BuiltInAgent;
export function createAgent(
  type: AgentType,
  streamData: MockStreamEvent[] | Record<string, unknown>[] | BaseEvent[],
): BuiltInAgent;
export function createAgent(
  type: AgentType,
  streamData: MockStreamEvent[] | Record<string, unknown>[] | BaseEvent[],
): BuiltInAgent {
  switch (type) {
    case "aisdk": {
      // Cast needed: TypeScript's control-flow narrowing doesn't propagate
      // through overload signatures to narrow the union parameter type.
      const events = streamData as MockStreamEvent[];
      return new BuiltInAgent({
        type: "aisdk",
        factory: () => ({
          fullStream: (async function* () {
            for (const event of events) {
              yield event;
            }
          })(),
        }),
      });
    }
    case "tanstack": {
      // Cast needed: same overload-narrowing limitation as above.
      const chunks = streamData as Record<string, unknown>[];
      return new BuiltInAgent({
        type: "tanstack",
        factory: () => mockTanStackStream(chunks),
      });
    }
    case "custom": {
      // Cast needed: same overload-narrowing limitation as above.
      const events = streamData as BaseEvent[];
      return new BuiltInAgent({
        type: "custom",
        factory: () => mockCustomStream(events),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Error agent factories
// ---------------------------------------------------------------------------

/**
 * Creates a BuiltInAgent whose factory immediately throws.
 */
export function createThrowingAgent(
  type: AgentType,
  errorMessage: string,
): BuiltInAgent {
  // All three factory signatures accept (ctx) and can throw before returning.
  // Since the factory throws, the return type is irrelevant — TypeScript's
  // `never` return satisfies all three config shapes.
  const thrower = (): never => {
    throw new Error(errorMessage);
  };

  switch (type) {
    case "aisdk":
      return new BuiltInAgent({ type: "aisdk", factory: thrower });
    case "tanstack":
      return new BuiltInAgent({ type: "tanstack", factory: thrower });
    case "custom":
      return new BuiltInAgent({ type: "custom", factory: thrower });
  }
}

/**
 * Creates a BuiltInAgent that yields one partial event and then throws.
 *
 * - `"aisdk"`: yields `{ type: "text-delta", text: "partial" }` then throws
 * - `"tanstack"`: yields `{ type: "TEXT_MESSAGE_CONTENT", delta: "partial" }` then throws
 * - `"custom"`: yields a `TEXT_MESSAGE_CHUNK` BaseEvent then throws
 */
export function createMidStreamErrorAgent(
  type: AgentType,
  errorMessage: string,
): BuiltInAgent {
  switch (type) {
    case "aisdk": {
      return new BuiltInAgent({
        type: "aisdk",
        factory: () => ({
          fullStream: (async function* () {
            yield { type: "text-delta", text: "partial" };
            throw new Error(errorMessage);
          })(),
        }),
      });
    }
    case "tanstack": {
      return new BuiltInAgent({
        type: "tanstack",
        factory: () => ({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: "TEXT_MESSAGE_CONTENT",
              delta: "partial",
            };
            throw new Error(errorMessage);
          },
        }),
      });
    }
    case "custom": {
      return new BuiltInAgent({
        type: "custom",
        factory: () => ({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: EventType.TEXT_MESSAGE_CHUNK,
              role: "assistant",
              delta: "partial",
            } as const as BaseEvent;
            throw new Error(errorMessage);
          },
        }),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Event collection utilities
// ---------------------------------------------------------------------------

/**
 * Result of collecting events from an observable that may error.
 */
export interface CollectedEventsResult {
  events: BaseEvent[];
  /** Whether the observable completed via error (true) or normal completion (false) */
  errored: boolean;
  /** Whether the safety timeout fired (indicates a hung observable) */
  timedOut: boolean;
}

/**
 * Like `collectEvents` but resolves (instead of rejecting) when the
 * observable errors. Returns the events collected up to and including
 * the error point, along with whether it errored or completed normally.
 */
export async function collectEventsIncludingErrors(
  observable: Observable<BaseEvent>,
): Promise<CollectedEventsResult> {
  return new Promise((resolve) => {
    const events: BaseEvent[] = [];
    const timeoutId = setTimeout(() => {
      subscription.unsubscribe();
      resolve({ events, errored: false, timedOut: true });
    }, 5000);
    const subscription = observable.subscribe({
      next: (event) => events.push(event),
      error: () => {
        clearTimeout(timeoutId);
        resolve({ events, errored: true, timedOut: false });
      },
      complete: () => {
        clearTimeout(timeoutId);
        resolve({ events, errored: false, timedOut: false });
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Typed event field accessors (avoids `as any` casts in tests)
// ---------------------------------------------------------------------------

/**
 * Reads a field from a BaseEvent. AG-UI's BaseEvent uses `.passthrough()` so
 * extra fields exist at runtime but aren't in the static type. This helper
 * provides typed access without casts.
 */
export function eventField<T = unknown>(event: BaseEvent, field: string): T {
  return (event as Record<string, unknown>)[field] as T;
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Asserts that the events are wrapped with RUN_STARTED as the first event
 * and RUN_FINISHED as the last event. Optionally checks threadId and runId.
 */
export function expectLifecycleWrapped(
  events: BaseEvent[],
  threadId?: string,
  runId?: string,
): void {
  if (events.length < 2) {
    throw new Error(
      `Expected at least 2 events (RUN_STARTED + RUN_FINISHED), got ${events.length}`,
    );
  }

  const first = events[0];
  const last = events[events.length - 1];

  if (first.type !== EventType.RUN_STARTED) {
    throw new Error(
      `Expected first event to be RUN_STARTED, got ${first.type}`,
    );
  }

  if (last.type !== EventType.RUN_FINISHED) {
    throw new Error(`Expected last event to be RUN_FINISHED, got ${last.type}`);
  }

  if (threadId !== undefined) {
    if (eventField<string>(first, "threadId") !== threadId) {
      throw new Error(
        `Expected RUN_STARTED threadId to be "${threadId}", got "${eventField(first, "threadId")}"`,
      );
    }
    if (eventField<string>(last, "threadId") !== threadId) {
      throw new Error(
        `Expected RUN_FINISHED threadId to be "${threadId}", got "${eventField(last, "threadId")}"`,
      );
    }
  }

  if (runId !== undefined) {
    if (eventField<string>(first, "runId") !== runId) {
      throw new Error(
        `Expected RUN_STARTED runId to be "${runId}", got "${eventField(first, "runId")}"`,
      );
    }
    if (eventField<string>(last, "runId") !== runId) {
      throw new Error(
        `Expected RUN_FINISHED runId to be "${runId}", got "${eventField(last, "runId")}"`,
      );
    }
  }
}

/**
 * Asserts that the event types match the expected sequence exactly.
 */
export function expectEventSequence(
  events: BaseEvent[],
  expectedTypes: EventType[],
): void {
  const actualTypes = events.map((e) => e.type);

  if (actualTypes.length !== expectedTypes.length) {
    throw new Error(
      `Event count mismatch: expected ${expectedTypes.length}, got ${actualTypes.length}.\n` +
        `Expected: [${expectedTypes.join(", ")}]\n` +
        `Actual:   [${actualTypes.join(", ")}]`,
    );
  }

  for (let i = 0; i < expectedTypes.length; i++) {
    if (actualTypes[i] !== expectedTypes[i]) {
      throw new Error(
        `Event type mismatch at index ${i}: expected ${expectedTypes[i]}, got ${actualTypes[i]}.\n` +
          `Expected: [${expectedTypes.join(", ")}]\n` +
          `Actual:   [${actualTypes.join(", ")}]`,
      );
    }
  }
}

/**
 * Asserts that no content events appear after the specified terminal event type.
 *
 * "Content events" are everything except RUN_STARTED, RUN_FINISHED, and RUN_ERROR.
 */
export function expectNoEventAfter(
  events: BaseEvent[],
  terminalType: EventType,
): void {
  const terminalIndex = events.findIndex((e) => e.type === terminalType);
  if (terminalIndex === -1) {
    throw new Error(`Terminal event type ${terminalType} not found in events`);
  }

  const lifecycleTypes = new Set([
    EventType.RUN_STARTED,
    EventType.RUN_FINISHED,
    EventType.RUN_ERROR,
  ]);

  const eventsAfter = events.slice(terminalIndex + 1);
  const contentEventsAfter = eventsAfter.filter(
    (e) => !lifecycleTypes.has(e.type),
  );

  if (contentEventsAfter.length > 0) {
    throw new Error(
      `Found ${contentEventsAfter.length} content event(s) after ${terminalType}: ` +
        `[${contentEventsAfter.map((e) => e.type).join(", ")}]`,
    );
  }
}
