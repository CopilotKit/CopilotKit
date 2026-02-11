import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { Observable, of } from "rxjs";

import { createCopilotEndpointSingleRouteExpress } from "../express";
import { CopilotRuntime } from "../runtime";

vi.mock("../handlers/handle-run", () => ({
  handleRunAgent: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
}));

vi.mock("../handlers/handle-connect", () => ({
  handleConnectAgent: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
}));

vi.mock("../handlers/handle-stop", () => ({
  handleStopAgent: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
}));

describe("CopilotEndpointSingleRouteExpress routing", () => {
  const createMockRuntime = () => {
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
        agent123: createMockAgent(),
        "my-agent": createMockAgent(),
        my_agent: createMockAgent(),
        testAgent: createMockAgent(),
        test: createMockAgent(),
        "test%20agent": createMockAgent(),
        "test agent": createMockAgent(),
      },
      runner,
    });
  };

  const createApp = () => {
    const runtime = createMockRuntime();
    const app = express();
    app.use(createCopilotEndpointSingleRouteExpress({ runtime, basePath: "/rpc" }));
    return { app, runtime };
  };

  const postRpc = (app: express.Express, payload: Record<string, unknown>) => {
    return request(app)
      .post("/rpc")
      .set("Content-Type", "application/json")
      .send(payload);
  };

  describe("agent/run method", () => {
    it("accepts simple agent names", async () => {
      const { app } = createApp();
      const response = await postRpc(app, {
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

    it("returns 400 when agentId missing", async () => {
      const { app } = createApp();
      const response = await postRpc(app, {
        method: "agent/run",
        body: {},
      });

      expect(response.status).toBe(400);
    });
  });

  describe("agent/stop method", () => {
    it("requires threadId", async () => {
      const { app } = createApp();
      const response = await postRpc(app, {
        method: "agent/stop",
        params: { agentId: "agent123" },
      });

      expect(response.status).toBe(400);
    });
  });

  describe("info method", () => {
    it("returns runtime info", async () => {
      const { app } = createApp();
      const response = await postRpc(app, { method: "info" });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("version");
    });

    it("handles query parameters", async () => {
      const { app } = createApp();
      const response = await request(app)
        .post("/rpc?foo=bar")
        .set("Content-Type", "application/json")
        .send({ method: "info" });

      expect(response.status).toBe(200);
    });
  });

  describe("invalid inputs", () => {
    it("returns 415 for non-JSON content", async () => {
      const { app } = createApp();
      const response = await request(app)
        .post("/rpc")
        .set("Content-Type", "text/plain")
        .send("method=info");

      expect(response.status).toBe(415);
    });

    it("returns 400 for unsupported method", async () => {
      const { app } = createApp();
      const response = await postRpc(app, { method: "unknown" });

      expect(response.status).toBe(400);
    });

    it("returns 404 for unmatched path", async () => {
      const { app } = createApp();
      const response = await request(app)
        .post("/other")
        .set("Content-Type", "application/json")
        .send({ method: "info" });

      expect(response.status).toBe(404);
    });
  });
});
