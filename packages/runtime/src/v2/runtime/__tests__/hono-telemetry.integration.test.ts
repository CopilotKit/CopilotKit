/**
 * Integration test: Hono adapter + telemetry.
 *
 * Asserts both ends of the path-to-production chain that the v2 refactor
 * previously broke (2ac4a40b5, 2026-03-29):
 *   1. `oss.runtime.instance_created` fires once per handler factory.
 *   2. `oss.runtime.copilot_request_created` fires when a real HTTP request
 *      flows through the handler.
 *
 * If either regresses, this test fails.
 */
import { expect, test, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

import { createCopilotHonoHandler } from "../endpoints/hono";
import { CopilotRuntime } from "../core/runtime";

function makeAgent(): AbstractAgent {
  const a: unknown = {
    execute: async () => ({ events: [] }),
  };
  (a as { clone: () => unknown }).clone = () => makeAgent();
  return a as AbstractAgent;
}

/** Creates an isolated runtime and a spy on its bound telemetry capture. */
function setup() {
  const runtime = new CopilotRuntime({ agents: { default: makeAgent() } });
  const captureSpy = vi
    .spyOn(runtime.telemetry, "capture")
    .mockResolvedValue(undefined);

  return {
    runtime,
    captureSpy,
    teardown: () => captureSpy.mockRestore(),
  };
}

test("Hono adapter fires instance_created on handler creation (multi-route)", async () => {
  const { runtime, captureSpy, teardown } = setup();

  try {
    createCopilotHonoHandler({ runtime, basePath: "/" });

    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.instance_created",
        expect.objectContaining({
          agentsAmount: 1,
          actionsAmount: 0,
          endpointsAmount: 0,
          "cloud.api_key_provided": false,
        }),
      );
    });
  } finally {
    teardown();
  }
});

test("Hono adapter fires copilot_request_created for a real HTTP request", async () => {
  const { runtime, captureSpy, teardown } = setup();

  try {
    const endpoint = createCopilotHonoHandler({ runtime, basePath: "/" });

    await endpoint.fetch(
      new Request("https://example.com/agent/default/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [], state: {}, threadId: "t1" }),
      }),
    );

    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.copilot_request_created",
      expect.objectContaining({
        requestType: "run",
        "cloud.api_key_provided": false,
      }),
    );
  } finally {
    teardown();
  }
});

test("Hono adapter includes cloud.public_api_key when the header is present", async () => {
  const { runtime, captureSpy, teardown } = setup();

  try {
    const endpoint = createCopilotHonoHandler({ runtime, basePath: "/" });

    await endpoint.fetch(
      new Request("https://example.com/agent/default/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-copilotcloud-public-api-key": "ck_pub_test_123",
        },
        body: JSON.stringify({ messages: [], state: {}, threadId: "t1" }),
      }),
    );

    expect(captureSpy).toHaveBeenCalledWith(
      "oss.runtime.copilot_request_created",
      expect.objectContaining({
        "cloud.api_key_provided": true,
        "cloud.public_api_key": "ck_pub_test_123",
      }),
    );
  } finally {
    teardown();
  }
});
