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
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { restoreTelemetryOptOutEnv } from "./telemetry-opt-out-env";
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

// This suite asserts that events REACH the sink, so it needs telemetry ON.
// CI sets the opt-out vars job-wide (OSS-565) and a developer may export
// DO_NOT_TRACK; either would make every send assertion fail on the
// environment rather than on the code.
//
// It has to be `vi.hoisted`, not a `beforeEach`: the telemetry singleton
// (`const telemetry = new TelemetryClient()` in telemetry-client.ts) latches
// `telemetryDisabled` from the environment at module-import time, which
// happens before any hook runs. Hoisted callbacks run before the imports.
//
// Clearing them is only safe if it is undone, so the hoisted callback also
// snapshots the originals and `afterAll` puts them back — the job-wide
// opt-out is a safety property, and this suite must not hand a weaker
// environment to whatever runs next in the same process. The capture is
// inline rather than a helper call because hoisted callbacks run before the
// imports they would need.
const originalOptOut = vi.hoisted(() => {
  const snapshot = {
    COPILOTKIT_TELEMETRY_DISABLED: process.env.COPILOTKIT_TELEMETRY_DISABLED,
    DO_NOT_TRACK: process.env.DO_NOT_TRACK,
  };
  delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
  delete process.env.DO_NOT_TRACK;
  return snapshot;
});

afterAll(() => {
  restoreTelemetryOptOutEnv(originalOptOut);
});

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
