import { createCopilotEndpoint } from "../endpoints";
import { CopilotRuntime } from "../runtime";
import { describe, it, expect } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

describe("CopilotEndpoint routing", () => {
  // Helper function to create a Request object with a given URL
  const createRequest = (url: string, method: string = "GET"): Request => {
    return new Request(url, { method });
  };

  // Create a mock runtime with a basic agent
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

  // Helper to test routing
  const testRoute = async (
    url: string,
    method: string = "GET",
    body?: unknown
  ) => {
    const runtime = createMockRuntime();
    const endpoint = createCopilotEndpoint({ runtime, basePath: "/" });
    const requestInit: RequestInit = { method };
    if (body) {
      requestInit.body = JSON.stringify(body);
      requestInit.headers = { "Content-Type": "application/json" };
    }
    const request = createRequest(url, method);
    const response = await endpoint.fetch(request);
    return response;
  };

  describe("RunAgent route pattern", () => {
    it("should match agent run URL with simple agent name", async () => {
      const response = await testRoute(
        "https://example.com/agent/myAgent/run",
        "POST",
        {
          agentId: "myAgent",
        }
      );

      // Should not be 404
      expect(response.status).not.toBe(404);
    });

    it("should match agent run URL with alphanumeric agent name", async () => {
      const response = await testRoute(
        "https://example.com/agent/agent123/run",
        "POST",
        {
          agentId: "agent123",
        }
      );

      expect(response.status).not.toBe(404);
    });

    it("should match agent run URL with hyphenated agent name", async () => {
      const response = await testRoute(
        "https://example.com/agent/my-agent/run",
        "POST",
        {
          agentId: "my-agent",
        }
      );

      expect(response.status).not.toBe(404);
    });

    it("should match agent run URL with underscored agent name", async () => {
      const response = await testRoute(
        "https://example.com/agent/my_agent/run",
        "POST",
        {
          agentId: "my_agent",
        }
      );

      expect(response.status).not.toBe(404);
    });

    it("should not match agent run URL with empty agent name", async () => {
      const response = await testRoute(
        "https://example.com/agent//run",
        "POST"
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toEqual({ error: "Not found" });
    });

    it("should not match partial agent run URL", async () => {
      const response = await testRoute(
        "https://example.com/agent/myAgent",
        "POST"
      );

      expect(response.status).toBe(404);
    });

    it("should not match agent run URL with extra path segments", async () => {
      const response = await testRoute(
        "https://example.com/agent/myAgent/run/extra",
        "POST"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("GetRuntimeInfo route pattern (/info endpoint)", () => {
    it("should match simple info URL", async () => {
      const response = await testRoute("https://example.com/info");

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("version");
    });

    it("should match info URL with query parameters", async () => {
      const response = await testRoute("https://example.com/info?param=value");

      expect(response.status).toBe(200);
    });

    it("should not match non-info URLs", async () => {
      const response = await testRoute("https://example.com/agents");

      expect(response.status).toBe(404);
    });
  });

  describe("Transcribe route pattern (/transcribe endpoint)", () => {
    it("should match simple transcribe URL", async () => {
      // Transcribe expects POST method and audio data
      const response = await testRoute(
        "https://example.com/transcribe",
        "POST",
        {}
      );

      // It might return an error since we're not providing audio, but it shouldn't be 404
      expect(response.status).not.toBe(404);
    });

    it("should match transcribe URL with query parameters", async () => {
      const response = await testRoute(
        "https://example.com/transcribe?format=json",
        "POST",
        {}
      );

      expect(response.status).not.toBe(404);
    });

    it("should not match transcribe URLs with extra path segments", async () => {
      const response = await testRoute(
        "https://example.com/transcribe/extra",
        "POST"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("Unmatched routes (404 behavior)", () => {
    it("should return 404 for root path", async () => {
      const response = await testRoute("https://example.com/");

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toEqual({ error: "Not found" });
    });

    it("should return 404 for unknown paths", async () => {
      const response = await testRoute("https://example.com/unknown/path");

      expect(response.status).toBe(404);
    });

    it("should return 404 for malformed agent paths", async () => {
      const response = await testRoute("https://example.com/agent/run", "POST");

      expect(response.status).toBe(404);
    });

    it("should return 404 for agents path", async () => {
      const response = await testRoute("https://example.com/agents");

      expect(response.status).toBe(404);
    });
  });

  describe("Edge cases", () => {
    it("should handle URLs with different domains", async () => {
      const response = await testRoute(
        "http://localhost:3000/agent/test/run",
        "POST",
        {
          agentId: "test",
        }
      );

      expect(response.status).not.toBe(404);
    });

    it("should handle URLs with ports for info endpoint", async () => {
      const response = await testRoute("https://api.example.com:8080/info");

      expect(response.status).toBe(200);
    });

    it("should handle URLs with ports for transcribe endpoint", async () => {
      const response = await testRoute(
        "https://api.example.com:8080/transcribe",
        "POST",
        {}
      );

      expect(response.status).not.toBe(404);
    });

    it("should handle URLs with special characters in agent names", async () => {
      const response = await testRoute(
        "https://example.com/agent/test%20agent/run",
        "POST",
        { agentId: "test%20agent" }
      );

      expect(response.status).not.toBe(404);
    });
  });
});
