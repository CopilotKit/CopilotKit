/**
 * Integration test for the env-var-only license config — the exact scenario
 * this PR exists for: a self-hosted SSE user who sets COPILOTKIT_LICENSE_TOKEN
 * and never passes a `licenseToken` option. Unit tests cover the resolution;
 * this proves the env-resolved token survives all the way to the sink through
 * a real request.
 *
 * Deliberately its OWN file: the process-wide telemetry singleton is
 * last-write-wins, so if this ran after option-based tests that already set
 * the singleton to a token, it would pass even if the env fallback did
 * nothing. Per-file isolation makes this construction the ONLY thing that
 * could set the token — a faithful guard.
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
import { lambdaClient } from "@copilotkit/shared";

import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotRuntime } from "../core/runtime";
import type { AgentRunner } from "../runner/agent-runner";

const TOKEN = `header.${Buffer.from('{"telemetry_id":"abc-123"}').toString(
  "base64url",
)}.sig`;

function makeSseAgent(): AbstractAgent {
  const a: unknown = { execute: async () => ({ events: [] }) };
  (a as { clone: () => unknown }).clone = () => makeSseAgent();
  return a as AbstractAgent;
}

function makeSseRunner() {
  return {
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

describe("SSE license env fallback → telemetry sink (integration)", () => {
  let lambdaSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    lambdaSpy = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
    originalEnv = process.env.COPILOTKIT_LICENSE_TOKEN;
  });

  afterEach(() => {
    lambdaSpy.mockRestore();
    if (originalEnv === undefined) {
      delete process.env.COPILOTKIT_LICENSE_TOKEN;
    } else {
      process.env.COPILOTKIT_LICENSE_TOKEN = originalEnv;
    }
  });

  it("forwards the COPILOTKIT_LICENSE_TOKEN env value (no explicit option) to the sink", async () => {
    process.env.COPILOTKIT_LICENSE_TOKEN = TOKEN;

    const runtime = new CopilotRuntime({
      agents: { default: makeSseAgent() },
      runner: makeSseRunner(),
      // intentionally no `licenseToken` option — must fall back to the env var
    });
    const handler = createCopilotRuntimeHandler({ runtime, basePath: "/" });

    await handler(
      new Request("http://localhost/agent/default/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [], state: {}, threadId: "t1" }),
      }),
    );

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
