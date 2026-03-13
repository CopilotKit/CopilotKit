import express from "express";
import request from "supertest";
import { describe, it, expect, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { Observable, of } from "rxjs";

import {
  createCopilotEndpoint,
  createCopilotEndpointSingleRoute,
} from "../endpoints";
import { createCopilotEndpointExpress } from "../express";
import { createCopilotEndpointSingleRouteExpress } from "../endpoints/express-single";
import { CopilotRuntime } from "../core/runtime";

vi.mock("../handlers/handle-run", () => ({
  handleRunAgent: vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 200 })),
}));

vi.mock("../handlers/handle-connect", () => ({
  handleConnectAgent: vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 200 })),
}));

vi.mock("../handlers/handle-stop", () => ({
  handleStopAgent: vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 200 })),
}));

describe("Backward compatibility", () => {
  const createMockAgent = () => {
    const agent: unknown = {
      execute: async () => ({ events: [] }),
    };
    (agent as { clone: () => unknown }).clone = () => createMockAgent();
    return agent as AbstractAgent;
  };

  const createMockRuntime = (opts?: Partial<CopilotRuntime>) => {
    const runner = {
      run: () =>
        new Observable((observer) => {
          observer.next({});
          observer.complete();
          return () => undefined;
        }),
      connect: () => of({}),
      stop: async () => true,
    };

    return new CopilotRuntime({
      agents: {
        default: createMockAgent(),
        myAgent: createMockAgent(),
      },
      runner,
      ...opts,
    });
  };

  /* ---------------------------------------------------------------------------
   * APIs work without hooks parameter
   * -------------------------------------------------------------------------- */

  describe("APIs work without hooks parameter", () => {
    it("createCopilotEndpoint still works without hooks parameter (routes /info)", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpoint({ runtime, basePath: "/" });

      const response = await endpoint.fetch(
        new Request("https://example.com/info"),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("version");
    });

    it("createCopilotEndpointExpress still works without hooks parameter (routes /info)", async () => {
      const runtime = createMockRuntime();
      const app = express();
      app.use(createCopilotEndpointExpress({ runtime, basePath: "/" }));

      const response = await request(app).get("/info");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("version");
    });

    it("createCopilotEndpointSingleRoute still works without hooks parameter", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotEndpointSingleRoute({
        runtime,
        basePath: "/rpc",
      });

      const response = await endpoint.fetch(
        new Request("https://example.com/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "info" }),
        }),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("version");
    });

    it("createCopilotEndpointSingleRouteExpress still works without hooks parameter", async () => {
      const runtime = createMockRuntime();
      const app = express();
      app.use(
        createCopilotEndpointSingleRouteExpress({
          runtime,
          basePath: "/rpc",
        }),
      );

      const response = await request(app)
        .post("/rpc")
        .set("Content-Type", "application/json")
        .send({ method: "info" });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("version");
    });
  });

  /* ---------------------------------------------------------------------------
   * Adding hooks doesn't break routing
   * -------------------------------------------------------------------------- */

  describe("adding hooks does not break routing", () => {
    it("Hono endpoint with hooks still routes /info", async () => {
      const runtime = createMockRuntime();
      const onRequest = vi.fn();
      const endpoint = createCopilotEndpoint({
        runtime,
        basePath: "/",
        hooks: { onRequest },
      });

      const response = await endpoint.fetch(
        new Request("https://example.com/info"),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("version");
      expect(onRequest).toHaveBeenCalled();
    });

    it("Hono endpoint with hooks still routes POST /agent/:id/run", async () => {
      const runtime = createMockRuntime();
      const onBeforeHandler = vi.fn();
      const endpoint = createCopilotEndpoint({
        runtime,
        basePath: "/",
        hooks: { onBeforeHandler },
      });

      const response = await endpoint.fetch(
        new Request("https://example.com/agent/default/run", {
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
      expect(onBeforeHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          route: expect.objectContaining({
            method: "agent/run",
            agentId: "default",
          }),
        }),
      );
    });

    it("Express endpoint with hooks still routes /info", async () => {
      const runtime = createMockRuntime();
      const onRequest = vi.fn();
      const app = express();
      app.use(
        createCopilotEndpointExpress({
          runtime,
          basePath: "/",
          hooks: { onRequest },
        }),
      );

      const response = await request(app).get("/info");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("version");
      expect(onRequest).toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------------------
   * Legacy middleware still executes
   * -------------------------------------------------------------------------- */

  describe("CopilotRuntime legacy middleware still executes", () => {
    it("beforeRequestMiddleware is called", async () => {
      const beforeCalls: string[] = [];
      const beforeRequestMiddleware = vi.fn().mockImplementation(() => {
        beforeCalls.push("before-called");
      });

      const runtime = createMockRuntime({ beforeRequestMiddleware });
      const endpoint = createCopilotEndpoint({ runtime, basePath: "/" });

      await endpoint.fetch(new Request("https://example.com/info"));

      expect(beforeRequestMiddleware).toHaveBeenCalledTimes(1);
      expect(beforeRequestMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime,
          request: expect.any(Request),
          path: expect.stringContaining("/info"),
        }),
      );
      expect(beforeCalls).toEqual(["before-called"]);
    });

    it("afterRequestMiddleware is called", async () => {
      const afterCalls: string[] = [];
      const afterRequestMiddleware = vi.fn().mockImplementation(() => {
        afterCalls.push("after-called");
      });

      const runtime = createMockRuntime({ afterRequestMiddleware });
      const endpoint = createCopilotEndpoint({ runtime, basePath: "/" });

      await endpoint.fetch(new Request("https://example.com/info"));

      // afterRequestMiddleware is fire-and-forget; give it a tick
      await new Promise((r) => setTimeout(r, 20));

      expect(afterRequestMiddleware).toHaveBeenCalledTimes(1);
      expect(afterRequestMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime,
          response: expect.any(Response),
          path: expect.stringContaining("/info"),
        }),
      );
      expect(afterCalls).toEqual(["after-called"]);
    });
  });
});
