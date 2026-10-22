import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Observable } from "rxjs";
import { EventType, HttpAgent } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";

vi.mock("../../telemetry", () => ({
  telemetry: { capture: vi.fn() },
}));

import { createSseEventResponse } from "../handlers/shared/sse-response";

function createMockRequest(): Request {
  return new Request("https://example.com/agent/test/run", {
    method: "POST",
  });
}

async function readEvents(response: Response): Promise<BaseEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as BaseEvent);
}

const runStarted = {
  type: EventType.RUN_STARTED,
  threadId: "t-1",
  runId: "r-1",
} as BaseEvent;

const runFinished = {
  type: EventType.RUN_FINISHED,
  threadId: "t-1",
  runId: "r-1",
} as BaseEvent;

describe("createSseEventResponse surfaces failures as RUN_ERROR", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes RUN_ERROR when the observable factory throws", async () => {
    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () => {
        throw new Error("Thread already running");
      },
    });

    expect(await readEvents(response)).toEqual([
      { type: EventType.RUN_ERROR, message: "Thread already running" },
    ]);
  });

  it("writes RUN_ERROR when the observable factory rejects", async () => {
    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: async () => {
        throw new Error("Thread already running");
      },
    });

    expect(await readEvents(response)).toEqual([
      { type: EventType.RUN_ERROR, message: "Thread already running" },
    ]);
  });

  it("ends a started run with RUN_ERROR when the stream errors", async () => {
    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () =>
        new Observable<BaseEvent>((subscriber) => {
          subscriber.next(runStarted);
          subscriber.error(new Error("Timed out joining channel"));
        }),
    });

    expect(await readEvents(response)).toEqual([
      runStarted,
      { type: EventType.RUN_ERROR, message: "Timed out joining channel" },
    ]);
  });

  it("adds nothing when the stream errors after RUN_FINISHED", async () => {
    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () =>
        new Observable<BaseEvent>((subscriber) => {
          subscriber.next(runStarted);
          subscriber.next(runFinished);
          subscriber.error(new Error("late failure"));
        }),
    });

    expect(await readEvents(response)).toEqual([runStarted, runFinished]);
  });

  it("does not add a second RUN_ERROR when the stream already sent one", async () => {
    const runError = {
      type: EventType.RUN_ERROR,
      message: "agent failed",
    } as BaseEvent;
    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () =>
        new Observable<BaseEvent>((subscriber) => {
          subscriber.next(runStarted);
          subscriber.next(runError);
          subscriber.error(new Error("agent failed"));
        }),
    });

    expect(await readEvents(response)).toEqual([runStarted, runError]);
  });

  it("reports the failure to the client instead of an empty run", async () => {
    // A busy thread used to reach the client as an empty stream: runAgent
    // finished with no messages and no error callback. RUN_ERROR reaches
    // onRunErrorEvent, which CopilotKit core surfaces as
    // AGENT_RUN_ERROR_EVENT.
    const agent = new HttpAgent({
      url: "https://example.com/agent/test/run",
      fetch: async (_url: string, init: RequestInit) =>
        createSseEventResponse({
          request: new Request("https://example.com/agent/test/run", {
            method: "POST",
            signal: init.signal ?? undefined,
          }),
          observableFactory: () => {
            throw new Error("Thread already running");
          },
        }),
    } as ConstructorParameters<typeof HttpAgent>[0]);
    const onRunErrorEvent = vi.fn();

    await agent.runAgent({}, { onRunErrorEvent });

    expect(onRunErrorEvent).toHaveBeenCalledTimes(1);
    expect(onRunErrorEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: EventType.RUN_ERROR,
          message: "Thread already running",
        }),
      }),
    );
  });
});
