import { describe, expect, it, vi } from "vitest";
import type { CopilotErrorEvent } from "@copilotkit/shared";

import {
  attachRuntimeErrorReporter,
  createRuntimeErrorReporter,
  getRuntimeErrorReporter,
} from "../core/runtime-error-reporter";

function makeRequest(headers?: Record<string, string>): Request {
  return new Request("https://example.com/agent/default/run", {
    method: "POST",
    headers,
  });
}

describe("runtime error reporter", () => {
  it("builds an isolated event with a request header snapshot", () => {
    const handler = vi.fn<(event: CopilotErrorEvent) => void>();
    const reporter = createRuntimeErrorReporter(handler);
    const request = makeRequest({ "X-User-Id": "user-1" });

    reporter.report({
      request,
      error: new Error("agent failed"),
      operation: "agent.run",
      agentId: "default",
      phase: "common",
    });

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0];
    expect(event).toMatchObject({
      type: "error",
      error: expect.any(Error),
      context: {
        source: "runtime",
        agent: { name: "default" },
        request: {
          operation: "agent.run",
          headers: { "x-user-id": "user-1" },
        },
      },
    });

    event.context.request!.headers!["x-user-id"] = "changed";
    reporter.report({
      request,
      error: new Error("agent failed again"),
      operation: "agent.run",
      agentId: "default",
      phase: "sse.subscription",
    });

    expect(handler.mock.calls[1][0].context.request!.headers).toEqual({
      "x-user-id": "user-1",
    });
    expect(request.headers.get("x-user-id")).toBe("user-1");
  });

  it("does nothing without a handler and contains handler rejection", async () => {
    const absent = createRuntimeErrorReporter();
    absent.report({
      request: makeRequest(),
      error: new Error("ignored"),
      operation: "agent.run",
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const rejecting = createRuntimeErrorReporter(
        vi.fn().mockRejectedValue(new Error("callback failed")),
      );
      rejecting.report({
        request: makeRequest(),
        error: new Error("agent failed"),
        operation: "agent.run",
      });
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledOnce());
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("keeps reporter state isolated per runtime instance", () => {
    const first = {};
    const second = {};
    const firstReporter = createRuntimeErrorReporter(vi.fn());
    const secondReporter = createRuntimeErrorReporter(vi.fn());

    attachRuntimeErrorReporter(first, firstReporter);
    attachRuntimeErrorReporter(second, secondReporter);

    expect(getRuntimeErrorReporter(first as never)).toBe(firstReporter);
    expect(getRuntimeErrorReporter(second as never)).toBe(secondReporter);
  });
});
