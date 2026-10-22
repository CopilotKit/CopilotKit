import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Observable } from "rxjs";
import { EventType, HttpAgent } from "@ag-ui/client";
import type { AbstractAgent, BaseEvent, RunAgentInput } from "@ag-ui/client";
import { THREAD_ALREADY_RUNNING_ERROR_CODE } from "@copilotkit/shared";

vi.mock("../../telemetry", () => ({
  telemetry: { capture: vi.fn() },
}));

import { createSseEventResponse } from "../handlers/shared/sse-response";
import { InMemoryAgentRunner, ThreadAlreadyRunningError } from "../runner";

const busyThreadRunError = {
  type: EventType.RUN_ERROR,
  message: "Thread already running",
  code: THREAD_ALREADY_RUNNING_ERROR_CODE,
};

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
        throw new ThreadAlreadyRunningError();
      },
    });

    expect(await readEvents(response)).toEqual([busyThreadRunError]);
  });

  it("writes RUN_ERROR when the observable factory rejects", async () => {
    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: async () => {
        throw new ThreadAlreadyRunningError();
      },
    });

    expect(await readEvents(response)).toEqual([busyThreadRunError]);
  });

  it("sends the busy-thread code for the in-memory runner's guard", async () => {
    const runner = new InMemoryAgentRunner();
    const threadId = `busy-${Math.random()}`;
    let release!: () => void;
    const agent = {
      agentId: "slow",
      messages: [],
      runAgent: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      abortRun: () => {},
    } as unknown as AbstractAgent;
    const input = (runId: string) =>
      ({
        threadId,
        runId,
        messages: [],
        state: {},
        tools: [],
        context: [],
      }) as unknown as RunAgentInput;
    runner.run({ threadId, agent, input: input("r-1") });

    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () =>
        runner.run({ threadId, agent, input: input("r-2") }),
    });

    expect(await readEvents(response)).toEqual([busyThreadRunError]);
    release();
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
      { type: EventType.RUN_ERROR, message: "Agent run failed" },
    ]);
  });

  it("does not send an unknown error's message to the client", async () => {
    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () => {
        throw new Error("connect ECONNREFUSED 10.0.0.12:5432");
      },
    });

    expect(await readEvents(response)).toEqual([
      { type: EventType.RUN_ERROR, message: "Agent run failed" },
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

  it("ends a later run with RUN_ERROR after earlier runs finished", async () => {
    // /connect replays finished runs before the live one. A failure in the
    // live run must still reach the client.
    const secondRunStarted = { ...runStarted, runId: "r-2" } as BaseEvent;
    const textStart = {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "m-1",
      role: "assistant",
    } as BaseEvent;
    const response = createSseEventResponse({
      request: createMockRequest(),
      observableFactory: () =>
        new Observable<BaseEvent>((subscriber) => {
          subscriber.next(runStarted);
          subscriber.next(runFinished);
          subscriber.next(secondRunStarted);
          subscriber.next(textStart);
          subscriber.error(new Error("late failure"));
        }),
    });

    expect(await readEvents(response)).toEqual([
      runStarted,
      runFinished,
      secondRunStarted,
      textStart,
      { type: EventType.RUN_ERROR, message: "Agent run failed" },
    ]);
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
            throw new ThreadAlreadyRunningError();
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
          code: THREAD_ALREADY_RUNNING_ERROR_CODE,
        }),
      }),
    );
  });
});
