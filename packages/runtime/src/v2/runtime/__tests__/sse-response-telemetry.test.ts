/**
 * Telemetry lifecycle tests for `packages/runtime/src/v2/runtime/handlers/shared/sse-response.ts`.
 *
 * sse-response.ts fires three events across the SSE stream lifecycle:
 *   - oss.runtime.agent_execution_stream_started  (line 73, right after observableFactory resolves)
 *   - oss.runtime.agent_execution_stream_errored  (inside subscribe's error handler)
 *   - oss.runtime.agent_execution_stream_ended    (inside subscribe's complete handler)
 *
 * Paired with intelligence-run-telemetry.test.ts which covers the
 * intelligence/run path of the same event names — kept separate so a
 * regression in one source file fails only its own test.
 */
import type { BaseEvent } from "@ag-ui/client";
import { Observable } from "rxjs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createSseEventResponse } from "../handlers/shared/sse-response";
import { telemetry } from "../telemetry";
import { createRuntimeErrorReporter } from "../core/runtime-error-reporter";

function makeRequest(signal?: AbortSignal): Request {
  return new Request("https://example.com/agent/test/run", {
    method: "POST",
    headers: { "X-User-Id": "issue-2716-user" },
    signal,
  });
}

describe("sse-response.ts — telemetry lifecycle", () => {
  let captureSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureSpy = vi.spyOn(telemetry, "capture").mockResolvedValue(undefined);
    // Swallow the console.error from SSE logError on simulated failures.
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    captureSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("fires agent_execution_stream_started once the observable factory resolves", async () => {
    // Observable that never completes — only started should fire.
    const never = new Observable<BaseEvent>(() => {});
    createSseEventResponse({
      request: makeRequest(),
      observableFactory: () => never,
    });

    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.agent_execution_stream_started",
        {},
      );
    });

    expect(captureSpy).not.toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_errored",
      expect.anything(),
    );
    expect(captureSpy).not.toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_ended",
      expect.anything(),
    );
  });

  it("fires agent_execution_stream_ended when the observable completes", async () => {
    const completing = new Observable<BaseEvent>((subscriber) => {
      subscriber.complete();
    });
    createSseEventResponse({
      request: makeRequest(),
      observableFactory: () => completing,
    });

    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.agent_execution_stream_ended",
        {},
      );
    });

    // started should also have fired before ended
    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_started",
      {},
    );
  });

  it("fires agent_execution_stream_errored with the error message when the observable errors", async () => {
    const failing = new Observable<BaseEvent>((subscriber) => {
      subscriber.error(new Error("stream blew up"));
    });
    createSseEventResponse({
      request: makeRequest(),
      observableFactory: () => failing,
    });

    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.agent_execution_stream_errored",
        expect.objectContaining({ error: "stream blew up" }),
      );
    });

    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_started",
      {},
    );
  });

  it("reports an observable factory failure once and closes the response", async () => {
    const onError = vi.fn();
    const response = createSseEventResponse({
      request: makeRequest(),
      observableFactory: async () => {
        throw new Error("factory failed");
      },
      runtimeErrorReporter: createRuntimeErrorReporter(onError),
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0].context.request.headers).toEqual({
      "x-user-id": "issue-2716-user",
    });
  });

  it("reports a subscription failure once while preserving telemetry and close", async () => {
    const onError = vi.fn();
    const failing = new Observable<BaseEvent>((subscriber) => {
      subscriber.error(new Error("subscription failed"));
    });
    const response = createSseEventResponse({
      request: makeRequest(),
      observableFactory: () => failing,
      runtimeErrorReporter: createRuntimeErrorReporter(onError),
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.agent_execution_stream_errored",
      expect.objectContaining({ error: "subscription failed" }),
    );
  });

  it("reports a RUN_ERROR event as an SSE subscription failure", async () => {
    const onError = vi.fn();
    const failing = new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: "RUN_ERROR",
        message: "run event failed",
      } as BaseEvent);
      subscriber.complete();
    });
    const response = createSseEventResponse({
      request: makeRequest(),
      observableFactory: () => failing,
      runtimeErrorReporter: createRuntimeErrorReporter(onError),
    });

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][0]).toMatchObject({
      error: new Error("run event failed"),
      context: { metadata: { phase: "sse.subscription" } },
    });
  });

  it("does not report successful completion or request abort", async () => {
    const onError = vi.fn();
    const completed = new Observable<BaseEvent>((subscriber) => {
      subscriber.complete();
    });
    const response = createSseEventResponse({
      request: makeRequest(),
      observableFactory: () => completed,
      runtimeErrorReporter: createRuntimeErrorReporter(onError),
    });
    await response.text();

    const controller = new AbortController();
    createSseEventResponse({
      request: makeRequest(controller.signal),
      observableFactory: () => new Observable<BaseEvent>(() => {}),
      runtimeErrorReporter: createRuntimeErrorReporter(onError),
    });
    controller.abort();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).not.toHaveBeenCalled();
  });
});
