/**
 * Integration test: a self-hosted SSE runtime constructed with a license token
 * must carry that token (and therefore its telemetry_id) all the way to the
 * telemetry sink when a real HTTP request hits the endpoint.
 *
 * This is the end-to-end proof of the construction → endpoint → sink chain for
 * the gap this change closes: previously CopilotSseRuntime never called
 * telemetry.setLicenseToken, so these events reached the sink anonymously.
 *
 * Own file so the singleton mutation from the real setLicenseToken stays
 * contained by Vitest's per-file module isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { Observable, of } from "rxjs";
import request from "supertest";
import express from "express";
import { lambdaClient } from "@copilotkit/shared";

import { createCopilotExpressHandler } from "../endpoints/express";
import { CopilotRuntime } from "../core/runtime";
import type { AgentRunner } from "../runner/agent-runner";

// Real JWT shape with telemetry_id so the token parses to an identified
// caller — identified callers bypass the sample gate, so the send is
// deterministic without mocking Math.random.
const TOKEN = `header.${Buffer.from('{"telemetry_id":"abc-123"}').toString(
  "base64url",
)}.sig`;

function makeAgent(): AbstractAgent {
  const a: unknown = { execute: async () => ({ events: [] }) };
  (a as { clone: () => unknown }).clone = () => makeAgent();
  return a as AbstractAgent;
}

function makeSseRuntimeWithLicense() {
  const runner = {
    run: () =>
      new Observable((observer) => {
        observer.next({});
        observer.complete();
        return () => undefined;
      }),
    connect: () => of({}),
    stop: async () => true,
    isRunning: async () => false,
  } as unknown as AgentRunner;
  // No `intelligence` option → the CopilotRuntime shim builds a CopilotSseRuntime.
  return new CopilotRuntime({
    agents: { default: makeAgent() },
    runner,
    licenseToken: TOKEN,
  });
}

describe("SSE runtime license token → telemetry sink (integration)", () => {
  let lambdaSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lambdaSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
  });

  afterEach(() => {
    lambdaSpy.mockRestore();
  });

  it("forwards the license token to the sink on a real endpoint request", async () => {
    const runtime = makeSseRuntimeWithLicense();
    const app = express();
    app.use(createCopilotExpressHandler({ runtime, basePath: "/" }));

    await request(app)
      .post("/agent/default/run")
      .set("Content-Type", "application/json")
      .send({ messages: [], state: {}, threadId: "t1" });

    await vi.waitFor(() => {
      expect(lambdaSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "oss.runtime.copilot_request_created",
          licenseToken: TOKEN,
        }),
      );
    });
  });
});
