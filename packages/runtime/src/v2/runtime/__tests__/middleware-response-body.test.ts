import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { EMPTY, Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type { AfterRequestMiddlewareParameters } from "../core/middleware";
import { callAfterRequestMiddleware } from "../core/middleware";
import { CopilotRuntime } from "../core/runtime";
import type { AgentRunner } from "../runner/agent-runner";
import { logger } from "@copilotkit/shared";

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

/** Emit a completed run with a message snapshot for the handler-level tests. */
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
  it("preserves raw SSE bytes and metadata returned by an onResponse hook", async () => {
    // A text round trip would discard the BOM and replace the invalid UTF-8
    // byte in this SSE comment, changing the body available to the callback.
    const url = "data:text/event-stream,%EF%BB%BF%3A%20%FF%0A%0A";
    const response = await fetch(url);
    const expectedBytes = new Uint8Array([
      0xef, 0xbb, 0xbf, 0x3a, 0x20, 0xff, 0x0a, 0x0a,
    ]);
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
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/",
      hooks: { onResponse: () => response },
    });

    const clientResponse = await handler(new Request("http://localhost/info"));
    const observed = await observation;
    expect(observed.messages).toEqual([]);
    expect(observed.response.bodyUsed).toBe(false);
    expect(observed.response.url).toBe(url);
    expect(observed.response.type).toBe(response.type);
    expect(observed.response.redirected).toBe(response.redirected);
    expect(observed.response.status).toBe(response.status);
    expect(observed.response.statusText).toBe(response.statusText);
    expect([...observed.response.headers]).toEqual([...response.headers]);
    const [clientBytes, middlewareBytes] = await Promise.all([
      clientResponse.arrayBuffer(),
      observed.response.arrayBuffer(),
    ]);
    expect(new Uint8Array(clientBytes)).toEqual(expectedBytes);
    expect(new Uint8Array(middlewareBytes)).toEqual(expectedBytes);
  });

  it("still invokes middleware when reading the SSE stream fails", async () => {
    const error = new Error("SSE connection lost");
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(error);
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    const after = vi.fn();
    const runtime = new CopilotRuntime({
      agents: { default: new TestAgent() },
      afterRequestMiddleware: after,
    });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    try {
      await callAfterRequestMiddleware({ runtime, response, path: "/info" });

      expect(after).toHaveBeenCalledOnce();
      const observed = after.mock
        .calls[0][0] as AfterRequestMiddlewareParameters;
      expect(observed.messages).toEqual([]);
      expect(observed.threadId).toBeUndefined();
      expect(observed.runId).toBeUndefined();
      expect(observed.response.bodyUsed).toBe(false);
      await expect(observed.response.text()).rejects.toThrow(
        "SSE connection lost",
      );
      expect(warn).toHaveBeenCalledWith(
        "Failed to read SSE response body in afterRequestMiddleware",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it.each(["application/json", "application/octet-stream", undefined])(
    "propagates cancellation of non-SSE bodies with content type %s",
    async (contentType) => {
      const cancel = vi.fn();
      const clientResponse = new Response(new ReadableStream({ cancel }), {
        headers: contentType ? { "Content-Type": contentType } : undefined,
      });
      let middlewareCancellation: Promise<void> | undefined;
      const runtime = new CopilotRuntime({
        agents: { default: new TestAgent() },
        afterRequestMiddleware: ({ response }) => {
          middlewareCancellation = response.body!.cancel("middleware done");
        },
      });

      await callAfterRequestMiddleware({
        runtime,
        response: clientResponse.clone(),
        path: "/info",
      });
      const clientCancellation = clientResponse.body!.cancel("client done");

      // Both consumers have cancelled; an unread parser clone would keep the
      // source alive and prevent these cancellation promises from settling.
      expect(cancel).toHaveBeenCalledOnce();
      await Promise.all([middlewareCancellation, clientCancellation]);
    },
  );

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
