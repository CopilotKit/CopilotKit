import { describe, it, expect } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

import { createCopilotEndpointSingleRoute } from "../endpoints";
import { CopilotRuntime } from "../runtime";

describe("CopilotEndpointSingleRoute routing", () => {
  const createMockRuntime = () => {
    const createMockAgent = () => {
      const agent: unknown = {
        execute: async () => ({ events: [] }),
      };
      (agent as { clone: () => unknown }).clone = () => createMockAgent();
      return agent as AbstractAgent;
    };

    return new CopilotRuntime({
      agents: {
        default: createMockAgent(),
        myAgent: createMockAgent(),
        agent123: createMockAgent(),
        "my-agent": createMockAgent(),
        my_agent: createMockAgent(),
        testAgent: createMockAgent(),
        test: createMockAgent(),
        "test%20agent": createMockAgent(),
        "test agent": createMockAgent(),
      },
    });
  };

  const callEndpoint = async (body: Record<string, unknown>) => {
    const runtime = createMockRuntime();
    const endpoint = createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
    const request = new Request("https://example.com/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    return endpoint.fetch(request);
  };

  describe("agent/run method", () => {
    it("accepts simple agent names", async () => {
      const response = await callEndpoint({
        method: "agent/run",
        params: { agentId: "myAgent" },
        body: {},
      });

      expect(response.status).not.toBe(404);
    });

    it("accepts hyphenated agent names", async () => {
      const response = await callEndpoint({
        method: "agent/run",
        params: { agentId: "my-agent" },
        body: {},
      });

      expect(response.status).not.toBe(404);
    });

    it("accepts underscored agent names", async () => {
      const response = await callEndpoint({
        method: "agent/run",
        params: { agentId: "my_agent" },
        body: {},
      });

      expect(response.status).not.toBe(404);
    });

    it("returns 400 when agentId missing", async () => {
      const response = await callEndpoint({
        method: "agent/run",
        body: {},
      });

      expect(response.status).toBe(400);
    });
  });

  describe("agent/connect method", () => {
    it("accepts standard agent id", async () => {
      const response = await callEndpoint({
        method: "agent/connect",
        params: { agentId: "agent123" },
        body: {},
      });

      expect(response.status).not.toBe(404);
    });
  });

  describe("agent/stop method", () => {
    it("requires threadId", async () => {
      const response = await callEndpoint({
        method: "agent/stop",
        params: { agentId: "agent123" },
      });

      expect(response.status).toBe(400);
    });

    it("returns response when params provided", async () => {
      const response = await callEndpoint({
        method: "agent/stop",
        params: { agentId: "agent123", threadId: "thread-1" },
      });

      expect(response.status).not.toBe(404);
    });
  });

  describe("info method", () => {
    it("returns runtime info for base path", async () => {
      const response = await callEndpoint({ method: "info" });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("version");
    });

    it("handles query parameters", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
      const request = new Request("https://example.com/rpc?foo=bar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "info" }),
      });

      const response = await endpoint.fetch(request);
      expect(response.status).toBe(200);
    });
  });

  describe("transcribe method", () => {
    it("returns non-404 even without multipart body", async () => {
      const response = await callEndpoint({ method: "transcribe" });

      expect(response.status).not.toBe(404);
    });
  });

  describe("invalid inputs", () => {
    it("returns 415 for non-JSON content", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
      const request = new Request("https://example.com/rpc", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "method=info",
      });

      const response = await endpoint.fetch(request);
      expect(response.status).toBe(415);
    });

    it("returns 400 for unsupported method", async () => {
      const response = await callEndpoint({ method: "unknown" });

      expect(response.status).toBe(400);
    });

    it("returns 404 for unmatched path", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
      const request = new Request("https://example.com/other", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "info" }),
      });

      const response = await endpoint.fetch(request);
      expect(response.status).toBe(404);
    });
  });
});
