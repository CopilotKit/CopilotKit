import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { EMPTY, Observable, of } from "rxjs";
import { describe, expect, it } from "vitest";

import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type { AfterRequestMiddlewareParameters } from "../core/middleware";
import { CopilotRuntime } from "../core/runtime";
import type { AgentRunner } from "../runner/agent-runner";
import {
  CopilotRuntime as PublicCopilotRuntime,
  createCopilotRuntimeHandler as createPublicHandler,
} from "../../index";

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
  it("includes replies streamed after a history snapshot through the public handler", async () => {
    class HistoryAgent extends AbstractAgent {
      run(input: RunAgentInput): Observable<BaseEvent> {
        return of(
          {
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          },
          { type: EventType.MESSAGES_SNAPSHOT, messages: input.messages },
          {
            type: EventType.TEXT_MESSAGE_START,
            messageId: "reply",
            role: "assistant",
          },
          {
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: "reply",
            delta: "你好 🌍",
          },
          { type: EventType.TEXT_MESSAGE_END, messageId: "reply" },
          {
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          },
        );
      }

      clone(): AbstractAgent {
        return new HistoryAgent();
      }
    }

    let observe!: (value: AfterRequestMiddlewareParameters) => void;
    const observation = new Promise<AfterRequestMiddlewareParameters>(
      (resolve) => {
        observe = resolve;
      },
    );
    const runtime = new PublicCopilotRuntime({
      agents: { default: new HistoryAgent() },
      afterRequestMiddleware: observe,
    });
    const handler = createPublicHandler({ runtime, basePath: "/" });
    const response = await handler(
      new Request("http://localhost/agent/default/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "middleware-history-snapshot",
          runId: "snapshot-then-reply",
          messages: [messages[0]],
          state: {},
          tools: [],
          context: [],
          forwardedProps: {},
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("你好 🌍");
    expect(body).not.toContain('"type":"RUN_ERROR"');
    const observed = await observation;
    expect(observed.messages).toEqual([
      messages[0],
      { id: "reply", role: "assistant", content: "你好 🌍" },
    ]);
    expect(observed.threadId).toBe("middleware-history-snapshot");
    expect(observed.runId).toBe("snapshot-then-reply");
  });

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
