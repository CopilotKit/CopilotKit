/**
 * Integration test: Hono single-route adapter (deprecated path) + telemetry.
 *
 * `createCopilotEndpointSingleRoute` is the legacy direct single-route entry
 * point, superseded by `createCopilotHonoHandler({ mode: "single-route" })`
 * but still exported.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

import { telemetry } from "../telemetry";
import { createCopilotEndpointSingleRoute } from "../endpoints/hono-single";
import { CopilotRuntime } from "../core/runtime";

function makeAgent(): AbstractAgent {
  const a: unknown = { execute: async () => ({ events: [] }) };
  (a as { clone: () => unknown }).clone = () => makeAgent();
  return a as AbstractAgent;
}

describe("Hono single-route adapter — telemetry firing (integration)", () => {
  let captureSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureSpy = vi.spyOn(telemetry, "capture").mockResolvedValue(undefined);
  });

  afterEach(() => {
    captureSpy.mockRestore();
  });

  it("fires instance_created on handler creation", async () => {
    const runtime = new CopilotRuntime({ agents: { default: makeAgent() } });
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
  });
});
