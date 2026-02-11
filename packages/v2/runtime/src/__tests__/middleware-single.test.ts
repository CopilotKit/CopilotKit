import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

import { createCopilotEndpointSingleRoute } from "../endpoints";
import { CopilotRuntime } from "../runtime";
import { logger } from "@copilotkitnext/shared";

const dummyRuntime = (opts: Partial<CopilotRuntime> = {}) => {
  const runtime = new CopilotRuntime({
    agents: { agent: {} as unknown as AbstractAgent },
    ...opts,
  });
  return runtime;
};

describe("CopilotEndpointSingleRoute middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildRequest = (body: Record<string, unknown>) =>
    new Request("https://example.com/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("processes request through middleware and handler", async () => {
    const originalRequest = buildRequest({ method: "info" });
    const modifiedRequest = buildRequest({ method: "info" });

    const before = vi.fn().mockResolvedValue(modifiedRequest);
    const after = vi.fn().mockResolvedValue(undefined);

    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });

    const endpoint = createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
    const response = await endpoint.fetch(originalRequest);

    expect(before).toHaveBeenCalledWith({
      runtime,
      request: originalRequest,
      path: expect.any(String),
    });
    expect(after).toHaveBeenCalledWith({
      runtime,
      response,
      path: expect.any(String),
    });
    const body = await response.json();
    expect(body).toHaveProperty("version");
  });

  it("logs and returns Response error from beforeRequestMiddleware", async () => {
    const errorResponse = new Response("Error", { status: 400 });
    const before = vi.fn().mockRejectedValue(errorResponse);
    const after = vi.fn();
    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as unknown as void);

    const endpoint = createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
    const response = await endpoint.fetch(buildRequest({ method: "info" }));

    expect(response.status).toBe(400);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: errorResponse,
        url: "https://example.com/rpc",
        path: expect.any(String),
      }),
      "Error running before request middleware",
    );
    expect(after).not.toHaveBeenCalled();
  });

  it("logs and returns 500 error from beforeRequestMiddleware", async () => {
    const error = new Error("before");
    const before = vi.fn().mockRejectedValue(error);
    const after = vi.fn();
    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as unknown as void);

    const endpoint = createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
    const response = await endpoint.fetch(buildRequest({ method: "info" }));

    expect(response.status).toBe(500);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: error,
        url: "https://example.com/rpc",
        path: expect.any(String),
      }),
      "Error running before request middleware",
    );
    expect(after).not.toHaveBeenCalled();
  });

  it("logs error from handler", async () => {
    const before = vi.fn();
    const after = vi.fn();
    const errorAgent = {
      clone: () => {
        throw new Error("Agent error");
      },
    } as unknown as AbstractAgent;

    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
      agents: { agent: errorAgent },
    });

    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as unknown as void);

    const endpoint = createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
    const response = await endpoint.fetch(
      buildRequest({
        method: "agent/run",
        params: { agentId: "agent" },
        body: {},
      }),
    );

    expect(response.status).toBe(500);
    expect(logSpy).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 50));
    expect(after).toHaveBeenCalled();
  });

  it("logs but does not rethrow error from afterRequestMiddleware", async () => {
    const error = new Error("after");
    const before = vi.fn();
    const after = vi.fn().mockRejectedValue(error);
    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as unknown as void);

    const endpoint = createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
    const response = await endpoint.fetch(buildRequest({ method: "info" }));

    await new Promise((r) => setImmediate(r));

    expect(response).toBeInstanceOf(Response);
    expect(after).toHaveBeenCalledWith({
      runtime,
      response,
      path: expect.any(String),
    });

    await new Promise((r) => setImmediate(r));

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: error,
        url: "https://example.com/rpc",
      }),
      "Error running after request middleware",
    );
  });

});
