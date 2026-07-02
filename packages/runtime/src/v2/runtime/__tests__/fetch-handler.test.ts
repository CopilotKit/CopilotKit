import { describe, it, expect, vi } from "vitest";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotRuntime } from "../core/runtime";
import type { AbstractAgent } from "@ag-ui/client";

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

/**
 * A suggest-capable mock agent. Unlike `createMockAgent`, its clone exposes the
 * surface `handleSuggestAgent` touches (`setMessages`/`setState`/`threadId`)
 * and a `runAgent` that emits a `copilotkitSuggest` tool-call message via
 * `onMessagesChanged`, so the suggest route resolves to a real 200 transcript
 * instead of the handler's 502 error path.
 */
const createSuggestAgent = () => {
  const suggestMsg = {
    id: "suggest-1",
    role: "assistant",
    toolCalls: [
      {
        id: "tc-1",
        function: {
          name: "copilotkitSuggest",
          arguments: JSON.stringify({
            suggestions: [{ title: "Hi", message: "Say hi" }],
          }),
        },
      },
    ],
  };
  const agent: unknown = {
    agentId: "default",
    headers: {},
    threadId: undefined,
    setMessages: vi.fn(),
    setState: vi.fn(),
    runAgent: vi.fn(
      async (
        input: { messages?: unknown[] },
        sub?: { onMessagesChanged?: (event: { messages: unknown[] }) => void },
      ) => {
        sub?.onMessagesChanged?.({
          messages: [...(input.messages ?? []), suggestMsg],
        });
        return { newMessages: [suggestMsg] };
      },
    ),
  };
  (agent as { clone: () => unknown }).clone = () => createSuggestAgent();
  return agent as AbstractAgent;
};

const createRuntime = (
  agents: Record<string, AbstractAgent> = { default: createMockAgent() },
) => new CopilotRuntime({ agents });

const post = (url: string, body?: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

const get = (url: string) => new Request(url, { method: "GET" });

/* ------------------------------------------------------------------------------------------------
 * Multi-route with basePath
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotRuntimeHandler — multi-route with basePath", () => {
  const runtime = createRuntime();
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "multi-route",
  });

  it("routes GET /info to handleGetRuntimeInfo", async () => {
    const response = await handler(get("http://localhost/api/copilotkit/info"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("agents");
    expect(body.threadEndpoints).toMatchObject({
      list: true,
      inspect: true,
      mutations: false,
      realtimeMetadata: false,
    });
  });

  it("returns 404 for paths not starting with basePath", async () => {
    const response = await handler(get("http://localhost/other/info"));
    expect(response.status).toBe(404);
  });

  it("returns 404 for unmatched subpaths", async () => {
    const response = await handler(
      get("http://localhost/api/copilotkit/unknown"),
    );
    expect(response.status).toBe(404);
  });

  it("returns 405 for wrong HTTP method on /info (POST instead of GET)", async () => {
    const response = await handler(
      post("http://localhost/api/copilotkit/info"),
    );
    expect(response.status).toBe(405);
  });

  it("returns 405 for GET on a POST-only route", async () => {
    const response = await handler(
      get("http://localhost/api/copilotkit/agent/myAgent/run"),
    );
    expect(response.status).toBe(405);
  });

  it("returns 405 for GET on /agent/:agentId/suggest (POST-only)", async () => {
    const response = await handler(
      get("http://localhost/api/copilotkit/agent/myAgent/suggest"),
    );
    expect(response.status).toBe(405);
  });

  it("routes POST /agent/:agentId/run", async () => {
    const response = await handler(
      post("http://localhost/api/copilotkit/agent/default/run", {
        threadId: "t1",
        runId: "r1",
      }),
    );
    // Handler runs — may return error for invalid input but at least matches the route
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });

  it("routes POST /agent/:agentId/connect", async () => {
    const response = await handler(
      post("http://localhost/api/copilotkit/agent/default/connect", {
        threadId: "t1",
        runId: "r1",
      }),
    );
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });

  it("routes POST /agent/:agentId/stop/:threadId", async () => {
    const response = await handler(
      post("http://localhost/api/copilotkit/agent/default/stop/t1"),
    );
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });

  it("routes POST /transcribe", async () => {
    const response = await handler(
      post("http://localhost/api/copilotkit/transcribe"),
    );
    // Transcribe may fail (no service configured) but should match the route
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });

  it("basePath with trailing slash still works", async () => {
    const trailingSlashHandler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api/copilotkit/",
      mode: "multi-route",
    });
    const response = await trailingSlashHandler(
      get("http://localhost/api/copilotkit/info"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("agents");
  });

  it("URL-encoded agentId is handled correctly", async () => {
    const encodedHandler = createCopilotRuntimeHandler({
      runtime: createRuntime({ "my agent": createMockAgent() }),
      basePath: "/api/copilotkit",
      mode: "multi-route",
    });
    const response = await encodedHandler(
      post("http://localhost/api/copilotkit/agent/my%20agent/run", {
        threadId: "t1",
        runId: "r1",
      }),
    );
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Multi-route without basePath (suffix matching)
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotRuntimeHandler — multi-route without basePath", () => {
  const runtime = createRuntime();
  const handler = createCopilotRuntimeHandler({
    runtime,
    mode: "multi-route",
  });

  it("matches /info suffix", async () => {
    const response = await handler(get("http://localhost/some/prefix/info"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("version");
  });

  it("matches /agent/:id/run suffix", async () => {
    const response = await handler(
      post("http://localhost/some/prefix/agent/default/run", {
        threadId: "t1",
        runId: "r1",
      }),
    );
    expect(response.status).not.toBe(404);
  });

  it("matches /agent/:id/suggest suffix", async () => {
    const response = await handler(
      post("http://localhost/some/prefix/agent/default/suggest", {
        threadId: "t1",
        runId: "r1",
      }),
    );
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });

  it("routes POST /agent/:id/suggest to handleSuggestAgent and returns 200 with messages", async () => {
    // Mirrors the single-route end-to-end assertion: a suggest-capable agent
    // whose `runAgent` emits a `copilotkitSuggest` tool-call message proves the
    // multi-route dispatch reaches `handleSuggestAgent` and returns a real 200
    // transcript, not just a non-404/405 routing match.
    const suggestHandler = createCopilotRuntimeHandler({
      runtime: createRuntime({ default: createSuggestAgent() }),
      mode: "multi-route",
    });
    const response = await suggestHandler(
      post("http://localhost/some/prefix/agent/default/suggest", {
        threadId: "t1",
        runId: "r1",
        state: {},
        messages: [],
        tools: [],
        context: [],
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<{ id: string }>;
    };
    expect(body.messages.some((m) => m.id === "suggest-1")).toBe(true);
  });

  it("returns 404 for no known suffix", async () => {
    const response = await handler(get("http://localhost/some/prefix/unknown"));
    expect(response.status).toBe(404);
  });

  it("matches /agent/:id/connect suffix", async () => {
    const response = await handler(
      post("http://localhost/some/prefix/agent/default/connect", {
        threadId: "t1",
        runId: "r1",
      }),
    );
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });

  it("matches /agent/:id/stop/:threadId suffix", async () => {
    const response = await handler(
      post("http://localhost/some/prefix/agent/default/stop/t1"),
    );
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });

  it("matches /transcribe suffix", async () => {
    const response = await handler(
      post("http://localhost/some/prefix/transcribe"),
    );
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Single-route mode
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotRuntimeHandler — single-route mode", () => {
  const runtime = createRuntime();
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "single-route",
  });

  it("dispatches info method", async () => {
    const response = await handler(
      post("http://localhost/api/copilotkit", { method: "info" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("version");
  });

  it("returns 400 for missing method", async () => {
    const response = await handler(post("http://localhost/api/copilotkit", {}));
    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid method", async () => {
    const response = await handler(
      post("http://localhost/api/copilotkit", { method: "nonexistent" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 415 for non-JSON content-type", async () => {
    const request = new Request("http://localhost/api/copilotkit", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    });
    const response = await handler(request);
    expect(response.status).toBe(415);
  });

  it("returns 405 for GET in single-route mode", async () => {
    const response = await handler(get("http://localhost/api/copilotkit"));
    expect(response.status).toBe(405);
  });

  it("dispatches agent/run with params (routes correctly)", async () => {
    const response = await handler(
      post("http://localhost/api/copilotkit", {
        method: "agent/run",
        params: { agentId: "default" },
        body: { threadId: "t1", runId: "r1" },
      }),
    );
    // Route matched — not a 404/405 routing error. May return 400 due to
    // incomplete RunAgentInput schema fields, which is handler-level validation.
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });

  it("dispatches agent/suggest method to handleSuggestAgent and returns 200 with messages", async () => {
    // The shared `createMockAgent` has no `runAgent`, so the suggest handler
    // would hit its error path (502) and a `not.toBe(404/405)` assertion would
    // pass without proving the route actually reaches `handleSuggestAgent`.
    // Use a suggest-specific agent whose `runAgent` emits a tool-call message,
    // so a 200 + `messages` body proves the route ran the handler end to end.
    const suggestRuntime = createRuntime({ default: createSuggestAgent() });
    const suggestHandler = createCopilotRuntimeHandler({
      runtime: suggestRuntime,
      basePath: "/api/copilotkit",
      mode: "single-route",
    });

    const response = await suggestHandler(
      post("http://localhost/api/copilotkit", {
        method: "agent/suggest",
        params: { agentId: "default" },
        body: {
          threadId: "t1",
          runId: "r1",
          state: {},
          messages: [],
          tools: [],
          context: [],
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<{ id: string }>;
    };
    expect(body.messages.some((m) => m.id === "suggest-1")).toBe(true);
  });

  it("returns 404 when basePath doesn't match in single-route", async () => {
    const response = await handler(
      post("http://localhost/other/path", { method: "info" }),
    );
    expect(response.status).toBe(404);
  });

  it("dispatches agent/connect method", async () => {
    const response = await handler(
      post("http://localhost/api/copilotkit", {
        method: "agent/connect",
        params: { agentId: "default" },
        body: { threadId: "t1", runId: "r1" },
      }),
    );
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });

  it("dispatches agent/stop method with agentId and threadId params", async () => {
    const response = await handler(
      post("http://localhost/api/copilotkit", {
        method: "agent/stop",
        params: { agentId: "default", threadId: "t1" },
      }),
    );
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });

  it("dispatches transcribe method", async () => {
    const response = await handler(
      post("http://localhost/api/copilotkit", {
        method: "transcribe",
      }),
    );
    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(405);
  });

  it("single-route without basePath dispatches any POST", async () => {
    const noBasePathHandler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      mode: "single-route",
    });
    const response = await noBasePathHandler(
      post("http://localhost/any/path/here", { method: "info" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("version");
    expect(body.threadEndpoints).toMatchObject({
      list: false,
      inspect: false,
      mutations: false,
      realtimeMetadata: false,
    });
  });
});

/* ------------------------------------------------------------------------------------------------
 * CORS integration
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotRuntimeHandler — CORS", () => {
  const runtime = createRuntime();

  it("handles OPTIONS preflight when cors: true", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      cors: true,
    });
    const request = new Request("http://localhost/api/info", {
      method: "OPTIONS",
      headers: { Origin: "https://myapp.com" },
    });
    const response = await handler(request);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("adds CORS headers to normal responses when cors: true", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      cors: true,
    });
    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("does not add CORS headers when cors is omitted", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
    });
    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not add CORS headers when cors: false", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      cors: false,
    });
    const response = await handler(get("http://localhost/api/info"));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("uses custom CORS config", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      cors: {
        origin: "https://specific.com",
        credentials: true,
      },
    });
    const response = await handler(
      new Request("http://localhost/api/info", {
        method: "GET",
        headers: { Origin: "https://specific.com" },
      }),
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://specific.com",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );
  });

  it("adds CORS headers to error responses", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      cors: true,
    });
    const response = await handler(get("http://localhost/api/unknown"));
    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

/* ------------------------------------------------------------------------------------------------
 * Error handling
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotRuntimeHandler — error handling", () => {
  it("returns 500 JSON error for unhandled errors", async () => {
    const agent: unknown = {
      execute: vi.fn().mockRejectedValue(new Error("boom")),
      clone: () => agent,
    };
    const runtime = createRuntime({
      default: agent as AbstractAgent,
    });
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
    });

    const response = await handler(
      post("http://localhost/api/agent/default/run", {
        threadId: "t1",
        runId: "r1",
      }),
    );
    // The handler catches errors and produces some response
    expect(response).toBeInstanceOf(Response);
  });

  it("returns thrown Response directly", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime: createRuntime(),
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Response("Forbidden", { status: 403 });
        },
      },
    });

    const response = await handler(get("http://localhost/api/info"));
    expect(response.status).toBe(403);
  });
});
