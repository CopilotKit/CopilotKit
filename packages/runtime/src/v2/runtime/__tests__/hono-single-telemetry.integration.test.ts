/**
 * Integration test: Hono single-route adapter (deprecated path) + telemetry.
 *
 * `createCopilotEndpointSingleRoute` is the legacy direct single-route entry
 * point, superseded by `createCopilotHonoHandler({ mode: "single-route" })`
 * but still exported.
 */
import { expect, test, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

import { createCopilotEndpointSingleRoute } from "../endpoints/hono-single";
import { CopilotRuntime } from "../core/runtime";

function makeAgent(): AbstractAgent {
  const a: unknown = { execute: async () => ({ events: [] }) };
  (a as { clone: () => unknown }).clone = () => makeAgent();
  return a as AbstractAgent;
}

test("Hono single-route adapter fires instance_created on handler creation", async () => {
  const runtime = new CopilotRuntime({ agents: { default: makeAgent() } });
  const captureSpy = vi
    .spyOn(runtime.telemetry, "capture")
    .mockResolvedValue(undefined);

  try {
    createCopilotEndpointSingleRoute({ runtime, basePath: "/api/copilotkit" });

    await vi.waitFor(() => {
      expect(captureSpy).toHaveBeenCalledWith(
        "oss.runtime.instance_created",
        expect.objectContaining({
          agentsAmount: 1,
          "cloud.api_key_provided": false,
        }),
      );
    });
  } finally {
    captureSpy.mockRestore();
  }
});
