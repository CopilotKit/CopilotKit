import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

import { createCopilotEndpointExpress } from "../express";
import { CopilotRuntime } from "../runtime";
import { logger } from "@copilotkitnext/shared";

const dummyRuntime = (opts: Partial<CopilotRuntime> = {}) => {
  const runtime = new CopilotRuntime({
    agents: { agent: {} as unknown as AbstractAgent },
    ...opts,
  });
  return runtime;
};

describe("CopilotEndpointExpress middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const buildApp = (runtime: CopilotRuntime) => {
    const app = express();
    app.use(createCopilotEndpointExpress({ runtime, basePath: "/" }));
    return app;
  };

  it("processes request through middleware and handler", async () => {
    const modifiedRequest = new Request("https://example.com/info", {
      headers: { "x-modified": "yes" },
    });

    const before = vi.fn().mockResolvedValue(modifiedRequest);
    const after = vi.fn().mockResolvedValue(undefined);

    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });

    const app = buildApp(runtime);
    const response = await request(app).get("/info");

    expect(before).toHaveBeenCalledWith({
      runtime,
      request: expect.any(Request),
      path: "/info",
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(after).toHaveBeenCalledWith({
      runtime,
      response: expect.any(Response),
      path: "/info",
    });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("version");
  });

  it("returns Response from before middleware", async () => {
    const errorResponse = new Response("Error", { status: 400 });
    const before = vi.fn().mockRejectedValue(errorResponse);
    const after = vi.fn();
    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as unknown as void);

    const app = buildApp(runtime);
    const response = await request(app).get("/info");

    expect(response.status).toBe(400);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: errorResponse,
        url: expect.stringContaining("/info"),
        path: "/info",
      }),
      "Error running before request middleware",
    );
    expect(after).not.toHaveBeenCalled();
  });

  it("logs and returns 500 when before middleware throws", async () => {
    const error = new Error("before");
    const before = vi.fn().mockRejectedValue(error);
    const after = vi.fn();
    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as unknown as void);

    const app = buildApp(runtime);
    const response = await request(app).get("/info");

    expect(response.status).toBe(500);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: error,
        url: expect.stringContaining("/info"),
        path: "/info",
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
    const response = await request(app)
      .post("/agent/agent/run")
      .set("Content-Type", "application/json")
      .send({});

    expect(response.status).toBe(500);
    expect(logSpy).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(after).toHaveBeenCalled();
  });

  it("logs error from after middleware", async () => {
    const error = new Error("after");
    const before = vi.fn();
    const after = vi.fn().mockRejectedValue(error);
    const runtime = dummyRuntime({
      beforeRequestMiddleware: before,
      afterRequestMiddleware: after,
    });
    const logSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined as unknown as void);

    const app = buildApp(runtime);
    const response = await request(app).get("/info");

    expect(response.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(after).toHaveBeenCalledWith({
      runtime,
      response: expect.any(Response),
      path: "/info",
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: error,
        url: expect.stringContaining("/info"),
        path: "/info",
      }),
      "Error running after request middleware",
    );
  });
});
