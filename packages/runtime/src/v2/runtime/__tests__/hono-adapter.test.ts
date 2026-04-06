import { describe, it, expect, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

import {
  createCopilotEndpoint,
  createCopilotEndpointSingleRoute,
} from "../endpoints";
import { CopilotRuntime } from "../core/runtime";

describe("Hono adapter with hooks", () => {
  const createMockAgent = () => {
    const agent: unknown = {
      execute: async () => ({ events: [] }),
    };
    (agent as { clone: () => unknown }).clone = () => createMockAgent();
    return agent as AbstractAgent;
  };

  const createMockRuntime = (opts?: Partial<CopilotRuntime>) =>
    new CopilotRuntime({
      agents: {
        default: createMockAgent(),
        myAgent: createMockAgent(),
        testAgent: createMockAgent(),
      },
      ...opts,
    });

  describe("createCopilotEndpoint", () => {
    const createEndpoint = (
      hooks?: Parameters<typeof createCopilotEndpoint>[0]["hooks"],
      runtimeOpts?: Partial<CopilotRuntime>,
    ) => {
      const runtime = createMockRuntime(runtimeOpts);
      const endpoint = createCopilotEndpoint({
        runtime,
        basePath: "/",
        hooks,
      });
      return { endpoint, runtime };
    };

    it("routes GET /info correctly", async () => {
      const { endpoint } = createEndpoint();
      const response = await endpoint.fetch(
        new Request("https://example.com/info"),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("version");
    });

    it("routes POST /agent/:id/run correctly", async () => {
      const { endpoint } = createEndpoint();
      const response = await endpoint.fetch(
        new Request("https://example.com/agent/myAgent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [],
            state: {},
            threadId: "thread-1",
          }),
        }),
      );

      expect(response.status).not.toBe(404);
    });

    it("forwards hooks — onRequest hook is called", async () => {
      const onRequest = vi.fn();
      const { endpoint, runtime } = createEndpoint({ onRequest });

      await endpoint.fetch(new Request("https://example.com/info"));

      expect(onRequest).toHaveBeenCalledTimes(1);
      expect(onRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.any(Request),
          path: expect.stringContaining("/info"),
          runtime,
        }),
      );
    });

    it("hooks can modify response headers via onResponse", async () => {
      const { endpoint } = createEndpoint({
        onResponse: ({ response }) => {
          const headers = new Headers(response.headers);
          headers.set("x-custom-header", "hello-from-hook");
          return new Response(response.body, {
            status: response.status,
            headers,
          });
        },
      });

      const response = await endpoint.fetch(
        new Request("https://example.com/info"),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("x-custom-header")).toBe("hello-from-hook");
    });

    it("Hono CORS headers are present", async () => {
      const { endpoint } = createEndpoint();
      const response = await endpoint.fetch(
        new Request("https://example.com/info", {
          method: "OPTIONS",
          headers: {
            Origin: "https://somesite.com",
            "Access-Control-Request-Method": "GET",
          },
        }),
      );

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("createCopilotEndpointSingleRoute", () => {
    it("dispatches single-route with method envelope", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpointSingleRoute({
        runtime,
        basePath: "/rpc",
      });

      const response = await endpoint.fetch(
        new Request("https://example.com/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method: "agent/run",
            params: { agentId: "myAgent" },
            body: {
              messages: [],
              state: {},
              threadId: "thread-1",
            },
          }),
        }),
      );

      expect(response.status).not.toBe(404);
    });
  });
});
