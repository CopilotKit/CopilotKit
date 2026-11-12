import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { createCopilotNodeListener } from "../endpoints/node";
import express from "express";
import request from "supertest";
import { describe, it, expect, vi } from "vitest";
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { Observable, of } from "rxjs";

import { CopilotRuntime } from "../core/runtime";
import type { CopilotSseRuntimeOptions } from "../core/runtime";

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

  const createMockRuntime = (opts?: Partial<CopilotSseRuntimeOptions>) => {
    const runner = {
      run: () =>
        new Observable<BaseEvent>((observer) => {
          observer.next({} as BaseEvent);
          observer.complete();
          return () => undefined;
        }),
      connect: () => of({} as BaseEvent),
      isRunning: async () => false,
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
    it("createCopilotRuntimeHandler still works without hooks parameter (routes /info)", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotRuntimeHandler({
        cors: true,
        runtime,
        basePath: "/",
      });

      const response = await endpoint(new Request("https://example.com/info"));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("version");
    });

    it("createCopilotNodeListener still works without hooks parameter (routes /info)", async () => {
      const runtime = createMockRuntime();
      const app = express();
      app.use(
        createCopilotNodeListener({ cors: true, runtime, basePath: "/" }),
      );

      const response = await request(app).get("/info");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("version");
    });

    it("createCopilotRuntimeHandler still works without hooks parameter", async () => {
      const runtime = createMockRuntime();
      const endpoint = createCopilotRuntimeHandler({
        mode: "single-route",
        cors: true,
        runtime,
        basePath: "/rpc",
      });

      const response = await endpoint(
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

    it("createCopilotNodeListener still works without hooks parameter", async () => {
      const runtime = createMockRuntime();
      const app = express();
      app.use(
        createCopilotNodeListener({
          mode: "single-route",
          cors: true,
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
    it("Fetch endpoint with hooks still routes /info", async () => {
      const runtime = createMockRuntime();
      const onRequest = vi.fn();
      const endpoint = createCopilotRuntimeHandler({
        cors: true,
        runtime,
        basePath: "/",
        hooks: { onRequest },
      });

      const response = await endpoint(new Request("https://example.com/info"));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toHaveProperty("version");
      expect(onRequest).toHaveBeenCalled();
    });

    it("Fetch endpoint with hooks still routes POST /agent/:id/run", async () => {
      const runtime = createMockRuntime();
      const onBeforeHandler = vi.fn();
      const endpoint = createCopilotRuntimeHandler({
        cors: true,
        runtime,
        basePath: "/",
        hooks: { onBeforeHandler },
      });

      const response = await endpoint(
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
        createCopilotNodeListener({
          cors: true,
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
      const endpoint = createCopilotRuntimeHandler({
        cors: true,
        runtime,
        basePath: "/",
      });

      await endpoint(new Request("https://example.com/info"));

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
      const endpoint = createCopilotRuntimeHandler({
        cors: true,
        runtime,
        basePath: "/",
      });

      await endpoint(new Request("https://example.com/info"));

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

    it("does not clone the response when no afterRequestMiddleware is set", async () => {
      // An unread clone buffers every chunk of a streamed response.
      const clone = vi.spyOn(Response.prototype, "clone");
      try {
        const runtime = createMockRuntime();
        const endpoint = createCopilotRuntimeHandler({
          cors: true,
          runtime,
          basePath: "/",
        });

        const response = await endpoint(
          new Request("https://example.com/info"),
        );

        expect(response.status).toBe(200);
        expect(clone).not.toHaveBeenCalled();
      } finally {
        clone.mockRestore();
      }
    });
  });
});
