import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Observable } from "rxjs";
import { of } from "rxjs";
import type {
  BaseEvent,
  RunFinishedEvent,
  RunStartedEvent,
  TextMessageStartEvent,
} from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import type { ResolvedDebugConfig } from "@copilotkit/shared";

const { mockDebug, mockCreateLogger } = vi.hoisted(() => {
  const debug = vi.fn();
  return {
    mockDebug: debug,
    mockCreateLogger: vi.fn(() => ({
      debug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    })),
  };
});

vi.mock("../core/logger", () => ({
  createLogger: mockCreateLogger,
}));

vi.mock("../../telemetry", () => ({
  telemetry: { capture: vi.fn() },
}));

import type { CopilotRuntimeLogger } from "../core/logger";
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

function debugConfig(
  overrides: Partial<ResolvedDebugConfig>,
): ResolvedDebugConfig {
  return {
    enabled: true,
    events: false,
    lifecycle: true,
    verbose: false,
    ...overrides,
  };
}

function runStarted(): RunStartedEvent {
  return { type: EventType.RUN_STARTED, threadId: "t-1", runId: "r-1" };
}

function runFinished(): RunFinishedEvent {
  return { type: EventType.RUN_FINISHED, threadId: "t-1", runId: "r-1" };
}

function textMessageStart(): TextMessageStartEvent {
  return {
    type: EventType.TEXT_MESSAGE_START,
    messageId: "msg-1",
    role: "assistant",
  };
}

async function runStream(
  events: BaseEvent[],
  options: { debug?: ResolvedDebugConfig; logger?: CopilotRuntimeLogger } = {},
) {
  const response = createSseEventResponse({
    request: createMockRequest(),
    observableFactory: () => createTestObservable(events),
    ...options,
  });
  await drainResponse(response);
}

function eventEmittedCalls() {
  return mockDebug.mock.calls.filter(
    (call) => call[call.length - 1] === "Event emitted",
  );
}

describe("createSseEventResponse debug logging", () => {
  beforeEach(() => {
    mockDebug.mockClear();
    mockCreateLogger.mockClear();
  });

  it("does not log when debug is undefined", async () => {
    await runStream([]);

    expect(mockDebug).not.toHaveBeenCalled();
  });

  it("logs lifecycle message on stream open", async () => {
    await runStream([runStarted()], { debug: debugConfig({}) });

    expect(mockDebug).toHaveBeenCalledWith("SSE stream opened");
  });

  it("logs lifecycle completion with total eventCount even when event logging is off", async () => {
    await runStream([runStarted(), runFinished()], {
      debug: debugConfig({}),
    });

    expect(mockDebug).toHaveBeenCalledWith(
      { eventCount: 2, loggedEventCount: 0 },
      "SSE stream completed",
    );
  });

  it("logs lifecycle completion with matching eventCount and loggedEventCount when events enabled", async () => {
    await runStream([runStarted(), runFinished()], {
      debug: debugConfig({ events: true }),
    });

    expect(mockDebug).toHaveBeenCalledWith(
      { eventCount: 2, loggedEventCount: 2 },
      "SSE stream completed",
    );
  });

  it("logs events in summary mode when verbose is false", async () => {
    await runStream([textMessageStart()], {
      debug: debugConfig({ events: true, lifecycle: false }),
    });

    const calls = eventEmittedCalls();
    expect(calls.length).toBeGreaterThanOrEqual(1);

    const [summaryArg] = calls[0];
    expect(summaryArg).toHaveProperty("type", EventType.TEXT_MESSAGE_START);
    expect(summaryArg).toHaveProperty("messageId", "msg-1");
    // In summary mode the full event object is not passed directly
    expect(summaryArg).not.toHaveProperty("event");
  });

  it("logs events in verbose mode with full event object", async () => {
    const event = textMessageStart();

    await runStream([event], {
      debug: debugConfig({ events: true, lifecycle: false, verbose: true }),
    });

    const calls = eventEmittedCalls();
    expect(calls.length).toBeGreaterThanOrEqual(1);

    const [verboseArg] = calls[0];
    expect(verboseArg).toHaveProperty("event");
    expect(verboseArg.event).toEqual(event);
  });

  it("uses a pre-created logger instead of calling createLogger when one is provided", async () => {
    const externalDebug = vi.fn();
    const externalLogger: CopilotRuntimeLogger = {
      debug: externalDebug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };

    await runStream([runStarted()], {
      debug: debugConfig({}),
      logger: externalLogger,
    });

    // The external logger should have been used for lifecycle messages
    expect(externalDebug).toHaveBeenCalledWith("SSE stream opened");
    expect(externalDebug).toHaveBeenCalledWith(
      { eventCount: 1, loggedEventCount: 0 },
      "SSE stream completed",
    );

    // createLogger should NOT have been called: the pre-created logger was reused
    expect(mockCreateLogger).not.toHaveBeenCalled();
  });

  it("does not log events when events is disabled", async () => {
    await runStream([textMessageStart(), runFinished()], {
      debug: debugConfig({}),
    });

    expect(eventEmittedCalls()).toHaveLength(0);

    // Only lifecycle calls should be present
    const lifecycleCalls = mockDebug.mock.calls.filter(
      (call) =>
        call[call.length - 1] === "SSE stream opened" ||
        call[call.length - 1] === "SSE stream completed",
    );
    expect(lifecycleCalls.length).toBeGreaterThanOrEqual(1);
  });
});
