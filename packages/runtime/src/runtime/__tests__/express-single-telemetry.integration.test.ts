import { createCopilotNodeListener } from "../endpoints/node";
/**
 * Integration test: Node single-route listener + telemetry.
 */
import { expect, test, vi } from "vitest";
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { Observable, of } from "rxjs";

import { CopilotRuntime } from "../core/runtime";

function makeAgent(): AbstractAgent {
  const a: unknown = { execute: async () => ({ events: [] }) };
  (a as { clone: () => unknown }).clone = () => makeAgent();
  return a as AbstractAgent;
}

function makeRuntime() {
  const runner = {
    run: () =>
      new Observable<BaseEvent>((observer) => {
        observer.next({} as BaseEvent);
        observer.complete();
        return () => undefined;
      }),
    connect: () => of({} as BaseEvent),
    isRunning: async () => false,
    stop: async () => true,
  };
  return new CopilotRuntime({
    agents: { default: makeAgent() },
    runner,
  });
}

test("Node single-route listener fires instance_created on handler creation", async () => {
  const runtime = makeRuntime();
  const captureSpy = vi
    .spyOn(runtime.telemetry, "capture")
    .mockResolvedValue(undefined);

  try {
    createCopilotNodeListener({
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
