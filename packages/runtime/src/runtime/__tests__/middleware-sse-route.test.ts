import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { EMPTY, Observable } from "rxjs";
import { describe, expect, it } from "vitest";

import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type { AfterRequestMiddlewareParameters } from "../core/middleware";
import { CopilotRuntime } from "../core/runtime";
import type { AgentRunner } from "../runner/agent-runner";

const messages = [
  { id: "user-1", role: "user", content: "What is the status?" },
  { id: "assistant-1", role: "assistant", content: "All green." },
];

class SseTestAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }

  clone(): AbstractAgent {
    return new SseTestAgent();
  }
}

function createRunner(): AgentRunner {
  return {
    run: () =>
      new Observable<BaseEvent>((subscriber) => {
        subscriber.next({
          type: EventType.RUN_STARTED,
          threadId: "thread-1",
          runId: "run-1",
        } as BaseEvent);
        subscriber.next({
          type: EventType.MESSAGES_SNAPSHOT,
          messages,
        } as BaseEvent);
        subscriber.next({
          type: EventType.RUN_FINISHED,
          threadId: "thread-1",
          runId: "run-1",
        } as BaseEvent);
        subscriber.complete();
      }),
    connect: () => EMPTY,
    isRunning: async () => false,
    stop: async () => false,
  } as unknown as AgentRunner;
}

describe("SSE afterRequestMiddleware", () => {
  it("receives messages and run identifiers from an agent route", async () => {
    let resolveObservation!: (value: AfterRequestMiddlewareParameters) => void;
    const observation = new Promise<AfterRequestMiddlewareParameters>(
      (resolve) => {
        resolveObservation = resolve;
      },
    );
    const runtime = new CopilotRuntime({
      agents: { default: new SseTestAgent() },
      runner: createRunner(),
      afterRequestMiddleware: (parameters) => {
        resolveObservation(parameters);
      },
    });
    const handler = createCopilotRuntimeHandler({ runtime, basePath: "/" });

    const response = await handler(
      new Request("http://localhost/agent/default/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "thread-1",
          runId: "run-1",
          messages: [messages[0]],
          state: {},
          tools: [],
          context: [],
          forwardedProps: {},
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const observed = await observation;
    if (!observed.messages?.length) {
      throw new Error("afterRequestMiddleware received no SSE messages");
    }

    expect(observed.messages).toEqual(messages);
    expect(observed.threadId).toBe("thread-1");
    expect(observed.runId).toBe("run-1");
  });
});
