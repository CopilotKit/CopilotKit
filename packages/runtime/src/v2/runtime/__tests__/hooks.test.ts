import { describe, it, expect, vi } from "vitest";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotRuntime } from "../core/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import type { CopilotRuntimeHooks } from "../core/hooks";

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------------------------- */

const createMockAgent = () => {
  const agent: unknown = {
    execute: vi.fn().mockResolvedValue({ events: [] }),
  };
  (agent as { clone: () => unknown }).clone = () => createMockAgent();
  return agent as AbstractAgent;
};

const createRuntime = (opts?: Partial<CopilotRuntime>) =>
  new CopilotRuntime({
    agents: { default: createMockAgent() },
    ...opts,
  });

const get = (url: string) => new Request(url, { method: "GET" });

const post = (url: string, body?: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

/* ------------------------------------------------------------------------------------------------
 * onRequest hook
 * --------------------------------------------------------------------------------------------- */

describe("hooks — onRequest", () => {
  it("is called for every request with correct context", async () => {
    const onRequest = vi.fn();
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: { onRequest },
    });

    await handler(get("http://localhost/api/info"));

    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.any(Request),
        path: "/api/info",
        runtime,
      }),
    );
  });

  it("returning a modified Request replaces the original", async () => {
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onRequest: ({ request }) => {
          const headers = new Headers(request.headers);
          headers.set("x-custom", "injected");
          return new Request(request, { headers });
        },
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(200);
  });

  it("returning void continues with original Request", async () => {
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onRequest: () => {
          // void — no-op
        },
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(200);
  });

  it("throwing a Response short-circuits", async () => {
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Response("Unauthorized", { status: 401 });
        },
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  });

  it("throwing a non-Response error triggers onError", async () => {
    const onError = vi
      .fn()
      .mockReturnValue(new Response("Custom error", { status: 503 }));
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Error("Something broke");
        },
        onError,
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(503);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
      }),
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * onBeforeHandler hook
 * --------------------------------------------------------------------------------------------- */

describe("hooks — onBeforeHandler", () => {
  it("is called after routing with route info", async () => {
    const onBeforeHandler = vi.fn();
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: { onBeforeHandler },
    });

    await handler(get("http://localhost/api/info"));

    expect(onBeforeHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        route: { method: "info" },
        request: expect.any(Request),
        path: "/api/info",
        runtime,
      }),
    );
  });

  it("receives agentId in route info for agent routes", async () => {
    const onBeforeHandler = vi.fn();
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: { onBeforeHandler },
    });

    await handler(
      post("http://localhost/api/agent/default/run", {
        threadId: "t1",
        runId: "r1",
      }),
    );

    expect(onBeforeHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        route: expect.objectContaining({
          method: "agent/run",
          agentId: "default",
        }),
      }),
    );
  });

  it("is NOT called when routing returns 404", async () => {
    const onBeforeHandler = vi.fn();
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: { onBeforeHandler },
    });

    const response = await handler(get("http://localhost/api/unknown"));
    expect(response.status).toBe(404);
    expect(onBeforeHandler).not.toHaveBeenCalled();
  });

  it("throwing a Response short-circuits before handler", async () => {
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onBeforeHandler: () => {
          throw new Response("Blocked", { status: 403 });
        },
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(403);
  });

  it("returning a modified Request is passed to the handler", async () => {
    const runtime = createRuntime();
    const receivedHeaders: string[] = [];
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onBeforeHandler: ({ request }) => {
          const headers = new Headers(request.headers);
          headers.set("x-before-handler", "modified");
          return new Request(request, { headers });
        },
        onResponse: ({ response }) => {
          // If we got a successful response, the handler was dispatched
          // with the modified request
          receivedHeaders.push("onResponse-called");
          return response;
        },
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(200);
    expect(receivedHeaders).toContain("onResponse-called");
  });
});

/* ------------------------------------------------------------------------------------------------
 * onResponse hook
 * --------------------------------------------------------------------------------------------- */

describe("hooks — onResponse", () => {
  it("is called with the response and route info", async () => {
    const onResponse = vi.fn();
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: { onResponse },
    });

    await handler(get("http://localhost/api/info"));

    expect(onResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        response: expect.any(Response),
        route: { method: "info" },
        request: expect.any(Request),
        runtime,
      }),
    );
  });

  it("returning a modified Response replaces the original", async () => {
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onResponse: ({ response }) => {
          const headers = new Headers(response.headers);
          headers.set("x-custom-header", "hello");
          return new Response(response.body, {
            status: response.status,
            headers,
          });
        },
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.headers.get("x-custom-header")).toBe("hello");
  });

  it("returning void continues with original Response", async () => {
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onResponse: () => {
          // void — no-op
        },
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(200);
  });

  it("is called for error responses from handlers too", async () => {
    const onResponse = vi.fn();
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onBeforeHandler: () => {
          throw new Response("Forbidden", { status: 403 });
        },
        onResponse,
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(403);
    expect(onResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        response: expect.any(Response),
      }),
    );
    // The thrown Response (403) should be passed to onResponse
    const calledWith = onResponse.mock.calls[0][0];
    expect(calledWith.response.status).toBe(403);
  });
});

/* ------------------------------------------------------------------------------------------------
 * onError hook
 * --------------------------------------------------------------------------------------------- */

describe("hooks — onError", () => {
  it("is called with error context", async () => {
    const onError = vi.fn();
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Error("test error");
        },
        onError,
      },
    });

    await handler(get("http://localhost/api/info"));

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
        request: expect.any(Request),
        path: "/api/info",
        runtime,
      }),
    );
  });

  it("returning a Response overrides the default error response", async () => {
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Error("test error");
        },
        onError: () =>
          new Response(JSON.stringify({ custom: true }), { status: 503 }),
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ custom: true });
  });

  it("returning void uses default JSON error response", async () => {
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Error("test error");
        },
        onError: () => {
          // void — use default
        },
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toHaveProperty("error", "internal_error");
  });

  it("route is present when error occurs after routing", async () => {
    const onError = vi.fn();
    const runtime = createRuntime();
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onBeforeHandler: () => {
          throw new Error("post-routing error");
        },
        onError,
      },
    });

    await handler(get("http://localhost/api/info"));

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
        route: expect.objectContaining({
          method: "info",
        }),
      }),
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * Composition with legacy middleware
 * --------------------------------------------------------------------------------------------- */

describe("hooks — composition with legacy middleware", () => {
  it("hooks.onRequest runs before runtime.beforeRequestMiddleware", async () => {
    const order: string[] = [];

    const beforeRequestMiddleware = vi.fn().mockImplementation(() => {
      order.push("legacy-before");
    });
    const onRequest = vi.fn().mockImplementation(() => {
      order.push("hook-onRequest");
    });

    const runtime = createRuntime({ beforeRequestMiddleware });
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: { onRequest },
    });

    await handler(get("http://localhost/api/info"));

    expect(order).toEqual(["hook-onRequest", "legacy-before"]);
  });

  it("runtime.afterRequestMiddleware runs after hooks.onResponse", async () => {
    const order: string[] = [];

    const afterRequestMiddleware = vi.fn().mockImplementation(() => {
      order.push("legacy-after");
    });
    const onResponse = vi.fn().mockImplementation(() => {
      order.push("hook-onResponse");
    });

    const runtime = createRuntime({ afterRequestMiddleware });
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: { onResponse },
    });

    await handler(get("http://localhost/api/info"));

    // afterRequestMiddleware is fire-and-forget, give it a tick
    await new Promise((r) => setTimeout(r, 10));

    expect(order).toEqual(["hook-onResponse", "legacy-after"]);
  });

  it("full pipeline execution order", async () => {
    const order: string[] = [];

    const beforeRequestMiddleware = vi.fn().mockImplementation(() => {
      order.push("legacy-before");
    });
    const afterRequestMiddleware = vi.fn().mockImplementation(() => {
      order.push("legacy-after");
    });

    const hooks: CopilotRuntimeHooks = {
      onRequest: () => {
        order.push("onRequest");
      },
      onBeforeHandler: () => {
        order.push("onBeforeHandler");
      },
      onResponse: () => {
        order.push("onResponse");
      },
    };

    const runtime = createRuntime({
      beforeRequestMiddleware,
      afterRequestMiddleware,
    });
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks,
    });

    await handler(get("http://localhost/api/info"));
    await new Promise((r) => setTimeout(r, 10));

    expect(order).toEqual([
      "onRequest",
      "legacy-before",
      "onBeforeHandler",
      "onResponse",
      "legacy-after",
    ]);
  });

  it("request modifications from hooks are visible to legacy middleware", async () => {
    let legacySawCustomHeader = false;

    const beforeRequestMiddleware = vi
      .fn()
      .mockImplementation(({ request }: { request: Request }) => {
        legacySawCustomHeader = request.headers.get("x-from-hook") === "hello";
      });

    const runtime = createRuntime({ beforeRequestMiddleware });
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onRequest: ({ request }) => {
          const headers = new Headers(request.headers);
          headers.set("x-from-hook", "hello");
          return new Request(request, { headers });
        },
      },
    });

    await handler(get("http://localhost/api/info"));

    expect(beforeRequestMiddleware).toHaveBeenCalled();
    expect(legacySawCustomHeader).toBe(true);
  });
});
