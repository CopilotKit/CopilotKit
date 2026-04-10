/**
 * Test helpers for mocking streamText responses
 */

import type { streamText } from "ai";
import type { Observable } from "rxjs";
import type { BaseEvent } from "@ag-ui/client";

export interface MockStreamEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Creates a mock streamText response with controlled events.
 */
export function mockStreamTextResponse(
  events: MockStreamEvent[],
): ReturnType<typeof streamText> {
  return {
    fullStream: (async function* () {
      for (const event of events) {
        yield event;
      }
    })(),
  } as unknown as ReturnType<typeof streamText>;
}

/**
 * Helper to create a text-start event
 */
export function textStart(id?: string): MockStreamEvent {
  const event: MockStreamEvent = {
    type: "text-start",
  };
  if (id !== undefined) {
    event.id = id;
  }
  return event;
}

/**
 * Helper to create a text delta event
 */
export function textDelta(text: string): MockStreamEvent {
  return {
    type: "text-delta",
    text,
  };
}

/**
 * Helper to create a tool call streaming start event
 */
export function toolCallStreamingStart(
  toolCallId: string,
  toolName: string,
): MockStreamEvent {
  return {
    type: "tool-input-start",
    id: toolCallId,
    toolName,
  };
}

/**
 * Helper to create a tool call delta event
 */
export function toolCallDelta(
  toolCallId: string,
  argsTextDelta: string,
): MockStreamEvent {
  return {
    type: "tool-input-delta",
    id: toolCallId,
    delta: argsTextDelta,
  };
}

/**
 * Helper to create a tool call event
 */
export function toolCall(
  toolCallId: string,
  toolName: string,
  input: unknown = {},
): MockStreamEvent {
  return {
    type: "tool-call",
    toolCallId,
    toolName,
    input,
  };
}

/**
 * Helper to create a tool result event
 */
export function toolResult(
  toolCallId: string,
  toolName: string,
  output: unknown,
): MockStreamEvent {
  return {
    type: "tool-result",
    toolCallId,
    toolName,
    output,
  };
}

/**
 * Helper to create a reasoning-start event
 */
export function reasoningStart(id?: string): MockStreamEvent {
  const event: MockStreamEvent = {
    type: "reasoning-start",
  };
  if (id !== undefined) {
    event.id = id;
  }
  return event;
}

/**
 * Helper to create a reasoning-delta event
 */
export function reasoningDelta(text: string): MockStreamEvent {
  return {
    type: "reasoning-delta",
    text,
  };
}

/**
 * Helper to create a reasoning-end event
 */
export function reasoningEnd(): MockStreamEvent {
  return {
    type: "reasoning-end",
  };
}

/**
 * Helper to create a finish event
 */
export function finish(): MockStreamEvent {
  return {
    type: "finish",
    finishReason: "stop",
  };
}

/**
 * Helper to create an abort event
 */
export function abort(): MockStreamEvent {
  return {
    type: "abort",
  };
}

/**
 * Helper to create an error event
 */
export function error(errorMessage: string): MockStreamEvent {
  return {
    type: "error",
    error: new Error(errorMessage),
  };
}

/**
 * Collects all events from an Observable<BaseEvent> into an array.
 */
export async function collectEvents(
  observable: Observable<BaseEvent>,
): Promise<BaseEvent[]> {
  return new Promise((resolve, reject) => {
    const events: BaseEvent[] = [];
    const timeoutId = setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error("Observable did not complete within timeout"));
    }, 5000);
    const subscription = observable.subscribe({
      next: (event) => events.push(event),
      error: (err: unknown) => {
        clearTimeout(timeoutId);
        reject(err);
      },
      complete: () => {
        clearTimeout(timeoutId);
        resolve(events);
      },
    });
  });
}
