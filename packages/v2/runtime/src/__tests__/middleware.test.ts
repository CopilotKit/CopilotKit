import { vi, type MockedFunction } from "vitest";
import { createCopilotEndpoint } from "../endpoints";
import { CopilotRuntime } from "../runtime";
import { logger } from "@copilotkitnext/shared";
import type { AbstractAgent } from "@ag-ui/client";
import { WebhookStage } from "../middleware";
import { afterEach, describe, expect, it } from "vitest";

const dummyRuntime = (opts: Partial<CopilotRuntime> = {}) => {
  const runtime = new CopilotRuntime({
    agents: { agent: {} as unknown as AbstractAgent },
    ...opts,
  });
  return runtime;
};

describe("CopilotEndpoint middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // restore global fetch if it was mocked
    if (fetchMock) {
      global.fetch = originalFetch;
    }
  });

  let originalFetch: typeof fetch;
  let fetchMock: MockedFunction<typeof fetch> | null = null;

  const setupFetchMock = (beforeUrl: string, afterUrl: string) => {
    originalFetch = global.fetch;
    fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === beforeUrl) {
        const body = {
          headers: { "x-modified": "yes" },
          body: { foo: "bar" },
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === afterUrl) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    // Override global fetch for the duration of this test
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    global.fetch = fetchMock as unknown as typeof fetch;
  };

  it("processes request through middleware and handler", async () => {
    const originalRequest = new Request("https://example.com/info");
    const modifiedRequest = new Request("https://example.com/info", {
      headers: { "x-modified": "yes" },
    });

    const before = vi.fn().mockResolvedValue(modifiedRequest);
    const after = vi.fn().mockResolvedValue(undefined);

    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });

    const endpoint = createCopilotEndpoint({ runtime, basePath: "/" });
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
    // The response should contain version info from the /info endpoint
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
    const logSpy = vi
      .spyOn(logger, "error")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(() => undefined as any);

    const endpoint = createCopilotEndpoint({ runtime, basePath: "/" });
    const response = await endpoint.fetch(
      new Request("https://example.com/info")
    );

    expect(response.status).toBe(400);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: errorResponse,
        url: "https://example.com/info",
        path: expect.any(String),
      }),
      "Error running before request middleware"
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
    const logSpy = vi
      .spyOn(logger, "error")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(() => undefined as any);

    const endpoint = createCopilotEndpoint({ runtime, basePath: "/" });

    const response = await endpoint.fetch(
      new Request("https://example.com/info")
    );

    // Hono catches errors and returns them as 500 responses
    expect(response.status).toBe(500);

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: error,
        url: "https://example.com/info",
        path: expect.any(String),
      }),
      "Error running before request middleware"
    );
    expect(after).not.toHaveBeenCalled();
  });

  it("logs error from handler", async () => {
    // Create a mock agent that throws an error
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
      agents: { errorAgent },
    });
    const logSpy = vi
      .spyOn(logger, "error")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(() => undefined as any);

    const endpoint = createCopilotEndpoint({ runtime, basePath: "/" });

    const response = await endpoint.fetch(
      new Request("https://example.com/agent/errorAgent/run", {
        method: "POST",
      })
    );

    // Hono catches errors and returns them as 500 responses
    expect(response.status).toBe(500);

    // The actual handler logs the error, not the middleware
    expect(logSpy).toHaveBeenCalled();
    // After middleware is called even on error
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
    const logSpy = vi
      .spyOn(logger, "error")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(() => undefined as any);

    const endpoint = createCopilotEndpoint({ runtime, basePath: "/" });
    const response = await endpoint.fetch(
      new Request("https://example.com/info")
    );

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
        url: "https://example.com/info",
      }),
      "Error running after request middleware"
    );
  });
});
