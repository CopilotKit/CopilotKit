import { createCopilotRuntimeHandler } from "../core/fetch-handler";
/**
 * Integration test: Fetch single-route handler + telemetry.
 */
import { expect, test, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

import { CopilotRuntime } from "../core/runtime";

function makeAgent(): AbstractAgent {
  const a: unknown = { execute: async () => ({ events: [] }) };
  (a as { clone: () => unknown }).clone = () => makeAgent();
  return a as AbstractAgent;
}

test("Fetch single-route handler fires instance_created on handler creation", async () => {
  const runtime = new CopilotRuntime({ agents: { default: makeAgent() } });
  const captureSpy = vi
    .spyOn(runtime.telemetry, "capture")
    .mockResolvedValue(undefined);

  try {
    createCopilotRuntimeHandler({
      mode: "single-route",
      cors: true,
      runtime,
      basePath: "/api/copilotkit",
    });

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
