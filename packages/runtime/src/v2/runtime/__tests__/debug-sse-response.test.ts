import { describe, it, expect, vi, beforeEach } from "vitest";
import { Observable, of } from "rxjs";
import { BaseEvent, EventType } from "@ag-ui/client";
import type { ResolvedDebugConfig } from "@copilotkit/shared";

const mockDebug = vi.fn();

vi.mock("pino", () => ({
  default: vi.fn(() => ({
    child: vi.fn(() => ({ debug: mockDebug })),
    debug: mockDebug,
  })),
}));

vi.mock("pino-pretty", () => ({ default: vi.fn() }));

vi.mock("../../telemetry", () => ({
  telemetry: { capture: vi.fn() },
}));

import pino from "pino";
import { createSseEventResponse } from "../handlers/shared/sse-response";

function createTestObservable(events: BaseEvent[]): Observable<BaseEvent> {
  return of(...events);
}

function createMockRequest(): Request {
  return new Request("https://example.com/agent/test/run", {
    method: "POST",
  });
}

async function drainResponse(response: Response): Promise<void> {
  const reader = response.body!.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

describe("createSseEventResponse debug logging", () => {
  beforeEach(() => {
    mockDebug.mockClear();
  });

  it("does not log when debug is undefined", async () => {
    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () => createTestObservable([]),
    });

    await drainResponse(response);

    expect(mockDebug).not.toHaveBeenCalled();
  });

  it("logs lifecycle message on stream open", async () => {
    const debug: ResolvedDebugConfig = {
      enabled: true,
      events: false,
      lifecycle: true,
      verbose: false,
    };

    const event: BaseEvent = {
      type: EventType.RUN_STARTED,
      threadId: "t-1",
      runId: "r-1",
    } as BaseEvent;

    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () => createTestObservable([event]),
      debug,
    });

    await drainResponse(response);

    expect(mockDebug).toHaveBeenCalledWith("SSE stream opened");
  });

  it("logs lifecycle completion with total eventCount even when event logging is off", async () => {
    const debug: ResolvedDebugConfig = {
      enabled: true,
      events: false,
      lifecycle: true,
      verbose: false,
    };

    const events: BaseEvent[] = [
      {
        type: EventType.RUN_STARTED,
        threadId: "t-1",
        runId: "r-1",
      } as BaseEvent,
      {
        type: EventType.RUN_FINISHED,
        threadId: "t-1",
        runId: "r-1",
      } as BaseEvent,
    ];

    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () => createTestObservable(events),
      debug,
    });

    await drainResponse(response);

    expect(mockDebug).toHaveBeenCalledWith(
      { eventCount: 2, loggedEventCount: 0 },
      "SSE stream completed",
    );
  });

  it("logs lifecycle completion with matching eventCount and loggedEventCount when events enabled", async () => {
    const debug: ResolvedDebugConfig = {
      enabled: true,
      events: true,
      lifecycle: true,
      verbose: false,
    };

    const events: BaseEvent[] = [
      {
        type: EventType.RUN_STARTED,
        threadId: "t-1",
        runId: "r-1",
      } as BaseEvent,
      {
        type: EventType.RUN_FINISHED,
        threadId: "t-1",
        runId: "r-1",
      } as BaseEvent,
    ];

    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () => createTestObservable(events),
      debug,
    });

    await drainResponse(response);

    expect(mockDebug).toHaveBeenCalledWith(
      { eventCount: 2, loggedEventCount: 2 },
      "SSE stream completed",
    );
  });

  it("logs events in summary mode when verbose is false", async () => {
    const debug: ResolvedDebugConfig = {
      enabled: true,
      events: true,
      lifecycle: false,
      verbose: false,
    };

    const event: BaseEvent = {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-1",
      role: "assistant",
    } as BaseEvent;

    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () => createTestObservable([event]),
      debug,
    });

    await drainResponse(response);

    const eventEmittedCalls = mockDebug.mock.calls.filter(
      (call) => call[call.length - 1] === "Event emitted",
    );
    expect(eventEmittedCalls.length).toBeGreaterThanOrEqual(1);

    const [summaryArg] = eventEmittedCalls[0];
    expect(summaryArg).toHaveProperty("type", EventType.TEXT_MESSAGE_START);
    expect(summaryArg).toHaveProperty("messageId", "msg-1");
    // In summary mode the full event object is not passed directly
    expect(summaryArg).not.toHaveProperty("event");
  });

  it("logs events in verbose mode with full event object", async () => {
    const debug: ResolvedDebugConfig = {
      enabled: true,
      events: true,
      lifecycle: false,
      verbose: true,
    };

    const event: BaseEvent = {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-1",
      role: "assistant",
    } as BaseEvent;

    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () => createTestObservable([event]),
      debug,
    });

    await drainResponse(response);

    const eventEmittedCalls = mockDebug.mock.calls.filter(
      (call) => call[call.length - 1] === "Event emitted",
    );
    expect(eventEmittedCalls.length).toBeGreaterThanOrEqual(1);

    const [verboseArg] = eventEmittedCalls[0];
    expect(verboseArg).toHaveProperty("event");
    expect(verboseArg.event).toEqual(event);
  });

  it("uses a pre-created logger instead of calling createLogger when one is provided", async () => {
    const debug: ResolvedDebugConfig = {
      enabled: true,
      events: false,
      lifecycle: true,
      verbose: false,
    };

    const externalDebug = vi.fn();
    const externalLogger = { debug: externalDebug } as any;

    // Clear the pino mock call count so we can assert it was NOT called again
    const pinoMock = pino as unknown as ReturnType<typeof vi.fn>;
    pinoMock.mockClear();

    const event: BaseEvent = {
      type: EventType.RUN_STARTED,
      threadId: "t-1",
      runId: "r-1",
    } as BaseEvent;

    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () => createTestObservable([event]),
      debug,
      logger: externalLogger,
    });

    await drainResponse(response);

    // The external logger should have been used for lifecycle messages
    expect(externalDebug).toHaveBeenCalledWith("SSE stream opened");
    expect(externalDebug).toHaveBeenCalledWith(
      { eventCount: 1, loggedEventCount: 0 },
      "SSE stream completed",
    );

    // pino should NOT have been called – the pre-created logger was reused
    expect(pinoMock).not.toHaveBeenCalled();
  });

  it("does not log events when events is disabled", async () => {
    const debug: ResolvedDebugConfig = {
      enabled: true,
      events: false,
      lifecycle: true,
      verbose: false,
    };

    const events: BaseEvent[] = [
      {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "msg-1",
        role: "assistant",
      } as BaseEvent,
      {
        type: EventType.RUN_FINISHED,
        threadId: "t-1",
        runId: "r-1",
      } as BaseEvent,
    ];

    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () => createTestObservable(events),
      debug,
    });

    await drainResponse(response);

    const eventEmittedCalls = mockDebug.mock.calls.filter(
      (call) => call[call.length - 1] === "Event emitted",
    );
    expect(eventEmittedCalls).toHaveLength(0);

    // Only lifecycle calls should be present
    const lifecycleCalls = mockDebug.mock.calls.filter(
      (call) =>
        call[call.length - 1] === "SSE stream opened" ||
        call[call.length - 1] === "SSE stream completed",
    );
    expect(lifecycleCalls.length).toBeGreaterThanOrEqual(1);
  });
});
