import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

import { createCopilotEndpointExpress } from "../express";
import { CopilotRuntime } from "../core/runtime";

const createApp = (parser: express.RequestHandler) => {
  const app = express();
  app.use(parser);
  app.use(
    createCopilotEndpointExpress({
      runtime: new CopilotRuntime({
        agents: {
          agent: {
            clone: () => ({ execute: async () => ({ events: [] }) }),
          } as unknown as AbstractAgent,
        },
      }),
      basePath: "/",
    }),
  );
  return app;
};

describe("createCopilotEndpointExpress content type with body parsers", () => {
  it.each(["run", "connect", "stop/thread-1"])(
    "rejects a form body drained by express.urlencoded() on %s",
    async (action) => {
      const response = await request(createApp(express.urlencoded()))
        .post(`/agent/agent/${action}`)
        .type("form")
        .send({ hello: "world" });

      expect(response.status).toBe(415);
    },
  );

  it("keeps accepting a JSON body drained by express.json()", async () => {
    const response = await request(createApp(express.json()))
      .post("/agent/agent/stop/thread-1")
      .set("Content-Type", "application/json")
      .send({ runId: "run-1" });

    expect(response.status).toBe(200);
  });

  it("keeps a JSON content type with parameters on a drained body", async () => {
    const response = await request(createApp(express.json()))
      .post("/agent/agent/stop/thread-1")
      .set("Content-Type", "application/json; charset=utf-8")
      .send(JSON.stringify({ runId: "run-1" }));

    expect(response.status).toBe(200);
  });
});
