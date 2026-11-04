import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { EMPTY, Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotRuntime } from "../core/runtime";
import type { AgentRunner } from "../runner/agent-runner";

class SseTestAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }
  clone(): AbstractAgent {
    return new SseTestAgent();
  }
}

/** A runner whose run starts and then never completes. */
function createOpenRunner(state: { unsubscribed: boolean }): AgentRunner {
  return {
    run: () =>
      new Observable<BaseEvent>((subscriber) => {
        subscriber.next({
          type: EventType.RUN_STARTED,
          threadId: "thread-1",
          runId: "run-1",
        } as BaseEvent);
        return () => {
          state.unsubscribed = true;
        };
      }),
    connect: () => EMPTY,
    isRunning: async () => false,
    stop: async () => false,
  } as unknown as AgentRunner;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startRun(afterRequestMiddleware?: () => void) {
  const state = { unsubscribed: false };
  const runtime = new CopilotRuntime({
    agents: { default: new SseTestAgent() },
    runner: createOpenRunner(state),
    // Short keep-alive, so a stream left open keeps producing frames.
    sseKeepAliveIntervalSeconds: 0.05,
    ...(afterRequestMiddleware ? { afterRequestMiddleware } : {}),
  });
  const handler = createCopilotRuntimeHandler({ runtime, basePath: "/" });
  const controller = new AbortController();
  const response = await handler(
    new Request("http://localhost/agent/default/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "thread-1",
        runId: "run-1",
        messages: [{ id: "u1", role: "user", content: "hi" }],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      }),
      signal: controller.signal,
    }),
  );
  const reader = response.body!.getReader();
  await reader.read(); // RUN_STARTED
  return { state, controller, reader };
}

/**
 * Abort the request the way the Node and Express adapters do on a socket
 * close: the signal aborts, and the adapter keeps reading the body until it
 * ends. Resolves true if the body ended within the timeout.
 */
async function abortAndDrain(
  controller: AbortController,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 500,
): Promise<boolean> {
  controller.abort();
  const drained = (async () => {
    while (!(await reader.read()).done) {
      // Keep-alive frames until the stream closes.
    }
    return true;
  })();
  const ended = await Promise.race([
    drained,
    sleep(timeoutMs).then(() => false),
  ]);
  // Not awaited: on a stream that never closes, cancel() never settles either.
  if (!ended) void reader.cancel().catch(() => {});
  return ended;
}

describe("SSE response on client abort", () => {
  it("stops the agent and closes the stream", async () => {
    const { state, controller, reader } = await startRun();

    expect(await abortAndDrain(controller, reader)).toBe(true);
    expect(state.unsubscribed).toBe(true);
  });

  it("runs afterRequestMiddleware once the aborted stream ends", async () => {
    const afterRequestMiddleware = vi.fn();
    const { controller, reader } = await startRun(afterRequestMiddleware);

    expect(await abortAndDrain(controller, reader)).toBe(true);
    await vi.waitFor(() =>
      expect(afterRequestMiddleware).toHaveBeenCalledTimes(1),
    );
    expect(afterRequestMiddleware.mock.calls[0][0]).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
    });
  });
});
