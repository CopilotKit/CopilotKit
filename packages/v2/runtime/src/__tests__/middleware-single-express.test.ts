import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

import { createCopilotEndpointSingleRouteExpress } from "../express";
import { CopilotRuntime } from "../runtime";
import { logger } from "@copilotkitnext/shared";

const dummyRuntime = (opts: Partial<CopilotRuntime> = {}) => {
  const runtime = new CopilotRuntime({
    agents: { agent: {} as unknown as AbstractAgent },
    ...opts,
  });
  return runtime;
};

describe("CopilotEndpointSingleRouteExpress middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildApp = (runtime: CopilotRuntime) => {
    const app = express();
    app.use(createCopilotEndpointSingleRouteExpress({ runtime, basePath: "/rpc" }));
    return app;
  };

  const rpcRequest = (app: express.Express, body: Record<string, unknown>) =>
    request(app).post("/rpc").set("Content-Type", "application/json").send(body);

  it("processes middleware and handler", async () => {
    const before = vi.fn().mockResolvedValue(undefined);
    const after = vi.fn().mockResolvedValue(undefined);

    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });

    const app = buildApp(runtime);
    const response = await rpcRequest(app, { method: "info" });

    expect(before).toHaveBeenCalledWith({
      runtime,
      request: expect.any(Request),
      path: "/rpc",
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(after).toHaveBeenCalledWith({
      runtime,
      response: expect.any(Response),
      path: "/rpc",
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("version");
  });

  it("handles Response error from before middleware", async () => {
    const errorResponse = new Response("Error", { status: 400 });
    const before = vi.fn().mockRejectedValue(errorResponse);
    const after = vi.fn();
    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as unknown as void);

    const app = buildApp(runtime);
    const response = await rpcRequest(app, { method: "info" });

    expect(response.status).toBe(400);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: errorResponse,
        url: expect.stringContaining("/rpc"),
        path: "/rpc",
      }),
      "Error running before request middleware",
    );
    expect(after).not.toHaveBeenCalled();
  });

  it("logs thrown error from before middleware", async () => {
    const error = new Error("before");
    const before = vi.fn().mockRejectedValue(error);
    const after = vi.fn();
    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as unknown as void);

    const app = buildApp(runtime);
    const response = await rpcRequest(app, { method: "info" });

    expect(response.status).toBe(500);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: error,
        url: expect.stringContaining("/rpc"),
        path: "/rpc",
      }),
      "Error running before request middleware",
    );
    expect(after).not.toHaveBeenCalled();
  });

  it("logs handler error", async () => {
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

    const app = buildApp(runtime);
    const response = await rpcRequest(app, {
      method: "agent/run",
      params: { agentId: "agent" },
      body: {},
    });

    expect(response.status).toBe(500);
    expect(logSpy).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(after).toHaveBeenCalled();
  });

  it("logs errors from after middleware", async () => {
    const error = new Error("after");
    const before = vi.fn();
    const after = vi.fn().mockRejectedValue(error);
    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as unknown as void);

    const app = buildApp(runtime);
    const response = await rpcRequest(app, { method: "info" });

    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(after).toHaveBeenCalledWith({
      runtime,
      response: expect.any(Response),
      path: "/rpc",
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: error,
        url: expect.stringContaining("/rpc"),
        path: "/rpc",
      }),
      "Error running after request middleware",
    );
  });
});
