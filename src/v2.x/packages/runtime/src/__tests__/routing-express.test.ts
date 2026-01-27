import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { Observable, of } from "rxjs";

import { createCopilotEndpointExpress } from "../express";
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

describe("CopilotEndpointExpress routing", () => {
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
    app.use(createCopilotEndpointExpress({ runtime, basePath: "/" }));
    return { app, runtime };
  };

  describe("RunAgent route pattern", () => {
    it("matches simple agent name", async () => {
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

    it("matches hyphenated agent name", async () => {
      const { app } = createApp();
      const response = await request(app)
        .post("/agent/my-agent/run")
        .set("Content-Type", "application/json")
        .send({
          messages: [],
          state: {},
          threadId: "thread-1",
        });

      expect(response.status).not.toBe(404);
    });

    it("matches underscored agent name", async () => {
      const { app } = createApp();
      const response = await request(app)
        .post("/agent/my_agent/run")
        .set("Content-Type", "application/json")
        .send({
          messages: [],
          state: {},
          threadId: "thread-1",
        });

      expect(response.status).not.toBe(404);
    });

    it("returns 404 for empty agent name", async () => {
      const { app } = createApp();
    const response = await request(app)
      .post("/agent//run")
      .set("Content-Type", "application/json")
      .send({
        messages: [],
        state: {},
        threadId: "thread-1",
      });

      expect(response.status).toBe(404);
    });
  });

  describe("Runtime info route", () => {
    it("returns 200 for /info", async () => {
      const { app } = createApp();
      const response = await request(app).get("/info");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("version");
    });

    it("returns 404 for non-info path", async () => {
      const { app } = createApp();
      const response = await request(app).get("/agents");

      expect(response.status).toBe(404);
    });
  });

  describe("Transcribe route", () => {
    it("matches /transcribe", async () => {
      const { app } = createApp();
      const response = await request(app)
        .post("/transcribe")
        .set("Content-Type", "application/json")
        .send({});

      expect(response.status).not.toBe(404);
    });
  });

  describe("Unmatched routes", () => {
    it("returns 404 for root path", async () => {
      const { app } = createApp();
      const response = await request(app).get("/");

      expect(response.status).toBe(404);
    });

    it("returns 404 for unknown paths", async () => {
      const { app } = createApp();
      const response = await request(app).get("/unknown/path");

      expect(response.status).toBe(404);
    });
  });
});
