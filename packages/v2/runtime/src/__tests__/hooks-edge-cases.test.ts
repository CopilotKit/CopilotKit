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
 * onRequest — error edge cases
 * --------------------------------------------------------------------------------------------- */

describe("hooks edge cases — onRequest errors", () => {
  it("async onRequest throwing Error triggers onError", async () => {
    const onError = vi
      .fn()
      .mockReturnValue(new Response("handled", { status: 503 }));
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onRequest: async () => {
          await Promise.resolve();
          throw new Error("async boom");
        },
        onError,
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(503);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: "async boom" }),
      }),
    );
  });

  it("onRequest throwing a string (non-Error) triggers onError", async () => {
    const onError = vi
      .fn()
      .mockReturnValue(new Response("handled", { status: 503 }));
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw "string error";
        },
        onError,
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(503);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ error: "string error" }),
    );
  });

  it("onRequest returning non-Request value is ignored (uses original)", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onRequest: () => {
          return "not a request" as unknown as Request;
        },
      },
    });

    // Should succeed because runOnRequest falls back to original request
    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(200);
  });
});

/* ------------------------------------------------------------------------------------------------
 * onBeforeHandler — error edge cases
 * --------------------------------------------------------------------------------------------- */

describe("hooks edge cases — onBeforeHandler errors", () => {
  it("async onBeforeHandler throwing Error triggers onError with route info", async () => {
    const onError = vi
      .fn()
      .mockReturnValue(new Response("handled", { status: 503 }));
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onBeforeHandler: async () => {
          throw new Error("pre-handler async error");
        },
        onError,
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(503);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: "pre-handler async error" }),
        route: expect.objectContaining({ method: "info" }),
      }),
    );
  });

  it("onBeforeHandler returning non-Request value is ignored", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onBeforeHandler: () => {
          return 42 as unknown as Request;
        },
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(200);
  });

  it("is NOT called when 405 (wrong HTTP method)", async () => {
    const onBeforeHandler = vi.fn();
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: { onBeforeHandler },
    });

    const response = await handler(post("http://localhost/api/info"));
    expect(response.status).toBe(405);
    expect(onBeforeHandler).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------------------------------
 * onResponse — edge cases
 * --------------------------------------------------------------------------------------------- */

describe("hooks edge cases — onResponse", () => {
  it("onResponse returning non-Response value is ignored (uses original)", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onResponse: () => {
          return "not a response" as unknown as Response;
        },
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("version");
  });

  it("onResponse is called for thrown Response (short-circuit)", async () => {
    const onResponse = vi.fn().mockImplementation(({ response }) => {
      // Add a marker header to prove onResponse ran
      const headers = new Headers(response.headers);
      headers.set("x-intercepted", "true");
      return new Response(response.body, { status: response.status, headers });
    });

    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Response("Forbidden", { status: 403 });
        },
        onResponse,
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(403);
    expect(onResponse).toHaveBeenCalled();
    expect(response.headers.get("x-intercepted")).toBe("true");
  });

  it("onResponse is NOT called when onError handles a non-Response error", async () => {
    const onResponse = vi.fn();
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Error("boom");
        },
        onError: () => new Response("handled", { status: 503 }),
        onResponse,
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(503);
    // onResponse is NOT called for error-path responses
    expect(onResponse).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------------------------------
 * onError — edge cases
 * --------------------------------------------------------------------------------------------- */

describe("hooks edge cases — onError", () => {
  it("onError is NOT called when a Response is thrown", async () => {
    const onError = vi.fn();
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Response("Short circuit", { status: 401 });
        },
        onError,
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(401);
    expect(onError).not.toHaveBeenCalled();
  });

  it("onError itself throwing propagates as unhandled error", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Error("original error");
        },
        onError: () => {
          throw new Error("error in error handler");
        },
      },
    });

    // When onError throws, there is no double-catch — the error propagates
    await expect(handler(get("http://localhost/api/info"))).rejects.toThrow(
      "error in error handler",
    );
  });

  it("onError receives route info when error happens after routing", async () => {
    const onError = vi
      .fn()
      .mockReturnValue(new Response("handled", { status: 503 }));
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onBeforeHandler: ({ route }) => {
          if (route.method === "agent/run") {
            throw new Error("post-routing failure");
          }
        },
        onError,
      },
    });

    const response = await handler(
      post("http://localhost/api/agent/default/run", {
        threadId: "t1",
        runId: "r1",
      }),
    );
    expect(response.status).toBe(503);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        route: expect.objectContaining({
          method: "agent/run",
          agentId: "default",
        }),
      }),
    );
  });

  it("onError route is undefined when error happens before routing", async () => {
    const onError = vi
      .fn()
      .mockReturnValue(new Response("handled", { status: 503 }));
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Error("pre-routing");
        },
        onError,
      },
    });

    await handler(get("http://localhost/api/info"));
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        route: undefined,
      }),
    );
  });
});

/* ------------------------------------------------------------------------------------------------
 * Full pipeline — combined hook scenarios
 * --------------------------------------------------------------------------------------------- */

describe("hooks edge cases — full pipeline", () => {
  it("all hooks fire in order on a successful request", async () => {
    const order: string[] = [];

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

    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks,
    });

    await handler(get("http://localhost/api/info"));

    expect(order).toEqual(["onRequest", "onBeforeHandler", "onResponse"]);
  });

  it("onRequest can modify request seen by onBeforeHandler", async () => {
    let headerInBeforeHandler: string | null = null;

    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onRequest: ({ request }) => {
          const headers = new Headers(request.headers);
          headers.set("x-injected", "from-onRequest");
          return new Request(request, { headers });
        },
        onBeforeHandler: ({ request }) => {
          headerInBeforeHandler = request.headers.get("x-injected");
        },
      },
    });

    await handler(get("http://localhost/api/info"));
    expect(headerInBeforeHandler).toBe("from-onRequest");
  });

  it("onResponse can read and modify response body", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onResponse: async ({ response }) => {
          const body = await response.json();
          return new Response(JSON.stringify({ ...body, injected: true }), {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("version");
    expect(body.injected).toBe(true);
  });

  it("hooks work correctly in single-route mode", async () => {
    const onRequest = vi.fn();
    const onBeforeHandler = vi.fn();
    const onResponse = vi.fn();

    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      mode: "single-route",
      hooks: { onRequest, onBeforeHandler, onResponse },
    });

    await handler(post("http://localhost/api", { method: "info" }));

    expect(onRequest).toHaveBeenCalled();
    expect(onBeforeHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        route: expect.objectContaining({ method: "info" }),
      }),
    );
    expect(onResponse).toHaveBeenCalled();
  });

  it("onBeforeHandler receives correct agentId in single-route mode", async () => {
    const onBeforeHandler = vi.fn();
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      mode: "single-route",
      hooks: { onBeforeHandler },
    });

    await handler(
      post("http://localhost/api", {
        method: "agent/run",
        params: { agentId: "default" },
        body: { threadId: "t1", runId: "r1" },
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
});
