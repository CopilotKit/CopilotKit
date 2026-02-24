import express from "express";
import request from "supertest";
import { describe, it, expect, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { Observable, of } from "rxjs";

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

describe("Express adapter with hooks", () => {
  const createMockRuntime = (opts?: Partial<CopilotRuntime>) => {
    const createMockAgent = () => {
      const agent: unknown = {
        execute: async () => ({ events: [] }),
      };
      (agent as { clone: () => unknown }).clone = () => createMockAgent();
      return agent as AbstractAgent;
    };

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
        testAgent: createMockAgent(),
      },
      runner,
      ...opts,
    });
  };

  describe("createCopilotEndpointExpress", () => {
    const createApp = (
      runtimeOpts?: Partial<CopilotRuntime>,
      endpointOpts?: Partial<
        Omit<
          Parameters<typeof createCopilotEndpointExpress>[0],
          "runtime" | "basePath"
        >
      >,
    ) => {
      const runtime = createMockRuntime(runtimeOpts);
      const app = express();
      app.use(
        createCopilotEndpointExpress({
          runtime,
          basePath: "/",
          ...endpointOpts,
        }),
      );
      return { app, runtime };
    };

    it("routes GET /info correctly", async () => {
      const { app } = createApp();
      const response = await request(app).get("/info");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("version");
    });

    it("routes POST /agent/:id/run correctly", async () => {
      const { app } = createApp();
      const response = await request(app)
        .post("/agent/myAgent/run")
        .set("Content-Type", "application/json")
        .send({
          messages: [],
          state: {},
          threadId: "thread-1",
        });

      expect(response.status).not.toBe(404);
    });

    it("forwards hooks — onRequest hook is called", async () => {
      const onRequest = vi.fn();
      const { app } = createApp(undefined, { hooks: { onRequest } });

      await request(app).get("/info");

      expect(onRequest).toHaveBeenCalledTimes(1);
      expect(onRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.any(Request),
          path: expect.stringContaining("/info"),
          runtime: expect.any(CopilotRuntime),
        }),
      );
    });

    it("hooks can modify response headers via onResponse", async () => {
      const { app } = createApp(undefined, {
        hooks: {
          onResponse: ({ response }) => {
            const headers = new Headers(response.headers);
            headers.set("x-custom-header", "hello-from-hook");
            return new Response(response.body, {
              status: response.status,
              headers,
            });
          },
        },
      });

      const response = await request(app).get("/info");

      expect(response.status).toBe(200);
      expect(response.headers["x-custom-header"]).toBe("hello-from-hook");
    });

    it("CORS headers are present (Access-Control-Allow-Origin: *)", async () => {
      const { app } = createApp(undefined, { cors: true });
      const response = await request(app)
        .options("/info")
        .set("Origin", "https://example.com")
        .set("Access-Control-Request-Method", "GET");

      expect(response.headers["access-control-allow-origin"]).toBe("*");
    });
  });

  describe("createCopilotEndpointSingleRouteExpress", () => {
    const createSingleApp = (
      hooks?: Parameters<
        typeof createCopilotEndpointSingleRouteExpress
      >[0]["hooks"],
    ) => {
      const runtime = createMockRuntime();
      const app = express();
      app.use(
        createCopilotEndpointSingleRouteExpress({
          runtime,
          basePath: "/rpc",
          hooks,
        }),
      );
      return { app, runtime };
    };

    it("dispatches single-route with method envelope", async () => {
      const { app } = createSingleApp();
      const response = await request(app)
        .post("/rpc")
        .set("Content-Type", "application/json")
        .send({
          method: "agent/run",
          params: { agentId: "myAgent" },
          body: {
            messages: [],
            state: {},
            threadId: "thread-1",
          },
        });

      expect(response.status).not.toBe(404);
    });
  });
});
