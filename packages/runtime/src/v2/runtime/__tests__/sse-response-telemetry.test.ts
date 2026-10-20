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

  it("carries executionSeed onto stream_ended", async () => {
    // `llmHostClass` is knowable from the agent's config and never appears on
    // a streamed event, so the seed is the only path it has onto telemetry.
    const completing = new Observable<BaseEvent>((subscriber) => {
      subscriber.complete();
    });
    createSseEventResponse({
      request: makeRequest(),
      observableFactory: () => completing,
      executionSeed: { llmHostClass: "azure" },
    });

    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.agent_execution_stream_ended",
        { llmHostClass: "azure" },
      );
    });
  });

  it("carries executionSeed onto stream_errored", async () => {
    const failing = new Observable<BaseEvent>((subscriber) => {
      subscriber.error(new Error("upstream exploded"));
    });
    createSseEventResponse({
      request: makeRequest(),
      observableFactory: () => failing,
      executionSeed: { llmHostClass: "openrouter" },
    });

    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.agent_execution_stream_errored",
        expect.objectContaining({ llmHostClass: "openrouter" }),
      );
    });
  });

  it("reports provider, model, and LangGraph facts scraped off the stream", async () => {
    // This enrichment used to live in the v1 TelemetryAgentRunner, which
    // wrapped the runner only to collect it and emitted a second copy of
    // every stream event to carry it. The v1 entrypoint no longer wraps, so
    // if this regressed the data would vanish rather than duplicate.
    const enriched = new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: "TEXT_MESSAGE_END",
        messageId: "m1",
        rawEvent: { data: { output: { model: "gpt-4o" } } },
      } as unknown as BaseEvent);
      subscriber.next({
        type: "TEXT_MESSAGE_END",
        messageId: "m2",
        rawEvent: {
          metadata: { langgraph_host: "cloud", langgraph_version: "0.2.1" },
        },
      } as unknown as BaseEvent);
      subscriber.complete();
    });
    createSseEventResponse({
      request: makeRequest(),
      observableFactory: () => enriched,
    });

    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.agent_execution_stream_ended",
        {
          model: "gpt-4o",
          provider: "gpt-4o",
          langGraphHost: "cloud",
          langGraphVersion: "0.2.1",
        },
      );
    });
  });

  it("carries the scraped facts on a stream that errors part way through", async () => {
    const failingAfterMetadata = new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: "TEXT_MESSAGE_END",
        messageId: "m1",
        rawEvent: { data: { output: { model: "claude-opus-5" } } },
      } as unknown as BaseEvent);
      subscriber.error(new Error("upstream died"));
    });
    createSseEventResponse({
      request: makeRequest(),
      observableFactory: () => failingAfterMetadata,
    });

    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.agent_execution_stream_errored",
        {
          error: "upstream died",
          model: "claude-opus-5",
          provider: "claude-opus-5",
        },
      );
    });
  });

  it("reports an empty record when the stream carries no raw upstream events", async () => {
    // Most agents send nothing to scrape. The event must stay `{}` rather
    // than grow keys with undefined values.
    const plain = new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: "TEXT_MESSAGE_END",
        messageId: "m1",
      } as unknown as BaseEvent);
      subscriber.complete();
    });
    createSseEventResponse({
      request: makeRequest(),
      observableFactory: () => plain,
    });

    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.agent_execution_stream_ended",
        {},
      );
    });
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
