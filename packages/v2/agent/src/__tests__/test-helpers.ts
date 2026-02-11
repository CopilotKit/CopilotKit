/**
 * Test helpers for mocking streamText responses
 */

export interface MockStreamEvent {
  type: string;
  [key: string]: any;
}

/**
 * Creates a mock streamText response with controlled events
 */
export function mockStreamTextResponse(events: MockStreamEvent[]) {
  return {
    fullStream: (async function* () {
      for (const event of events) {
        yield event;
      }
    })(),
  };
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
export function toolCallStreamingStart(toolCallId: string, toolName: string): MockStreamEvent {
  return {
    type: "tool-input-start",
    id: toolCallId,
    toolName,
  };
}

/**
 * Helper to create a tool call delta event
 */
export function toolCallDelta(toolCallId: string, argsTextDelta: string): MockStreamEvent {
  return {
    type: "tool-input-delta",
    id: toolCallId,
    delta: argsTextDelta,
  };
}

/**
 * Helper to create a tool call event
 */
export function toolCall(toolCallId: string, toolName: string, input: unknown = {}): MockStreamEvent {
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
export function toolResult(toolCallId: string, toolName: string, output: any): MockStreamEvent {
  return {
    type: "tool-result",
    toolCallId,
    toolName,
    output,
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
 * Helper to create an error event
 */
export function error(errorMessage: string): MockStreamEvent {
  return {
    type: "error",
    error: new Error(errorMessage),
  };
}

/**
 * Collects all events from an Observable into an array
 */
export async function collectEvents<T>(observable: { subscribe: (observer: any) => any }): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const events: T[] = [];
    const subscription = observable.subscribe({
      next: (event: T) => events.push(event),
      error: (err: any) => reject(err),
      complete: () => resolve(events),
    });

    // Set a timeout to prevent hanging tests
    setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error("Observable did not complete within timeout"));
    }, 5000);
  });
}
