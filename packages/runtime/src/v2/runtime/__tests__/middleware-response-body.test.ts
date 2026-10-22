import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { EMPTY, Observable } from "rxjs";
import { describe, expect, it } from "vitest";

import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type { AfterRequestMiddlewareParameters } from "../core/middleware";
import { CopilotRuntime } from "../core/runtime";
import type { AgentRunner } from "../runner/agent-runner";

class TestAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }

  clone(): AbstractAgent {
    return new TestAgent();
  }
}

const messages = [
  { id: "assistant-1", role: "assistant", content: "Report ready." },
];

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

describe("afterRequestMiddleware response body", () => {
  it.each(["text", "clone"] as const)(
    "lets SSE middleware use response.%s() without consuming the client body",
    async (readMethod) => {
      let observe!: (result: {
        parameters: AfterRequestMiddlewareParameters;
        bodyUsed: boolean;
        body?: string;
        error?: unknown;
      }) => void;
      const observation = new Promise<Parameters<typeof observe>[0]>(
        (resolve) => {
          observe = resolve;
        },
      );
      const runtime = new CopilotRuntime({
        agents: { default: new TestAgent() },
        runner: createRunner(),
        afterRequestMiddleware: async (parameters) => {
          const bodyUsed = parameters.response.bodyUsed;
          try {
            const response =
              readMethod === "clone"
                ? parameters.response.clone()
                : parameters.response;
            observe({ parameters, bodyUsed, body: await response.text() });
          } catch (error) {
            observe({ parameters, bodyUsed, error });
          }
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
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          }),
        }),
      );

      const [clientBody, observed] = await Promise.all([
        response.text(),
        observation,
      ]);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(observed.bodyUsed).toBe(false);
      expect(observed.error).toBeUndefined();
      expect(observed.body).toBe(clientBody);
      expect(clientBody).toContain('"type":"RUN_FINISHED"');
      expect(observed.parameters.messages).toEqual(messages);
      expect(observed.parameters.threadId).toBe("thread-1");
      expect(observed.parameters.runId).toBe("run-1");
    },
  );

  it("keeps non-SSE responses readable with empty parsed messages", async () => {
    let observe!: (parameters: AfterRequestMiddlewareParameters) => void;
    const observation = new Promise<AfterRequestMiddlewareParameters>(
      (resolve) => {
        observe = resolve;
      },
    );
    const runtime = new CopilotRuntime({
      agents: { default: new TestAgent() },
      afterRequestMiddleware: observe,
    });
    const handler = createCopilotRuntimeHandler({ runtime, basePath: "/" });
    const response = await handler(new Request("http://localhost/info"));
    const observed = await observation;

    expect(observed.response.bodyUsed).toBe(false);
    const [clientBody, middlewareBody] = await Promise.all([
      response.text(),
      observed.response.text(),
    ]);
    expect(JSON.parse(clientBody)).toHaveProperty("version");
    expect(middlewareBody).toBe(clientBody);
    expect(observed.messages).toEqual([]);
    expect(observed.threadId).toBeUndefined();
    expect(observed.runId).toBeUndefined();
  });
});
