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

  it("error response includes error message for Error instances", async () => {
    const handler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api",
      hooks: {
        onRequest: () => {
          throw new Error("custom error message");
        },
      },
    });

    const response = await handler(
      new Request("http://localhost/api/info", { method: "GET" }),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("internal_error");
    expect(body.message).toBe("custom error message");
  });

  it("error response uses generic message for non-Error throws", async () => {
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
    expect(body.message).toBe("Internal server error");
  });
});
