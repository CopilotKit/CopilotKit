import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

import { createCopilotEndpointExpress } from "../express";
import { CopilotRuntime } from "../runtime";

const handleRunAgentMock = vi.fn();

vi.mock("../handlers/handle-run", () => ({
  handleRunAgent: (...args: unknown[]) => handleRunAgentMock(...args),
}));

const createRuntime = () =>
  new CopilotRuntime({
    agents: {
      agent: {
        clone: () => ({
          execute: async () => ({ events: [] }),
        }),
      } as unknown as AbstractAgent,
    },
  });

describe("createCopilotEndpointExpress with body parsers", () => {
  beforeEach(() => {
    handleRunAgentMock.mockReset();
    handleRunAgentMock.mockImplementation(async ({ request }: { request: Request }) => {
      const body = await request.json();
      return new Response(JSON.stringify({ body }), {
        headers: { "content-type": "application/json" },
      });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const sendRunRequest = (app: express.Express) =>
    request(app)
      .post("/agent/agent/run")
      .set("Content-Type", "application/json")
      .send({ hello: "world" });

  it("handles requests when CopilotKit router is registered before express.json()", async () => {
    const app = express();
    app.use(createCopilotEndpointExpress({ runtime: createRuntime(), basePath: "/" }));
    app.use(express.json());

    const response = await sendRunRequest(app);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ body: { hello: "world" } });
    expect(handleRunAgentMock).toHaveBeenCalledTimes(1);
  });

  it("handles requests when express.json() runs before the CopilotKit router", async () => {
    const app = express();
    app.use(express.json());
    app.use(createCopilotEndpointExpress({ runtime: createRuntime(), basePath: "/" }));

    const response = await sendRunRequest(app);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ body: { hello: "world" } });
    expect(handleRunAgentMock).toHaveBeenCalledTimes(1);
  });
});
