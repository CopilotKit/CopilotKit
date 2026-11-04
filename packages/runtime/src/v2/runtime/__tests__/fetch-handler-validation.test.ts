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

const createRuntime = (
  agents: Record<string, AbstractAgent> = { default: createMockAgent() },
) => new CopilotRuntime({ agents });

const post = (url: string, body?: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

/* ------------------------------------------------------------------------------------------------
 * Single-route: malformed JSON
 * --------------------------------------------------------------------------------------------- */

describe("fetch-handler validation — single-route malformed input", () => {
  const runtime = createRuntime();
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api",
    mode: "single-route",
  });

  it("returns 400 for completely invalid JSON body", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json{{{",
    });
    const response = await handler(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 for empty string body", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    const response = await handler(request);
    expect(response.status).toBe(400);
  });

  it("returns 415 for no Content-Type header", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ method: "info" }),
    });
    const response = await handler(request);
    expect(response.status).toBe(415);
  });

  it("returns 415 for text/plain Content-Type", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ method: "info" }),
    });
    const response = await handler(request);
    expect(response.status).toBe(415);
  });

  it("accepts application/json with charset", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ method: "info" }),
    });
    const response = await handler(request);
    expect(response.status).toBe(200);
  });

  it("returns 400 when method is null", async () => {
    const response = await handler(
      post("http://localhost/api", { method: null }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when method is a number", async () => {
    const response = await handler(
      post("http://localhost/api", { method: 42 }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when method is wrong case (INFO vs info)", async () => {
    const response = await handler(
      post("http://localhost/api", { method: "INFO" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for typo in method name", async () => {
    const response = await handler(
      post("http://localhost/api", { method: "agent/rn" }),
    );
    expect(response.status).toBe(400);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Single-route: missing required params
 * --------------------------------------------------------------------------------------------- */

describe("fetch-handler validation — single-route missing params", () => {
  const runtime = createRuntime();
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api",
    mode: "single-route",
  });

  it("returns 400 for agent/run without agentId param", async () => {
    const response = await handler(
      post("http://localhost/api", {
        method: "agent/run",
        params: {},
        body: { threadId: "t1", runId: "r1" },
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("agentId");
  });

  it("returns 400 for agent/run with empty agentId", async () => {
    const response = await handler(
      post("http://localhost/api", {
        method: "agent/run",
        params: { agentId: "" },
        body: { threadId: "t1", runId: "r1" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for agent/run with whitespace-only agentId", async () => {
    const response = await handler(
      post("http://localhost/api", {
        method: "agent/run",
        params: { agentId: "   " },
        body: { threadId: "t1", runId: "r1" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for agent/run with no params at all", async () => {
    const response = await handler(
      post("http://localhost/api", {
        method: "agent/run",
        body: { threadId: "t1", runId: "r1" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for agent/connect without agentId param", async () => {
    const response = await handler(
      post("http://localhost/api", {
        method: "agent/connect",
        params: {},
        body: { threadId: "t1", runId: "r1" },
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("agentId");
  });

  it("returns 400 for agent/stop without agentId param", async () => {
    const response = await handler(
      post("http://localhost/api", {
        method: "agent/stop",
        params: { threadId: "t1" },
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("agentId");
  });

  it("returns 400 for agent/stop without threadId param", async () => {
    const response = await handler(
      post("http://localhost/api", {
        method: "agent/stop",
        params: { agentId: "default" },
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("threadId");
  });

  it("returns 400 for agent/stop with no params", async () => {
    const response = await handler(
      post("http://localhost/api", { method: "agent/stop" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 for agent/run with non-string agentId", async () => {
    const response = await handler(
      post("http://localhost/api", {
        method: "agent/run",
        params: { agentId: 123 },
        body: { threadId: "t1", runId: "r1" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("info method works without params", async () => {
    const response = await handler(
      post("http://localhost/api", { method: "info" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("version");
  });

  it("transcribe method without body returns 400 (body required for transcribe)", async () => {
    const response = await handler(
      post("http://localhost/api", { method: "transcribe" }),
    );
    // In single-route mode, transcribe requires a body via createJsonRequest
    expect(response.status).toBe(400);
  });

  it("transcribe method with body dispatches correctly", async () => {
    const response = await handler(
      post("http://localhost/api", {
        method: "transcribe",
        body: { audio: "data" },
      }),
    );
    // Route matched — not a param validation error
    expect(response.status).not.toBe(400);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Multi-route: edge cases
 * --------------------------------------------------------------------------------------------- */

describe("fetch-handler validation — inherited object keys as agent ids", () => {
  const handler = createCopilotRuntimeHandler({
    runtime: createRuntime(),
    basePath: "/api",
  });

  it.each([
    ["run", "__proto__", "run"],
    ["run", "constructor", "run"],
    ["run", "toString", "run"],
    ["connect", "__proto__", "connect"],
    ["stop", "__proto__", "stop/thread-1"],
  ])("returns 404 for %s on %s", async (_route, agentId, action) => {
    const response = await handler(
      post(
        `http://localhost/api/agent/${agentId}/${action}`,
        action.startsWith("stop")
          ? undefined
          : {
              threadId: "thread-1",
              runId: "run-1",
              messages: [],
              tools: [],
              context: [],
              state: {},
              forwardedProps: {},
            },
      ),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Agent not found" });
  });
});

describe("fetch-handler validation — run body content type", () => {
  const validBody = JSON.stringify({
    threadId: "thread-1",
    runId: "run-1",
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  });
  const run =
    (handler: (request: Request) => Promise<Response>, url: string) =>
    (contentType: string | null, body: string) =>
      handler(
        new Request(url, {
          method: "POST",
          headers: contentType ? { "Content-Type": contentType } : {},
          // A Blob body leaves the content type header unset.
          body: new Blob([body]),
        }),
      );

  describe("multi-route", () => {
    const send = run(
      createCopilotRuntimeHandler({
        runtime: createRuntime(),
        basePath: "/api",
      }),
      "http://localhost/api/agent/default/run",
    );

    it.each([
      "text/plain",
      "text/plain; application/json",
      "application/x-www-form-urlencoded",
      "application/jsonp",
      null,
    ])("rejects %s with 415", async (contentType) => {
      const response = await send(contentType, validBody);

      expect(response.status).toBe(415);
    });

    it.each([
      "application/json",
      "application/json; charset=utf-8",
      "Application/JSON",
      "application/json, application/json",
    ])("does not reject %s", async (contentType) => {
      const response = await send(contentType, validBody);

      expect(response.status).not.toBe(415);
    });
  });

  describe("single-route", () => {
    const send = run(
      createCopilotRuntimeHandler({
        runtime: createRuntime(),
        basePath: "/api",
        mode: "single-route",
      }),
      "http://localhost/api",
    );
    const envelope = JSON.stringify({ method: "info" });

    it("rejects a JSON media type that only appears as a parameter", async () => {
      const response = await send("text/plain; application/json", envelope);

      expect(response.status).toBe(415);
    });

    it("accepts a duplicated application/json header", async () => {
      const response = await send(
        "application/json, application/json",
        envelope,
      );

      expect(response.status).toBe(200);
    });

    it("accepts application/json with parameters, in any letter case", async () => {
      const response = await send("Application/JSON; charset=utf-8", envelope);

      expect(response.status).toBe(200);
    });
  });
});

describe("fetch-handler validation — connect, suggest and stop content type", () => {
  const handler = createCopilotRuntimeHandler({
    runtime: createRuntime(),
    basePath: "/api",
  });
  const send = (action: string, contentType: string | null) =>
    handler(
      new Request(`http://localhost/api/agent/default/${action}`, {
        method: "POST",
        headers: contentType ? { "Content-Type": contentType } : {},
        body: new Blob(["{}"]),
      }),
    );

  it.each([
    ["connect", "text/plain"],
    ["connect", null],
    ["suggest", "text/plain"],
    ["stop/thread-1", "text/plain"],
    ["stop/thread-1", null],
  ])("rejects %s with content type %s", async (action, contentType) => {
    expect((await send(action, contentType)).status).toBe(415);
  });

  it.each(["connect", "suggest", "stop/thread-1"])(
    "does not reject %s with a JSON content type",
    async (action) => {
      const response = await send(action, "application/json");

      expect(response.status).not.toBe(415);
    },
  );
});

describe("fetch-handler validation — multi-route edge cases", () => {
  const runtime = createRuntime();

  it("handles request with no body on a POST route gracefully", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
    });
    const request = new Request("http://localhost/api/agent/default/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const response = await handler(request);
    // Should not crash — may return 400 or 500 but not a Node crash
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("CORS headers present on error responses too", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      cors: true,
    });
    const response = await handler(
      new Request("http://localhost/api/unknown", { method: "GET" }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("CORS headers present on 405 responses", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      cors: true,
    });
    const response = await handler(
      new Request("http://localhost/api/info", { method: "POST" }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("CORS headers present on 500 error responses", async () => {
    const agent: unknown = {
      execute: vi.fn().mockRejectedValue(new Error("boom")),
      clone: () => agent,
    };
    const errorRuntime = createRuntime({ default: agent as AbstractAgent });
    const handler = createCopilotRuntimeHandler({
      runtime: errorRuntime,
      basePath: "/api",
      cors: true,
    });

    const response = await handler(
      post("http://localhost/api/agent/default/run", {
        threadId: "t1",
        runId: "r1",
      }),
    );
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("error response does not leak error details to clients", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Error("sensitive internal detail: /home/user/db.sqlite");
        },
      },
    });

    const response = await handler(
      new Request("http://localhost/api/info", { method: "GET" }),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("internal_error");
    // Error message should NOT be exposed to the client
    expect(body.message).toBeUndefined();
  });

  it("error response returns internal_error for non-Error throws", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw "string error";
        },
      },
    });

    const response = await handler(
      new Request("http://localhost/api/info", { method: "GET" }),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("internal_error");
    expect(body.message).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------------------------------
 * Multi-route: HTTP method enforcement on per-thread GET endpoints
 *
 * /threads/:threadId/events and /threads/:threadId/state are read-only and
 * must reject anything other than GET with 405 + Allow: GET. These tests
 * pin that contract so a future refactor cannot quietly downgrade it.
 * --------------------------------------------------------------------------------------------- */

describe("fetch-handler validation — GET-only enforcement on threads read endpoints", () => {
  const runtime = createRuntime();
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api",
  });

  const expectMethodNotAllowed = async (
    response: Response,
    expectedAllow: string,
  ) => {
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe(expectedAllow);
  };

  for (const method of ["POST", "PATCH", "DELETE"]) {
    it(`returns 405 with Allow: GET for ${method} /threads/:id/events`, async () => {
      const response = await handler(
        new Request("http://localhost/api/threads/thread-1/events", {
          method,
          // PATCH/POST without a body or content-type would otherwise hit
          // a different validation branch; this exercises pure method check.
          headers: { "Content-Type": "application/json" },
        }),
      );
      await expectMethodNotAllowed(response, "GET");
    });

    it(`returns 405 with Allow: GET for ${method} /threads/:id/state`, async () => {
      const response = await handler(
        new Request("http://localhost/api/threads/thread-1/state", {
          method,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await expectMethodNotAllowed(response, "GET");
    });
  }

  it("accepts GET on /threads/:id/events", async () => {
    const response = await handler(
      new Request("http://localhost/api/threads/thread-1/events", {
        method: "GET",
      }),
    );
    // The route may 422 (no Intelligence configured) or 200 — either way it
    // is NOT a 405, which is the contract we are pinning here.
    expect(response.status).not.toBe(405);
  });

  it("accepts GET on /threads/:id/state", async () => {
    const response = await handler(
      new Request("http://localhost/api/threads/thread-1/state", {
        method: "GET",
      }),
    );
    expect(response.status).not.toBe(405);
  });
});
