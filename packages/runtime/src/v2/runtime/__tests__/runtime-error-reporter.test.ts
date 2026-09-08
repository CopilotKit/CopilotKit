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
  it("builds an isolated event with a sanitized request header snapshot", () => {
    const handler = vi.fn<(event: CopilotErrorEvent) => void>();
    const reporter = createRuntimeErrorReporter(handler);
    const request = makeRequest({
      "X-User-Id": "user-1",
      "X-Request-Id": "req-123",
      Authorization: "Bearer secret-token",
      Cookie: "session=abc",
      "X-Api-Key": "api-secret",
      "X-Copilotcloud-Public-Api-Key": "cloud-key",
    });

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
          headers: {
            "x-user-id": "user-1",
            "x-request-id": "req-123",
          },
        },
      },
    });

    const headers = event.context.request!.headers!;
    expect(headers).not.toHaveProperty("authorization");
    expect(headers).not.toHaveProperty("proxy-authorization");
    expect(headers).not.toHaveProperty("cookie");
    expect(headers).not.toHaveProperty("x-api-key");
    expect(headers).not.toHaveProperty("api-key");
    expect(headers).not.toHaveProperty("x-copilotcloud-public-api-key");
    expect(request.headers.get("authorization")).toBe("Bearer secret-token");
    expect(request.headers.get("x-copilotcloud-public-api-key")).toBe(
      "cloud-key",
    );

    headers["x-user-id"] = "changed";
    reporter.report({
      request,
      error: new Error("agent failed again"),
      operation: "agent.run",
      agentId: "default",
      phase: "sse.subscription",
    });

    expect(handler.mock.calls[1][0].context.request!.headers).toEqual({
      "x-user-id": "user-1",
      "x-request-id": "req-123",
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

  it("contains malformed request event construction", () => {
    const handler = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      createRuntimeErrorReporter(handler).report({
        request: {
          method: "POST",
          url: "not-a-url",
          headers: { entries: () => [] },
        } as unknown as Request,
        error: new Error("agent failed"),
        operation: "agent.run",
      });

      expect(handler).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        "CopilotRuntime onError reporting failed:",
        expect.any(TypeError),
      );
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
