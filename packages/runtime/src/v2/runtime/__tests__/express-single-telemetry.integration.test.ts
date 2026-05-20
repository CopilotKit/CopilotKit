/**
 * Integration test: Express single-route adapter (deprecated convenience
 * wrapper) + telemetry. This adapter delegates to createCopilotExpressHandler
 * with mode: "single-route".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { Observable, of } from "rxjs";

import { telemetry } from "../telemetry";
import { createCopilotEndpointSingleRouteExpress } from "../endpoints/express-single";
import { CopilotRuntime } from "../core/runtime";

function makeAgent(): AbstractAgent {
  const a: unknown = { execute: async () => ({ events: [] }) };
  (a as { clone: () => unknown }).clone = () => makeAgent();
  return a as AbstractAgent;
}

function makeRuntime() {
  const runner = {
    run: () =>
      new Observable((observer) => {
        observer.next({});
        observer.complete();
        return () => undefined;
      }),
    connect: () => of({}),
    stop: async () => true,
  };
  return new CopilotRuntime({
    agents: { default: makeAgent() },
    runner,
  });
}

describe("Express single-route adapter — telemetry firing (integration)", () => {
  let captureSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureSpy = vi.spyOn(telemetry, "capture").mockResolvedValue(undefined);
  });

  afterEach(() => {
    captureSpy.mockRestore();
  });

  it("fires instance_created on handler creation", async () => {
    const runtime = makeRuntime();
    createCopilotEndpointSingleRouteExpress({
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
  });
});
