import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
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

vi.mock("../../telemetry", () => ({
  telemetry: { capture: vi.fn() },
}));

import type { CopilotKitRuntimeLogger } from "../core/logger";
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
  options: {
    debug?: ResolvedDebugConfig;
    debugLogger?: CopilotKitRuntimeLogger;
  } = {},
) {
  const response = createSseEventResponse({
    request: createMockRequest(),
    observableFactory: () => createTestObservable(events),
    ...options,
  });
  await drainResponse(response);
}

interface DebugLine {
  level: number;
  component?: string;
  msg?: string;
  eventCount?: number;
  loggedEventCount?: number;
  type?: string;
  messageId?: string;
  event?: BaseEvent;
}

// With no app logger, debug output is JSON lines written by console.log.
let consoleLog: MockInstance<Console["log"]>;

function debugLines(): DebugLine[] {
  return consoleLog.mock.calls.map(([line]) => JSON.parse(String(line)));
}

function linesWithMessage(msg: string) {
  return debugLines().filter((line) => line.msg === msg);
}

describe("createSseEventResponse debug logging", () => {
  beforeEach(() => {
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLog.mockRestore();
  });

  it("does not log when debug is undefined", async () => {
    await runStream([]);

    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("logs lifecycle message on stream open", async () => {
    await runStream([runStarted()], { debug: debugConfig({}) });

    expect(linesWithMessage("SSE stream opened")).toEqual([
      expect.objectContaining({ level: 20, component: "copilotkit-debug" }),
    ]);
  });

  it("logs lifecycle completion with total eventCount even when event logging is off", async () => {
    await runStream([runStarted(), runFinished()], {
      debug: debugConfig({}),
    });

    expect(linesWithMessage("SSE stream completed")).toEqual([
      expect.objectContaining({ eventCount: 2, loggedEventCount: 0 }),
    ]);
  });

  it("logs lifecycle completion with matching eventCount and loggedEventCount when events enabled", async () => {
    await runStream([runStarted(), runFinished()], {
      debug: debugConfig({ events: true }),
    });

    expect(linesWithMessage("SSE stream completed")).toEqual([
      expect.objectContaining({ eventCount: 2, loggedEventCount: 2 }),
    ]);
  });

  it("logs events in summary mode when verbose is false", async () => {
    await runStream([textMessageStart()], {
      debug: debugConfig({ events: true, lifecycle: false }),
    });

    const [summary] = linesWithMessage("Event emitted");
    expect(summary).toMatchObject({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "msg-1",
    });
    // In summary mode the full event object is not written
    expect(summary).not.toHaveProperty("event");
  });

  it("logs events in verbose mode with full event object", async () => {
    const event = textMessageStart();

    await runStream([event], {
      debug: debugConfig({ events: true, lifecycle: false, verbose: true }),
    });

    const [verbose] = linesWithMessage("Event emitted");
    expect(verbose.event).toEqual({
      type: "TEXT_MESSAGE_START",
      messageId: "msg-1",
      role: "assistant",
    });
  });

  it("writes to a pre-created debug logger instead of the console when one is provided", async () => {
    const externalDebug = vi.fn();
    const externalLogger: CopilotKitRuntimeLogger = {
      debug: externalDebug,
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await runStream([runStarted()], {
      debug: debugConfig({}),
      debugLogger: externalLogger,
    });

    expect(externalDebug).toHaveBeenCalledWith("SSE stream opened");
    expect(externalDebug).toHaveBeenCalledWith(
      { eventCount: 1, loggedEventCount: 0 },
      "SSE stream completed",
    );
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("does not log events when events is disabled", async () => {
    await runStream([textMessageStart(), runFinished()], {
      debug: debugConfig({}),
    });

    expect(linesWithMessage("Event emitted")).toHaveLength(0);
    expect(linesWithMessage("SSE stream opened")).toHaveLength(1);
  });
});
