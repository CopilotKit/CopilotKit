import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import type { NextFunction, Request, Response } from "express";

import {
  createCopilotRequestBodyParser,
  createFinancialAssistantAgentConfig,
} from "./runtimeLimits.ts";

function hasHttpStatus(error: unknown): error is { status: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  );
}

test("sets a 90-second managed-agent turn timeout", () => {
  const config = createFinancialAssistantAgentConfig({
    agentId: "agent_test",
    environmentId: "env_test",
  });

  assert.equal(config.turnTimeoutMs, 90_000);
});

test("accepts request bodies below 256 KB and rejects larger ones", async (t) => {
  const app = express();
  app.use("/api/copilotkit", createCopilotRequestBodyParser());
  app.post("/api/copilotkit/test", (_request, response) => {
    response.sendStatus(204);
  });
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (hasHttpStatus(error) && error.status === 413) {
        response.sendStatus(413);
        return;
      }
      next(error);
    },
  );

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();
  assert(address && typeof address !== "string");
  const { port } = address;
  const acceptedResponse = await fetch(
    `http://127.0.0.1:${port}/api/copilotkit/test`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(200 * 1024) }),
    },
  );
  const rejectedResponse = await fetch(
    `http://127.0.0.1:${port}/api/copilotkit/test`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(256 * 1024) }),
    },
  );
  const rejectedBinaryResponse = await fetch(
    `http://127.0.0.1:${port}/api/copilotkit/test`,
    {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.alloc(256 * 1024 + 1),
    },
  );
  const rejectedHeaderlessResponse = await fetch(
    `http://127.0.0.1:${port}/api/copilotkit/test`,
    {
      method: "POST",
      body: Buffer.alloc(256 * 1024 + 1),
    },
  );

  assert.equal(acceptedResponse.status, 204);
  assert.equal(rejectedResponse.status, 413);
  assert.equal(rejectedBinaryResponse.status, 413);
  assert.equal(rejectedHeaderlessResponse.status, 413);
});
